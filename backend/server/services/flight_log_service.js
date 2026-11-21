const database = require('../db');

let activeLog = null;
let lastQueueWarningAt = 0;

function listLogs() {
  return database.listFlightLogs();
}

function startLog(name = 'flight') {
  if (activeLog) throw new Error('Flight log sedang berjalan.');
  const safeName = String(name || 'flight').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'flight';
  const fileName = `${Date.now()}-${safeName}.jsonl`;
  const id = database.createFlightLog({ name: safeName, fileName });
  activeLog = { id };
  return { ok: true, id };
}

function saveTelemetry(telemetry) {
  if (!activeLog) return;
  if (!database.saveTelemetry({
    session_id: activeLog.id,
    recorded_at: telemetry.received_at,
    payload: telemetry
  })) {
    const now = Date.now();
    if (now - lastQueueWarningAt > 5000) {
      console.error('Antrean JSONL penuh; sebagian record tidak tersimpan.');
      lastQueueWarningAt = now;
    }
  }
}

async function stopLog() {
  if (!activeLog) throw new Error('Tidak ada flight log yang sedang berjalan.');
  const log = activeLog;
  database.finishFlightLog(log.id);
  activeLog = null;
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

function createJsonlStream(id) {
  const { Readable } = require('node:stream');
  const records = database.iterateFlightJsonl(id);
  return Readable.from((function* streamRecords() {
    for (const record of records) yield `${record.payload}\n`;
  })());
}

module.exports = { listLogs, startLog, saveTelemetry, stopLog, getLog, getActiveLog, getTelemetry, createJsonlStream };
