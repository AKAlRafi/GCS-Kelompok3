const config = require('../config');

const EMPTY_PAYLOAD_COMMANDS = new Set(['arm', 'disarm', 'rtl', 'land', 'download_mission', 'clear_mission', 'start_mission', 'pause_mission', 'resume_mission']);

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
    const allowed = ['lat', 'lon', 'alt', 'frame', 'command', 'current', 'autocontinue', 'param1', 'param2', 'param3', 'param4'];
    allowOnlyKeys(waypoint, allowed, `Waypoint ${index}`);
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
    const optional = {};
    for (const key of ['frame', 'command', 'current', 'autocontinue', 'param1', 'param2', 'param3', 'param4']) {
      if (waypoint[key] === undefined) continue;
      if (typeof waypoint[key] !== 'number' || !Number.isFinite(waypoint[key])) throw invalidCommand(`Field ${key} pada waypoint ${index} harus berupa angka.`);
      optional[key] = waypoint[key];
    }
    const command = optional.command ?? 16;
    if (![16, 19, 20, 21, 22, 115, 178, 183, 203].includes(command)) throw invalidCommand(`Command waypoint ${index} tidak didukung.`);
    if ([16, 21, 22].includes(command) && (lat === 0 && lon === 0 || alt < 1)) throw invalidCommand(`Waypoint navigasi ${index} membutuhkan koordinat valid dan ketinggian minimal 1 meter.`);
    if (optional.frame !== undefined && (!Number.isInteger(optional.frame) || optional.frame < 0 || optional.frame > 255)) throw invalidCommand(`Frame waypoint ${index} tidak valid.`);
    if (optional.current !== undefined && ![0, 1].includes(optional.current)) throw invalidCommand(`Current waypoint ${index} harus 0 atau 1.`);
    if (optional.autocontinue !== undefined && ![0, 1].includes(optional.autocontinue)) throw invalidCommand(`Autocontinue waypoint ${index} harus 0 atau 1.`);
    return { lat, lon, alt, ...optional };
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
  if (type === 'guided_goto') {
    allowOnlyKeys(payload, ['lat', 'lon', 'alt'], 'Payload guided_goto');
    const target = { lat: payload.lat, lon: payload.lon, alt: payload.alt };
    if (![target.lat, target.lon, target.alt].every((value) => typeof value === 'number' && Number.isFinite(value))) throw invalidCommand('guided_goto membutuhkan lat, lon, dan alt numerik.');
    if (target.lat < -90 || target.lat > 90 || target.lon < -180 || target.lon > 180 || (target.lat === 0 && target.lon === 0)) throw invalidCommand('Koordinat guided_goto tidak valid.');
    if (target.alt < 1 || target.alt > config.maxAltitude) throw invalidCommand(`Ketinggian guided_goto harus antara 1 dan ${config.maxAltitude} meter.`);
    return { type, payload: target };
  }
  if (type === 'condition_yaw') {
    allowOnlyKeys(payload, ['angle_deg', 'speed_deg_s', 'direction', 'relative'], 'Payload condition_yaw');
    const { angle_deg, speed_deg_s, direction, relative } = payload;
    if (typeof angle_deg !== 'number' || !Number.isFinite(angle_deg) || typeof speed_deg_s !== 'number' || !Number.isFinite(speed_deg_s)
      || ![-1, 1].includes(direction) || typeof relative !== 'boolean') throw invalidCommand('Payload condition_yaw tidak valid.');
    if (speed_deg_s <= 0 || speed_deg_s > 180 || angle_deg < 0 || angle_deg > (relative ? 180 : 359.99)) throw invalidCommand('Sudut atau kecepatan putar condition_yaw di luar batas.');
    return { type, payload: { angle_deg, speed_deg_s, direction, relative } };
  }
  if (type === 'change_speed') {
    allowOnlyKeys(payload, ['speed_mps'], 'Payload change_speed');
    if (typeof payload.speed_mps !== 'number' || !Number.isFinite(payload.speed_mps) || payload.speed_mps < 0.5 || payload.speed_mps > 25) throw invalidCommand('speed_mps harus antara 0,5 dan 25 m/s.');
    return { type, payload: { speed_mps: payload.speed_mps } };
  }
  throw invalidCommand(`Jenis perintah ${type || '(kosong)'} tidak didukung.`, 400, 'COMMAND_UNSUPPORTED');
}

module.exports = { validateCommand };
