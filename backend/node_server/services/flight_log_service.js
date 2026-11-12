const fs = require('node:fs');
const path = require('node:path');
const database = require('../db');
const config = require('../config');

let activeLog = null;

function listLogs() {
  return database.listFlightLogs();
}

function startLog(name = 'flight') {
  if (activeLog) throw new Error('Flight log sedang berjalan.');
  fs.mkdirSync(config.logFolder, { recursive: true });
  const safeName = String(name).trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'flight';
  const fileName = `${Date.now()}-${safeName}.jsonl`;
  const filePath = path.join(config.logFolder, fileName);
  const id = database.createFlightLog({ name: safeName, fileName, filePath });
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  stream.on('error', (error) => console.error('Gagal menulis flight log:', error));
  activeLog = { id, stream };
  return { ok: true, id };
}

function saveTelemetry(telemetry) {
  if (!activeLog) return;
  const record = {
    log_id: activeLog.id,
    recorded_at: telemetry.received_at,
    latitude: telemetry.lat,
    longitude: telemetry.lon,
    altitude: telemetry.alt,
    relative_altitude: telemetry.rel_alt,
    ground_speed: telemetry.groundspeed,
    air_speed: telemetry.airspeed,
    roll: telemetry.roll,
    pitch: telemetry.pitch,
    yaw: telemetry.yaw,
    heading: telemetry.heading,
    battery_percent: telemetry.battery_percent,
    flight_mode: telemetry.flight_mode,
    armed: telemetry.armed
  };
  database.saveTelemetry(record);
  activeLog.stream.write(`${JSON.stringify(telemetry)}\n`);
}

async function stopLog() {
  if (!activeLog) throw new Error('Tidak ada flight log yang sedang berjalan.');
  const log = activeLog;
  activeLog = null;
  await new Promise((resolve, reject) => {
    log.stream.end((error) => error ? reject(error) : resolve());
  });
  database.finishFlightLog(log.id);
  return { ok: true };
}

function getLog(id) {
  return database.getFlightLog(id);
}

function getActiveLog() {
  return activeLog ? { active: true, id: activeLog.id } : { active: false, id: null };
}

function getTelemetry(id, limit) {
  return database.listTelemetry(id, limit);
}

module.exports = { listLogs, startLog, saveTelemetry, stopLog, getLog, getActiveLog, getTelemetry };
