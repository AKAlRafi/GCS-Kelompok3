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
  CREATE TABLE IF NOT EXISTS flight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS telemetry_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id INTEGER,
    recorded_at TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    altitude REAL,
    relative_altitude REAL,
    ground_speed REAL,
    air_speed REAL,
    roll REAL,
    pitch REAL,
    yaw REAL,
    heading REAL,
    battery_percent REAL,
    flight_mode TEXT,
    armed INTEGER,
    FOREIGN KEY (log_id) REFERENCES flight_logs(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_log_time
    ON telemetry_records(log_id, recorded_at);
`);

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

const pendingTelemetryRecords = [];
const maxPendingTelemetryRecords = 10000;
const telemetryRecordsPerBatch = 250;
const telemetryColumns = [
  'latitude', 'longitude', 'altitude', 'relative_altitude', 'ground_speed',
  'air_speed', 'roll', 'pitch', 'yaw', 'heading', 'battery_percent'
];
const insertTelemetry = database.prepare(`
  INSERT INTO telemetry_records (
    log_id, recorded_at, latitude, longitude, altitude, relative_altitude,
    ground_speed, air_speed, roll, pitch, yaw, heading, battery_percent,
    flight_mode, armed
  ) VALUES (
    @log_id, @recorded_at, @latitude, @longitude, @altitude, @relative_altitude,
    @ground_speed, @air_speed, @roll, @pitch, @yaw, @heading, @battery_percent,
    @flight_mode, @armed
  )
`);
const insertTelemetryBatch = database.transaction((records) => {
  for (const record of records) insertTelemetry.run(record);
});
let droppedTelemetryCount = 0;

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

function createFlightLog({ name, fileName, filePath }) {
  const result = database.prepare(`
    INSERT INTO flight_logs (name, file_name, file_path, started_at)
    VALUES (?, ?, ?, ?)
  `).run(name, fileName, filePath, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function finishFlightLog(id) {
  return database.prepare('UPDATE flight_logs SET ended_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id).changes > 0;
}

function listFlightLogs() {
  return database.prepare(`
    SELECT id, name, file_name, started_at, ended_at, created_at
    FROM flight_logs ORDER BY id DESC
  `).all();
}

function getFlightLog(id) {
  return database.prepare('SELECT * FROM flight_logs WHERE id = ?').get(id);
}

function normalizeTelemetryRecord(record) {
  const values = {};
  for (const column of telemetryColumns) {
    const value = record[column];
    values[column] = value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  }
  return {
    ...values,
    log_id: record.log_id ?? null,
    recorded_at: record.recorded_at || new Date().toISOString(),
    flight_mode: record.flight_mode ?? null,
    armed: record.armed == null ? null : Number(Boolean(record.armed))
  };
}

function flushTelemetry() {
  if (pendingTelemetryRecords.length === 0) return true;
  const batch = pendingTelemetryRecords.splice(0, telemetryRecordsPerBatch);
  try {
    insertTelemetryBatch(batch.map(normalizeTelemetryRecord));
    return true;
  } catch (error) {
    pendingTelemetryRecords.unshift(...batch);
    console.error('Gagal menyimpan batch telemetry:', error.message);
    return false;
  }
}

function saveTelemetry(record) {
  if (pendingTelemetryRecords.length >= maxPendingTelemetryRecords) {
    droppedTelemetryCount += 1;
    return false;
  }
  pendingTelemetryRecords.push({ ...record });
  if (pendingTelemetryRecords.length >= telemetryRecordsPerBatch) flushTelemetry();
  return true;
}

function getTelemetryQueueStatus() {
  return { queued: pendingTelemetryRecords.length, dropped: droppedTelemetryCount };
}

function listTelemetry(logId, requestedLimit) {
  flushTelemetry();
  const parsedLimit = Number.parseInt(requestedLimit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(10000, Math.max(1, parsedLimit)) : 1000;
  return database.prepare(`
    SELECT * FROM telemetry_records WHERE log_id = ? ORDER BY recorded_at ASC LIMIT ?
  `).all(logId, limit);
}

module.exports = {
  listParameters,
  saveParameters,
  createFlightLog,
  finishFlightLog,
  listFlightLogs,
  getFlightLog,
  saveTelemetry,
  flushTelemetry,
  getTelemetryQueueStatus,
  listTelemetry,
  close: () => {
    clearInterval(telemetryFlushTimer);
    while (pendingTelemetryRecords.length > 0) {
      if (!flushTelemetry()) throw new Error('Telemetry yang belum tersimpan masih tertahan di antrean.');
    }
    if (database.open) database.close();
  }
};

const telemetryFlushTimer = setInterval(flushTelemetry, 250);
telemetryFlushTimer.unref();
