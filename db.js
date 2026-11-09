import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const root = path.dirname(fileURLToPath(import.meta.url))
const folder = path.join(root, 'data')
mkdirSync(folder, { recursive: true })

const db = new Database(path.join(folder, 'gcs.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS parameters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    updated TEXT NOT NULL
  );
`)

const defaults = [
  ['min_battery', 20, '%'],
  ['max_altitude', 120, 'm'],
  ['max_speed', 25, 'm/s'],
]

const insertDefault = db.prepare('INSERT OR IGNORE INTO parameters(name, value, unit, updated) VALUES(?,?,?,?)')
for (const parameter of defaults) insertDefault.run(...parameter, new Date().toISOString())

export function getDb() {
  return db
}

export function listParameters() {
  return db.prepare('SELECT * FROM parameters ORDER BY id').all()
}

export function saveParameters(values) {
  const update = db.prepare('UPDATE parameters SET value=?, updated=? WHERE name=?')
  const save = db.transaction(items => {
    for (const item of items) update.run(Number(item.value), new Date().toISOString(), item.name)
  })
  save(values)
  return listParameters()
}
