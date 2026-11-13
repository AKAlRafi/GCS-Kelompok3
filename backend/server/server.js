const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const config = require('./config');
const database = require('./db');
const apiRoutes = require('./routes');
const telemetryService = require('./services/telemetry_service');
const missionService = require('./services/mission_service');
const stateTracker = require('./services/stateTracker');
const navigation = require('./services/navigasiDrone');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.raw({ type: 'multipart/form-data', limit: '2mb' }));
  app.use(express.text({ type: ['text/plain', 'application/x-qgroundcontrol'], limit: '2mb' }));
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && !config.allowedOrigins.includes(origin)) {
      return response.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
    }
    if (origin) {
      response.set('Access-Control-Allow-Origin', origin);
      response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Credentials', 'true');
    }
    response.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    if (config.apiToken) {
      const token = request.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (token !== config.apiToken) return response.status(401).json({ ok: false, error: 'Token API tidak valid.' });
    }
    next();
  });
  app.get('/', (request, response) => response.json({ ok: true, service: 'gcs-backend' }));
  app.use('/api', apiRoutes);
  app.use((request, response) => response.status(404).json({ ok: false, error: 'Endpoint tidak ditemukan.' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    console.error('Permintaan API gagal:', error.message);
    response.status(status).json({ ok: false, error: status === 500 ? 'Terjadi kesalahan server.' : error.message,
      ...(error.code ? { code: error.code } : {}) });
  });
  return app;
}

