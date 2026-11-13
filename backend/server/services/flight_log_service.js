const fs = require('node:fs');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const database = require('../db');
const config = require('../config');

let activeLog = null;
let lastQueueWarningAt = 0;

function listLogs() {
  return database.listFlightLogs();
}

function startLog(name = 'flight') {
  if (activeLog) throw new Error('Flight log sedang berjalan.');
  fs.mkdirSync(config.logFolder, { recursive: true });
  const safeName = String(name || 'flight').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'flight';
  const fileName = `${Date.now()}-${safeName}.jsonl`;
  const filePath = path.join(config.logFolder, fileName);
  const id = database.createFlightLog({ name: safeName, fileName, filePath });
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  activeLog = { id, stream, fileWarningShown: false };
  stream.on('error', (error) => {
    console.error('Gagal menulis flight log:', error.message);
    if (activeLog?.id === id) activeLog = null;
    try { database.finishFlightLog(id); }
    catch (databaseError) { console.error('Gagal menutup catatan flight log:', databaseError.message); }
  });
  return { ok: true, id };
}

function saveTelemetry(telemetry) {
  const record = {
    log_id: activeLog?.id ?? null,
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
  if (!database.saveTelemetry(record)) {
    const now = Date.now();
    if (now - lastQueueWarningAt > 5000) {
      console.error('Antrean database telemetry penuh; sebagian record tidak tersimpan.');
      lastQueueWarningAt = now;
    }
  }
  if (!activeLog) return;
  if (activeLog.stream.writableLength > 2_000_000) {
    if (!activeLog.fileWarningShown) {
      console.error('Flight log melambat; baris JSONL sementara dilewati, database tetap menerima telemetry.');
      activeLog.fileWarningShown = true;
    }
    return;
  }
  activeLog.stream.write(`${JSON.stringify(telemetry)}\n`);
}

async function stopLog() {
  if (!activeLog) throw new Error('Tidak ada flight log yang sedang berjalan.');
  const log = activeLog;
  activeLog = null;
  const streamFinished = finished(log.stream);
  log.stream.end();
  try {
    await streamFinished;
  } finally {
    database.finishFlightLog(log.id);
  }
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
