const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const config = require('./config');
const database = require('./db');
const apiRoutes = require('./routes');
const telemetryService = require('./services/telemetry_service');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
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
    response.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
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
    response.status(status).json({ ok: false, error: status === 500 ? 'Terjadi kesalahan server.' : error.message });
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
  io.on('connection', (socket) => socket.emit('telemetry', telemetryService.getLatestTelemetry()));
  telemetryService.setTelemetryListener((telemetry) => io.emit('telemetry', telemetry));

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
    await new Promise((resolve) => io.close(resolve));
    await telemetryService.closeTelemetry().catch((error) => console.error('Gagal menutup Redis:', error.message));
    database.close();
  }

  return { app, io, httpServer, ready, stopServer };
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
