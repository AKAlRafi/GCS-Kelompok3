const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

// Database disimpan di folder data agar file runtime tidak bercampur dengan kode.
const database = new Database(config.databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.pragma('busy_timeout = 5000');
database.exec(`
  CREATE TABLE IF NOT EXISTS parameters (
    name TEXT PRIMARY KEY,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    description TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS flight_jsonl_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    recording INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS flight_jsonl (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES flight_jsonl_sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS flight_tlogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    recording INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    waypoint_count INTEGER NOT NULL,
    total_distance_m REAL NOT NULL DEFAULT 0,
    estimated_flight_time_s REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_flight_jsonl_session_time
    ON flight_jsonl(session_id, recorded_at);
`);

// Keep old TLOG file references, but discard the old permanent JSONL telemetry cache.
const oldTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
if (oldTables.has('flight_logs')) {
  const oldFlightLogColumns = new Set(database.pragma('table_info(flight_logs)').map((column) => column.name));
  for (const [name, type] of Object.entries({
    format: "TEXT NOT NULL DEFAULT 'jsonl'",
    recording: 'INTEGER NOT NULL DEFAULT 0',
    file_size: 'INTEGER NOT NULL DEFAULT 0',
    modified_at: 'TEXT'
  })) {
    if (!oldFlightLogColumns.has(name)) database.exec(`ALTER TABLE flight_logs ADD COLUMN ${name} ${type}`);
  }
  database.exec(`
    INSERT OR IGNORE INTO flight_tlogs (
      id, name, file_name, file_path, recording, file_size, modified_at, started_at, ended_at, created_at
    )
    SELECT id, name, file_name, file_path, recording, file_size, modified_at, started_at, ended_at, created_at
    FROM flight_logs WHERE format = 'tlog';
  `);
  database.exec('DROP TABLE IF EXISTS telemetry_records; DROP TABLE flight_logs;');
} else {
  database.exec('DROP TABLE IF EXISTS telemetry_records;');
}

// JSONL telemetry is temporary: a backend restart starts with an empty recording table.
database.exec('DELETE FROM flight_jsonl; DELETE FROM flight_jsonl_sessions;');
if (fs.existsSync(config.logFolder)) {
  for (const entry of fs.readdirSync(config.logFolder, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
      fs.unlinkSync(path.join(config.logFolder, entry.name));
    }
  }
}

const insertDefaultParameter = database.prepare(`
  INSERT OR IGNORE INTO parameters (name, value, unit, description)
  VALUES (?, ?, ?, ?)
`);

for (const parameter of [
  ['min_battery', 20, '%', 'Batas minimum baterai untuk peringatan'],
  ['max_altitude', 120, 'm', 'Batas ketinggian maksimum'],
  ['max_speed', 25, 'm/s', 'Batas kecepatan maksimum'],
  ['stall_speed', 15, 'm/s', 'Batas kecepatan minimum pesawat']
]) insertDefaultParameter.run(...parameter);

const pendingJsonlRecords = [];
const maxPendingJsonlRecords = 10000;
const jsonlRecordsPerBatch = 250;
const insertJsonlRecord = database.prepare(`
  INSERT INTO flight_jsonl (session_id, recorded_at, payload)
  VALUES (@session_id, @recorded_at, @payload)
`);
const insertJsonlBatch = database.transaction((records) => {
  for (const record of records) insertJsonlRecord.run(record);
});
let droppedJsonlCount = 0;

function listParameters() {
  return database.prepare('SELECT * FROM parameters ORDER BY name').all();
}

function saveParameters(parameters) {
  const update = database.prepare(`
    UPDATE parameters SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?
  `);
  database.transaction((items) => {
    for (const item of items) {
      const value = item && Number(item.value);
      if (!item || typeof item !== 'object' || !Number.isFinite(value) || typeof item.name !== 'string') {
        const error = new Error('Setiap parameter harus memiliki nama dan nilai angka yang valid.');
        error.status = 400;
        throw error;
      }
      if (update.run(value, item.name).changes === 0) {
        const error = new Error(`Parameter tidak dikenal: ${item.name}`);
        error.status = 400;
        throw error;
      }
    }
  })(parameters);
  return listParameters();
}

function createFlightLog({ name, fileName }) {
  const result = database.prepare(`
    INSERT INTO flight_jsonl_sessions (name, file_name, recording, started_at)
    VALUES (?, ?, 1, ?)
  `).run(name, fileName, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function upsertTlogFile({ name, fileName, filePath, startedAt, fileSize, modifiedAt, recording }) {
  database.prepare(`
    INSERT INTO flight_tlogs (name, file_name, file_path, recording, file_size, modified_at, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN NULL ELSE ? END)
    ON CONFLICT(file_name) DO UPDATE SET
      file_path = excluded.file_path,
      recording = excluded.recording,
      file_size = excluded.file_size,
      modified_at = excluded.modified_at,
      ended_at = CASE
        WHEN excluded.recording = 1 THEN NULL
        ELSE COALESCE(flight_tlogs.ended_at, excluded.modified_at)
      END
  `).run(name, fileName, filePath, Number(recording), fileSize, modifiedAt, startedAt,
    Number(recording), modifiedAt);
}

function syncTlogFiles() {
  if (!fs.existsSync(config.tlogFolder)) {
    database.exec('DELETE FROM flight_tlogs');
    return [];
  }
  const files = fs.readdirSync(config.tlogFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.tlog'))
    .map((entry) => {
      const filePath = path.join(config.tlogFolder, entry.name);
      const stat = fs.statSync(filePath);
      let recording = 0;
      try {
        if (Date.now() - fs.statSync(`${filePath}.active`).mtimeMs <= 10000) recording = 1;
      } catch {}
      upsertTlogFile({
        name: 'flight',
        fileName: entry.name,
        filePath,
        startedAt: stat.birthtime.toISOString(),
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        recording,
      });
      return { file_name: entry.name, size: stat.size, modified_at: stat.mtime.toISOString(), recording: Boolean(recording) };
    });
  const fileNames = files.map((file) => file.file_name);
  if (fileNames.length) {
    database.prepare(`DELETE FROM flight_tlogs WHERE file_name NOT IN (${fileNames.map(() => '?').join(',')})`).run(...fileNames);
  } else {
    database.exec('DELETE FROM flight_tlogs');
  }
  return files.sort((first, second) => second.modified_at.localeCompare(first.modified_at));
}

function finishFlightLog(id) {
  if (!flushAllTelemetry()) throw new Error('Catatan JSONL belum berhasil disimpan ke database.');
  return database.prepare('UPDATE flight_jsonl_sessions SET ended_at = ?, recording = 0 WHERE id = ?')
    .run(new Date().toISOString(), id).changes > 0;
}

function listFlightLogs() {
  return database.prepare(`
    SELECT id, name, file_name, 'jsonl' AS format, recording, started_at, ended_at, created_at
    FROM flight_jsonl_sessions ORDER BY id DESC
  `).all();
}

function getFlightLog(id) {
  return database.prepare('SELECT *, \'jsonl\' AS format FROM flight_jsonl_sessions WHERE id = ?').get(id);
}

function getTlogFile(fileName) {
  return database.prepare('SELECT * FROM flight_tlogs WHERE file_name = ?').get(fileName);
}

function createMission({ name, fileName, waypointCount, totalDistanceM, estimatedFlightTimeS }) {
  const result = database.prepare(`
    INSERT INTO missions (name, file_name, waypoint_count, total_distance_m, estimated_flight_time_s)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, fileName, waypointCount, totalDistanceM, estimatedFlightTimeS);
  return Number(result.lastInsertRowid);
}

function listMissions() {
  return database.prepare('SELECT * FROM missions ORDER BY id DESC').all();
}

function getMission(id) {
  return database.prepare('SELECT * FROM missions WHERE id = ?').get(id);
}

function deleteMission(id) {
  return database.prepare('DELETE FROM missions WHERE id = ?').run(id).changes > 0;
}

function flushTelemetry() {
  if (pendingJsonlRecords.length === 0) return true;
  const batch = pendingJsonlRecords.splice(0, jsonlRecordsPerBatch);
  try {
    insertJsonlBatch(batch);
    return true;
  } catch (error) {
    pendingJsonlRecords.unshift(...batch);
    console.error('Gagal menyimpan batch JSONL:', error.message);
    return false;
  }
}

function flushAllTelemetry() {
  while (pendingJsonlRecords.length > 0) {
    if (!flushTelemetry()) return false;
  }
  return true;
}

function saveTelemetry(record) {
  if (pendingJsonlRecords.length >= maxPendingJsonlRecords) {
    droppedJsonlCount += 1;
    return false;
  }
  pendingJsonlRecords.push({
    session_id: record.session_id,
    recorded_at: record.recorded_at || new Date().toISOString(),
    payload: JSON.stringify(record.payload)
  });
  if (pendingJsonlRecords.length >= jsonlRecordsPerBatch) flushTelemetry();
  return true;
}

function getTelemetryQueueStatus() {
  return { queued: pendingJsonlRecords.length, dropped: droppedJsonlCount };
}

function listTelemetry(logId, requestedLimit) {
  flushAllTelemetry();
  const parsedLimit = Number.parseInt(requestedLimit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(10000, Math.max(1, parsedLimit)) : 1000;
  return database.prepare('SELECT payload FROM flight_jsonl WHERE session_id = ? ORDER BY id ASC LIMIT ?')
    .all(logId, limit)
    .map((record) => JSON.parse(record.payload));
}

function iterateFlightJsonl(logId) {
  if (!flushAllTelemetry()) throw new Error('Catatan JSONL belum berhasil disimpan ke database.');
  return database.prepare('SELECT payload FROM flight_jsonl WHERE session_id = ? ORDER BY id ASC').iterate(logId);
}

module.exports = {
  listParameters,
  saveParameters,
  createFlightLog,
  upsertTlogFile,
  syncTlogFiles,
  getTlogFile,
  finishFlightLog,
  listFlightLogs,
  getFlightLog,
  createMission,
  listMissions,
  getMission,
  deleteMission,
  saveTelemetry,
  flushTelemetry,
  getTelemetryQueueStatus,
  listTelemetry,
  iterateFlightJsonl,
  close: () => {
    clearInterval(telemetryFlushTimer);
    if (!flushAllTelemetry()) throw new Error('JSONL yang belum tersimpan masih tertahan di antrean.');
    if (database.open) database.close();
  }
};

const telemetryFlushTimer = setInterval(flushTelemetry, 250);
telemetryFlushTimer.unref();
syncTlogFiles();
