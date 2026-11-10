import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const folder = path.dirname(fileURLToPath(import.meta.url))
const dataFolder = path.join(folder, 'data')

mkdirSync(dataFolder, { recursive: true })

const db = new Database(path.join(dataFolder, 'gcs.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
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
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
`)

const defaultParameters = [
  ['min_battery', 20, '%', 'Batas baterai minimum untuk peringatan'],
  ['max_altitude', 120, 'm', 'Batas ketinggian untuk peringatan'],
  ['max_speed', 25, 'm/s', 'Batas kecepatan untuk peringatan'],
]

const addDefault = db.prepare(`
  INSERT OR IGNORE INTO parameters (name, value, unit, description)
  VALUES (?, ?, ?, ?)
`)

for (const parameter of defaultParameters) addDefault.run(...parameter)

export function getDb() {
  return db
}

export function listParameters() {
  return db.prepare('SELECT * FROM parameters ORDER BY name').all()
}

export function saveParameters(parameters) {
  const updateParameter = db.prepare(`
    UPDATE parameters
    SET value = ?, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `)

  const saveAll = db.transaction(items => {
    for (const item of items) {
      const result = updateParameter.run(Number(item.value), item.name)
      if (result.changes === 0) {
        throw new Error(`Parameter tidak dikenal: ${item.name}`)
      }
    }
  })

  saveAll(parameters)
  return listParameters()
}

export function createFlightLog({ name, fileName, filePath, startedAt = new Date().toISOString() }) {
  const result = db.prepare(`
    INSERT INTO flight_logs (name, file_name, file_path, started_at)
    VALUES (?, ?, ?, ?)
  `).run(name, fileName, filePath, startedAt)

  return Number(result.lastInsertRowid)
}

export function finishFlightLog(id, endedAt = new Date().toISOString()) {
  return db.prepare(`
    UPDATE flight_logs SET ended_at = ? WHERE id = ?
  `).run(endedAt, id).changes > 0
}

export function listFlightLogs() {
  return db.prepare(`
    SELECT id, name, file_name, started_at, ended_at, created_at
    FROM flight_logs ORDER BY id DESC
  `).all()
}

export function getFlightLog(id) {
  return db.prepare('SELECT * FROM flight_logs WHERE id = ?').get(id)
}

export function saveTelemetry(record) {
  const insert = db.prepare(`
    INSERT INTO telemetry_records (
      log_id, recorded_at, latitude, longitude, altitude, relative_altitude,
      ground_speed, air_speed, roll, pitch, yaw, heading, battery_percent,
      flight_mode, armed
    ) VALUES (
      @log_id, @recorded_at, @latitude, @longitude, @altitude, @relative_altitude,
      @ground_speed, @air_speed, @roll, @pitch, @yaw, @heading, @battery_percent,
      @flight_mode, @armed
    )
  `)

  return insert.run({
    log_id: record.log_id ?? null,
    recorded_at: record.recorded_at ?? new Date().toISOString(),
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    altitude: record.altitude ?? null,
    relative_altitude: record.relative_altitude ?? null,
    ground_speed: record.ground_speed ?? null,
    air_speed: record.air_speed ?? null,
    roll: record.roll ?? null,
    pitch: record.pitch ?? null,
    yaw: record.yaw ?? null,
    heading: record.heading ?? null,
    battery_percent: record.battery_percent ?? null,
    flight_mode: record.flight_mode ?? null,
    armed: record.armed == null ? null : Number(Boolean(record.armed)),
  }).lastInsertRowid
}

export function closeDb() {
  if (db.open) db.close()
}
