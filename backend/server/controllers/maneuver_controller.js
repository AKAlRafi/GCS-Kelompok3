const config = require('../config');
const telemetry = require('../services/telemetry_service');
const tracker = require('../services/stateTracker');
const missions = require('../services/mission_service');
const navigation = require('../services/navigasiDrone');

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = 'INVALID_MANEUVER';
  return error;
}

function requireHeartbeat() {
  if (!tracker.getState().heartbeat_fresh) throw invalid('Heartbeat drone tidak ada atau lebih lama dari batas aman; manuver ditolak.');
}

function validateTarget(target) {
  if (![target.lat, target.lon, target.alt].every((value) => Number.isFinite(Number(value)))) throw invalid('lat, lon, dan alt harus berupa angka.');
  if (Number(target.lat) < -90 || Number(target.lat) > 90 || Number(target.lon) < -180 || Number(target.lon) > 180) throw invalid('Koordinat target di luar batas bumi.');
  if (Number(target.lat) === 0 && Number(target.lon) === 0) throw invalid('Koordinat target tidak boleh (0, 0).');
  if (Number(target.alt) < 1 || Number(target.alt) > config.maxAltitude) throw invalid(`Ketinggian target harus antara 1 dan ${config.maxAltitude} meter.`);
}

function validateDistanceFromHome(target) {
  const state = tracker.getState();
  if (state.home_lat == null || state.home_lon == null
    || !Number.isFinite(Number(state.home_lat)) || !Number.isFinite(Number(state.home_lon))
    || (Number(state.home_lat) === 0 && Number(state.home_lon) === 0)) throw invalid('Koordinat Home belum diterima dari autopilot.');
  const distance = navigation.hitungJarakMeter(state.home_lat, state.home_lon, target.lat, target.lon);
  if (distance > config.maxMissionDistanceFromHome) throw invalid(`Target melebihi batas ${config.maxMissionDistanceFromHome} meter dari Home.`);
}

async function handle(request, response, next) {
  try {
    requireHeartbeat();
    const body = request.body || {};
    const action = String(body.action || '').toUpperCase();
    if (action === 'ROTATE_YAW') {
      const { angle_deg, direction = 'KANAN', speed_deg_s = 30 } = body;
      const mode = String(body.mode || 'absolute').toLowerCase();
      const angle = Number(angle_deg); const speed = Number(speed_deg_s);
      if (!Number.isFinite(angle) || !Number.isFinite(speed) || speed <= 0 || speed > 180) throw invalid('angle_deg dan speed_deg_s tidak valid.');
      const relative = mode === 'relative';
      if (!relative && mode !== 'absolute') throw invalid('mode harus absolute atau relative.');
      if (relative && (angle < 0 || angle > 180)) throw invalid('Sudut relatif harus antara 0 dan 180 derajat.');
      if (!relative && (angle < 0 || angle >= 360)) throw invalid('Heading absolut harus antara 0 dan 359,99 derajat.');
      if (!['KANAN', 'KIRI'].includes(String(direction).toUpperCase())) throw invalid('direction harus KANAN atau KIRI.');
      const command = await telemetry.sendCommand('condition_yaw', {
        angle_deg: angle, speed_deg_s: speed,
        direction: String(direction).toUpperCase() === 'KANAN' ? 1 : -1,
        relative
      });
      return response.json({ ...command, action, command: 'condition_yaw' });
    }
    if (action === 'TURN_TO_COORDINATE') {
      validateTarget(body);
      validateDistanceFromHome(body);
      const turnSpeed = Number(body.speed_deg_s ?? 30);
      if (!Number.isFinite(turnSpeed) || turnSpeed <= 0 || turnSpeed > 180) throw invalid('speed_deg_s harus lebih besar dari 0 dan maksimal 180 derajat per detik.');
      let calculation;
      try { calculation = tracker.calculateTo({ lat: Number(body.lat), lon: Number(body.lon), alt: Number(body.alt) }); }
      catch (error) { throw invalid(error.message); }
      const yaw = await telemetry.sendCommand('condition_yaw', { angle_deg: calculation.bearing_deg, speed_deg_s: turnSpeed, direction: calculation.sudut_belok >= 0 ? 1 : -1, relative: false });
      const movement = await telemetry.sendCommand('guided_goto', { lat: Number(body.lat), lon: Number(body.lon), alt: Number(body.alt) });
      return response.json({ ok: true, action, navigation: calculation, yaw, movement });
    }
    if (action === 'CHANGE_ALTITUDE') {
      const targetAlt = Number(body.altitude_m);
      if (!Number.isFinite(targetAlt) || targetAlt < 1 || targetAlt > config.maxAltitude) throw invalid(`altitude_m harus antara 1 dan ${config.maxAltitude} meter.`);
      const state = tracker.getState();
      if (!Number.isFinite(Number(state.lat)) || !Number.isFinite(Number(state.lon))) throw invalid('Posisi drone belum tersedia.');
      if (!Number.isFinite(Number(state.rel_alt))) throw invalid('Ketinggian relatif drone belum tersedia.');
      validateDistanceFromHome({ lat: Number(state.lat), lon: Number(state.lon) });
      const command = await telemetry.sendCommand('guided_goto', { lat: state.lat, lon: state.lon, alt: targetAlt });
      return response.json({ ...command, action, altitude_error_meter: targetAlt - Number(state.rel_alt) });
    }
    if (action === 'CHANGE_SPEED') {
      const speed = Number(body.speed_mps);
      if (!Number.isFinite(speed) || speed < 0.5 || speed > 25) throw invalid('speed_mps harus antara 0,5 dan 25 m/s.');
      const command = await telemetry.sendCommand('change_speed', { speed_mps: speed });
      return response.json({ ...command, action });
    }
    throw invalid('action harus ROTATE_YAW, TURN_TO_COORDINATE, CHANGE_ALTITUDE, atau CHANGE_SPEED.');
  } catch (error) {
    if (['REDIS_UNAVAILABLE', 'COMMANDS_DISABLED', 'COMMAND_QUEUE_FULL', 'COMMAND_TIMEOUT', 'COMMAND_UNAVAILABLE'].includes(error.code)) error.status ||= 503;
    return next(error);
  }
}

async function missionCommand(request, response, next) {
  try {
    const type = String(request.body?.type || '').toLowerCase();
    if (type === 'start_mission') {
      const id = Number(request.body?.mission_id);
      if (!Number.isInteger(id) || id < 1) throw invalid('mission_id wajib berupa ID misi yang valid.');
      const result = await missions.startMission(id, telemetry.reportMissionProgress);
      telemetry.trackMission(id);
      return response.json(result);
    }
    const allowed = new Set(['pause_mission', 'resume_mission', 'rtl', 'land', 'clear_mission']);
    if (!allowed.has(type)) throw invalid('Perintah misi tidak dikenal.');
    if (type === 'rtl' || type === 'land' || type === 'pause_mission' || type === 'resume_mission') requireHeartbeat();
    return response.json(await telemetry.sendCommand(type, {}));
  } catch (error) { return next(error); }
}

module.exports = { handle, missionCommand };
