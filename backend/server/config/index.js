const path = require('node:path');
const net = require('node:net');

const backendFolder = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(backendFolder, '.env') });
const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedFlightModes = (process.env.ALLOWED_FLIGHT_MODES || '')
  .split(',')
  .map((mode) => mode.trim().toUpperCase())
  .filter(Boolean);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5000);
const apiToken = process.env.API_TOKEN || '';
const maxWaypoints = Number(process.env.MAX_WAYPOINTS || 100);
const maxAltitude = Number(process.env.MAX_ALTITUDE || 120);
const commandTimeoutMs = Number(process.env.COMMAND_TIMEOUT_MS || 60000);
const minimumBatteryPercent = Number(process.env.MIN_BATTERY_PERCENT || 30);
const criticalBatteryPercent = Number(process.env.CRITICAL_BATTERY_PERCENT || 20);
const maxMissionDistanceFromHome = Number(process.env.MAX_MISSION_DISTANCE_METERS || 5000);
const heartbeatStaleMs = Number(process.env.HEARTBEAT_STALE_MS || 3000);
const missionFolder = resolveBackendPath(process.env.MISSION_DIR, 'data/missions');

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT harus berupa angka antara 0 dan 65535.');
}

if (!['127.0.0.1', '::1', 'localhost'].includes(host) && net.isIP(host) !== 4 && net.isIP(host) !== 6 && host !== '0.0.0.0') {
  throw new Error('HOST harus berupa alamat IP atau localhost.');
}

if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !apiToken) {
  throw new Error('API_TOKEN wajib diisi jika server dibuka ke jaringan.');
}

if (!Number.isInteger(maxWaypoints) || maxWaypoints < 1 || maxWaypoints > 1000) {
  throw new Error('MAX_WAYPOINTS harus berupa angka bulat antara 1 dan 1000.');
}

if (!Number.isFinite(maxAltitude) || maxAltitude < 1 || maxAltitude > 10000) {
  throw new Error('MAX_ALTITUDE harus berupa angka antara 1 dan 10000 meter.');
}

if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs < 1000 || commandTimeoutMs > 300000) {
  throw new Error('COMMAND_TIMEOUT_MS harus antara 1000 dan 300000.');
}

if (!Number.isFinite(minimumBatteryPercent) || minimumBatteryPercent < 1 || minimumBatteryPercent > 100
  || !Number.isFinite(criticalBatteryPercent) || criticalBatteryPercent < 1 || criticalBatteryPercent >= minimumBatteryPercent) {
  throw new Error('Batas baterai harus valid dan batas kritis harus di bawah batas minimum pra-terbang.');
}

if (!Number.isFinite(maxMissionDistanceFromHome) || maxMissionDistanceFromHome < 100
  || !Number.isInteger(heartbeatStaleMs) || heartbeatStaleMs < 500 || heartbeatStaleMs > 10000) {
  throw new Error('Batas jarak misi atau heartbeat tidak valid.');
}

function resolveBackendPath(value, fallback) {
  return path.resolve(backendFolder, value || fallback);
}

module.exports = {
  host,
  port,
  apiToken,
  allowedOrigins,
  allowedFlightModes,
  maxWaypoints,
  maxAltitude,
  commandsEnabled: process.env.ENABLE_COMMANDS === '1' && process.env.COMMANDS_READY === '1',
  commandTimeoutMs,
  minimumBatteryPercent,
  criticalBatteryPercent,
  maxMissionDistanceFromHome,
  heartbeatStaleMs,
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisChannel: process.env.REDIS_CHANNEL || 'telemetry',
  redisCommandChannel: process.env.REDIS_COMMAND_CHANNEL || 'commands',
  redisAckChannel: process.env.REDIS_ACK_CHANNEL || 'command_acks',
  mavlinkUrl: process.env.MAVLINK_URL || 'udpin:0.0.0.0:14551',
  databasePath: resolveBackendPath(process.env.DB_PATH, 'data/gcs.db'),
  missionFolder,
  logFolder: resolveBackendPath(process.env.LOG_DIR, 'data/logs')
};
