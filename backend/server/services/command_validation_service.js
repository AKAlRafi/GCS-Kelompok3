const config = require('../config');

const EMPTY_PAYLOAD_COMMANDS = new Set(['arm', 'disarm', 'rtl', 'download_mission', 'clear_mission']);

function invalidCommand(message, status = 400, code = 'INVALID_COMMAND') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function allowOnlyKeys(object, allowedKeys, label) {
  const extraKeys = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) throw invalidCommand(`${label} berisi field yang tidak dikenal.`);
}

function requireEmptyPayload(payload, type) {
  if (Object.keys(payload).length > 0) {
    throw invalidCommand(`Perintah ${type} tidak menerima payload tambahan.`);
  }
  return {};
}

function validateWaypoints(payload) {
  allowOnlyKeys(payload, ['waypoints'], 'Payload misi');
  if (!Array.isArray(payload.waypoints) || payload.waypoints.length === 0) {
    throw invalidCommand('Waypoints harus berupa array yang tidak kosong.');
  }
  if (payload.waypoints.length > config.maxWaypoints) {
    throw invalidCommand(`Jumlah waypoint melebihi batas ${config.maxWaypoints}.`);
  }

  const waypoints = payload.waypoints.map((waypoint, index) => {
    if (!isPlainObject(waypoint)) throw invalidCommand(`Waypoint ${index} harus berupa objek.`);
    allowOnlyKeys(waypoint, ['lat', 'lon', 'alt'], `Waypoint ${index}`);
    const { lat, lon, alt } = waypoint;
    if (![lat, lon, alt].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw invalidCommand(`Waypoint ${index} harus memiliki lat, lon, dan alt berupa angka.`);
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw invalidCommand(`Koordinat waypoint ${index} di luar batas bumi.`);
    }
    if (alt < 0 || alt > config.maxAltitude) {
      throw invalidCommand(`Ketinggian waypoint ${index} di luar batas 0–${config.maxAltitude} meter.`);
    }
    return { lat, lon, alt };
  });

  return { waypoints };
}

function validateCommand(commandType, payload) {
  if (typeof commandType !== 'string') throw invalidCommand('Field type harus berupa string.');
  const type = commandType.trim().toLowerCase();
  if (!isPlainObject(payload)) throw invalidCommand('Field payload harus berupa objek JSON.');

  if (EMPTY_PAYLOAD_COMMANDS.has(type)) {
    return { type, payload: requireEmptyPayload(payload, type) };
  }
  if (type === 'upload_mission') return { type, payload: validateWaypoints(payload) };
  if (type === 'takeoff') {
    allowOnlyKeys(payload, ['altitude_m'], 'Payload takeoff');
    const altitude = payload.altitude_m;
    if (typeof altitude !== 'number' || !Number.isFinite(altitude)
        || altitude < 1 || altitude > config.maxAltitude) {
      throw invalidCommand(`altitude_m harus antara 1 dan ${config.maxAltitude} meter.`);
    }
    return { type, payload: { altitude_m: altitude } };
  }
  if (type === 'set_mode') {
    allowOnlyKeys(payload, ['mode'], 'Payload set_mode');
    if (config.allowedFlightModes.length === 0) {
      throw invalidCommand('ALLOWED_FLIGHT_MODES belum diatur untuk jenis drone ini.', 503, 'FLIGHT_MODES_NOT_CONFIGURED');
    }
    if (typeof payload.mode !== 'string' || !config.allowedFlightModes.includes(payload.mode.toUpperCase())) {
      throw invalidCommand('Mode terbang tidak ada dalam daftar mode yang diizinkan.');
    }
    return { type, payload: { mode: payload.mode.toUpperCase() } };
  }
  throw invalidCommand(`Jenis perintah ${type || '(kosong)'} tidak didukung.`, 400, 'COMMAND_UNSUPPORTED');
}

module.exports = { validateCommand };