function startServer({ host = config.host, port = config.port, connectRedis = true } = {}) {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'], credentials: true }
  });
  io.use((socket, next) => {
    if (config.apiToken && socket.handshake.auth?.token !== config.apiToken) {
      return next(new Error('Token API tidak valid.'));
    }
    next();
  });
  let stopping = false;
  let connecting = false;
  let activeMission = null;
  let activeWaypointIndex = 0;
  let waypointReachedAt = null;
  let emergencyTriggered = false;
  // WebSocket meneruskan telemetry ke frontend Fai.
  io.on('connection', (socket) => socket.emit('telemetry', telemetryService.getLatestTelemetry()));
  telemetryService.setTelemetryListener((telemetry) => io.emit('telemetry', telemetry));
  stateTracker.setStateListener((state) => {
    if (!activeMission) return;
    try {
      const mission = missionService.readMission(activeMission);
      const waypoint = mission.waypoints[activeWaypointIndex];
      if (!waypoint) {
        io.emit('mission_progress', { mission_id: activeMission, stage: 'COMPLETED', active_waypoint: null });
        activeMission = null;
        return;
      }
      let target = waypoint;
      let stage = 'NAVIGATING_WAYPOINT';
      if (waypoint.command === 20) {
        target = { lat: state.home_lat, lon: state.home_lon, alt: 0 };
        stage = 'RETURNING_HOME';
      } else if (waypoint.command === 21) stage = 'LANDING';
      else if (waypoint.command === 22) stage = 'TAKING_OFF';
      else if ([115, 178, 183, 203].includes(waypoint.command)) stage = 'EXECUTING_ACTION';
      if ([16, 19, 21, 22, 20].includes(waypoint.command)
        && [state.lat, state.lon, target.lat, target.lon].every((value) => Number.isFinite(Number(value)))) {
        const distance = navigation.hitungJarakMeter(state.lat, state.lon, target.lat, target.lon);
        const bearing = navigation.hitungArahBearing(state.lat, state.lon, target.lat, target.lon);
        const turn = Number.isFinite(Number(state.heading)) ? navigation.hitungSudutBelok(state.heading, bearing) : null;
        io.emit('navigation_guidance', { mission_id: activeMission, waypoint: activeWaypointIndex,
          distance_m: Number(distance.toFixed(2)), bearing_deg: Number(bearing.toFixed(2)),
          altitude_error_meter: Number.isFinite(Number(state.rel_alt)) ? target.alt - Number(state.rel_alt) : null, turn });
        const reached = distance <= Math.max(2, waypoint.param2 || 5);
        if (waypoint.command === 19) {
          if (reached) stage = 'EXECUTING_ACTION';
          if (reached && waypointReachedAt === null) waypointReachedAt = Date.now();
          if (waypointReachedAt !== null && Date.now() - waypointReachedAt >= Math.max(0, waypoint.param1) * 1000) activeWaypointIndex += 1;
        } else if (waypoint.command === 21) {
          if (state.armed === false || Number(state.rel_alt) <= 0.5) activeWaypointIndex += 1;
        } else if (waypoint.command === 22) {
          if (reached && Number(state.rel_alt) >= waypoint.alt - 1) activeWaypointIndex += 1;
        } else if (waypoint.command === 20) {
          if ((reached && Number(state.rel_alt) <= 1) || state.armed === false) activeWaypointIndex += 1;
        } else if (reached) activeWaypointIndex += 1;
      } else if (![16, 19, 20, 21, 22].includes(waypoint.command)) activeWaypointIndex += 1;
      if (activeWaypointIndex !== waypoint.seq) waypointReachedAt = null;
      io.emit('mission_progress', { mission_id: activeMission, stage,
        active_waypoint: activeWaypointIndex, waypoint_count: mission.waypoints.length });
    } catch (error) { console.error('Gagal menghitung progres misi:', error.message); }
  });
  telemetryService.setMissionStarter((id) => {
    activeMission = Number(id);
    activeWaypointIndex = 0;
    emergencyTriggered = false;
  });
  telemetryService.setMissionProgressListener((progress) => io.emit('mission_progress', progress));
  const failsafeTimer = setInterval(() => {
    if (!activeMission || emergencyTriggered) return;
    const state = stateTracker.getState();
    const heartbeatAge = state.heartbeat_age_ms;
    const batteryLow = state.battery_percent != null && Number.isFinite(Number(state.battery_percent))
      && Number(state.battery_percent) <= config.criticalBatteryPercent;
    const heartbeatLost = heartbeatAge === null || heartbeatAge < 0 || heartbeatAge > 5000;
    if (!batteryLow && !heartbeatLost) return;
    emergencyTriggered = true;
    const reason = batteryLow ? 'BATERAI_KRITIS' : 'HEARTBEAT_HILANG';
    io.emit('failsafe_warning', { mission_id: activeMission, severity: 'CRITICAL', reason,
      message: batteryLow ? 'Baterai kritis; meminta RTL otomatis.' : 'Heartbeat hilang lebih dari 5 detik; meminta RTL otomatis.' });
    void telemetryService.sendCommand('rtl', {}).catch((error) => console.error('Perintah failsafe RTL gagal dikirim:', error.message));
  }, 500);
  failsafeTimer.unref();

  const redisRetry = connectRedis ? setInterval(async () => {
    if (connecting || telemetryService.getHealth().redis) return;
    connecting = true;
    try {
      await telemetryService.connectTelemetry();
      console.log(`Terhubung ke Redis, channel ${config.redisChannel}.`);
    } catch (error) {
      console.error('Redis belum tersedia:', error.message);
    } finally {
      connecting = false;
    }
  }, 5000) : null;
  redisRetry?.unref();

  const ready = new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });
  ready.then(() => {
    console.log(`GCS backend berjalan di http://${host}:${httpServer.address().port}`);
    if (connectRedis) void (async () => {
      connecting = true;
      try { await telemetryService.connectTelemetry(); }
      catch (error) { console.error('Redis belum tersedia:', error.message); }
      finally { connecting = false; }
    })();
  });

  async function stopServer() {
    if (stopping) return;
    stopping = true;
    if (redisRetry) clearInterval(redisRetry);
    clearInterval(failsafeTimer);
    await new Promise((resolve) => io.close(resolve));
    await telemetryService.closeTelemetry().catch((error) => console.error('Gagal menutup Redis:', error.message));
    database.close();
  }

  return { app, io, httpServer, ready, stopServer,
    setActiveMission(id) { activeMission = Number(id); activeWaypointIndex = 0; emergencyTriggered = false; } };
}

if (require.main === module) {
  const instance = startServer();
  let shuttingDown = false;
  const shutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Server berhenti: ${reason}`);
    try { await instance.stopServer(); }
    catch (error) { console.error('Gagal shutdown:', error.message); exitCode = 1; }
    process.exit(exitCode);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => void shutdown(`unhandledRejection: ${error?.message || error}`, 1));
  process.on('uncaughtException', (error) => void shutdown(`uncaughtException: ${error.message}`, 1));
}

module.exports = { createApp, startServer };
