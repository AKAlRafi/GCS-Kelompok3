const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const database = require('../db');
const config = require('../config');
const tracker = require('./stateTracker');
const nav = require('./navigasiDrone');
const telemetry = require('./telemetry_service');

const SUPPORTED_COMMANDS = new Set([16, 19, 20, 21, 22, 115, 178, 183, 203]);
const NAV_COMMANDS = new Set([16, 19, 21, 22]);

function apiError(message, status = 400, code = 'INVALID_MISSION') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function safeName(name) {
  return String(name || 'misi').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'misi';
}

function waypointRow(waypoint, index) {
  const row = {
    seq: index,
    current: index === 0 ? 1 : 0,
    frame: Number(waypoint.frame ?? 3),
    command: Number(waypoint.command ?? 16),
    param1: Number(waypoint.param1 ?? 0),
    param2: Number(waypoint.param2 ?? 0),
    param3: Number(waypoint.param3 ?? 0),
    param4: Number(waypoint.param4 ?? 0),
    lat: Number(waypoint.lat ?? waypoint.latitude ?? 0),
    lon: Number(waypoint.lon ?? waypoint.longitude ?? 0),
    alt: Number(waypoint.alt ?? waypoint.altitude ?? 0),
    autocontinue: Number(waypoint.autocontinue ?? 1)
  };
  const numbers = Object.values(row).every(Number.isFinite);
  if (!numbers || !SUPPORTED_COMMANDS.has(row.command)) throw apiError(`Waypoint ${index} memiliki kolom angka atau command yang tidak valid.`);
  if (row.frame < 0 || row.frame > 255 || ![0, 1].includes(row.current) || ![0, 1].includes(row.autocontinue)) {
    throw apiError(`Waypoint ${index} memiliki frame/current/autocontinue yang tidak valid.`);
  }
  if (row.lat < -90 || row.lat > 90 || row.lon < -180 || row.lon > 180) throw apiError(`Koordinat waypoint ${index} di luar batas bumi.`);
  if (NAV_COMMANDS.has(row.command)) {
    if (row.lat === 0 && row.lon === 0) throw apiError(`Waypoint navigasi ${index} tidak boleh berada di koordinat (0, 0).`);
    if (row.alt < 1 || row.alt > config.maxAltitude) throw apiError(`Ketinggian waypoint ${index} harus antara 1 dan ${config.maxAltitude} meter.`);
  }
  return row;
}

function parseWaypointText(text) {
  if (typeof text !== 'string') throw apiError('Isi file misi harus berupa teks.');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.shift()?.trim() !== 'QGC WPL 110') throw apiError('Header file wajib QGC WPL 110.');
  if (lines.length === 0 || lines.length > config.maxWaypoints) throw apiError(`Jumlah waypoint harus antara 1 dan ${config.maxWaypoints}.`);
  return lines.map((line, index) => {
    const columns = line.trim().split('\t');
    if (columns.length !== 12 || columns.some((column) => !column.trim())) throw apiError(`Baris waypoint ${index} wajib memiliki tepat 12 kolom terisi.`);
    const values = columns.map(Number);
    if (!values.every(Number.isFinite) || values[0] !== index) throw apiError(`Nomor urut atau nilai pada baris waypoint ${index} tidak valid.`);
    const [seq, current, frame, command, param1, param2, param3, param4, lat, lon, alt, autocontinue] = values;
    return waypointRow({ seq, current, frame, command, param1, param2, param3, param4, lat, lon, alt, autocontinue }, index);
  });
}

function waypointFileText(waypoints) {
  return ['QGC WPL 110', ...waypoints.map((wp) => [
    wp.seq, wp.current, wp.frame, wp.command, wp.param1, wp.param2, wp.param3,
    wp.param4, wp.lat, wp.lon, wp.alt, wp.autocontinue
  ].join('\t'))].join('\n') + '\n';
}

function summarize(waypoints) {
  let total = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1]; const b = waypoints[i];
    if (NAV_COMMANDS.has(a.command) && NAV_COMMANDS.has(b.command)) {
      total += nav.hitungJarakMeter(a.lat, a.lon, b.lat, b.lon);
    }
  }
  const speed = Number(process.env.MISSION_ESTIMATED_SPEED_MPS || 5);
  return { totalDistanceM: Number(total.toFixed(2)), estimatedFlightTimeS: speed > 0 ? Number((total / speed).toFixed(1)) : 0 };
}

function storeMission(name, waypoints, rawText) {
  fs.mkdirSync(config.missionFolder, { recursive: true });
  const summary = summarize(waypoints);
  const safe = safeName(name);
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}.waypoint`;
  const filePath = path.join(config.missionFolder, fileName);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, rawText || waypointFileText(waypoints), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, filePath);
    const id = database.createMission({ name: safe, fileName, waypointCount: waypoints.length,
      totalDistanceM: summary.totalDistanceM, estimatedFlightTimeS: summary.estimatedFlightTimeS });
    return { id, name: safe, file_name: fileName, waypoint_count: waypoints.length,
      total_distance_m: summary.totalDistanceM, estimated_flight_time_s: summary.estimatedFlightTimeS };
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); fs.rmSync(filePath, { force: true }); } catch (cleanupError) { console.error('Gagal membersihkan file misi sementara:', cleanupError.message); }
    throw error;
  }
}

function createMission(body) {
  const source = Array.isArray(body) ? body : body?.waypoints;
  if (!Array.isArray(source) || source.length === 0 || source.length > config.maxWaypoints) throw apiError(`waypoints harus berisi 1 sampai ${config.maxWaypoints} titik.`);
  const waypoints = source.map(waypointRow);
  return storeMission(body?.name || 'misi', waypoints);
}

function importMission(rawText, name) {
  const waypoints = parseWaypointText(rawText);
  return storeMission(name || 'impor', waypoints, `${rawText.trim()}\n`);
}

function getStoredMissionFile(id) {
  const mission = database.getMission(id);
  if (!mission) throw apiError('Misi tidak ditemukan.', 404, 'MISSION_NOT_FOUND');
  const filePath = path.resolve(config.missionFolder, mission.file_name);
  if (path.dirname(filePath) !== path.resolve(config.missionFolder) || !fs.existsSync(filePath)) throw apiError('File misi tidak ditemukan.', 404, 'MISSION_FILE_NOT_FOUND');
  return { mission, filePath, fileName: mission.file_name };
}

function readMission(id) {
  const { mission, filePath } = getStoredMissionFile(id);
  const waypoints = parseWaypointText(fs.readFileSync(filePath, 'utf8'));
  const details = waypoints.map((waypoint, index) => {
    const previous = waypoints[index - 1];
    const next = waypoints[index + 1];
    const leg = previous && NAV_COMMANDS.has(previous.command) && NAV_COMMANDS.has(waypoint.command)
      ? { distance_m: Number(nav.hitungJarakMeter(previous.lat, previous.lon, waypoint.lat, waypoint.lon).toFixed(2)), bearing_deg: Number(nav.hitungArahBearing(previous.lat, previous.lon, waypoint.lat, waypoint.lon).toFixed(2)) }
      : { distance_m: 0, bearing_deg: null };
    const outgoingBearing = next && NAV_COMMANDS.has(waypoint.command) && NAV_COMMANDS.has(next.command)
      ? nav.hitungArahBearing(waypoint.lat, waypoint.lon, next.lat, next.lon) : null;
    const turn = previous && outgoingBearing !== null && leg.bearing_deg !== null
      ? nav.hitungSudutBelok(leg.bearing_deg, outgoingBearing)
      : null;
    return { ...waypoint, ...leg, turn };
  });
  return { ...mission, waypoints: details };
}

function getMissionFile(id) {
  const { filePath, fileName } = getStoredMissionFile(id);
  return { filePath, fileName };
}

function deleteMission(id) {
  const { mission, filePath } = getStoredMissionFile(id);
  try { fs.unlinkSync(filePath); }
  catch (error) { throw apiError(`File misi gagal dihapus: ${error.message}`, 500, 'MISSION_FILE_ERROR'); }
  database.deleteMission(id);
  return { ok: true, id: Number(id) };
}

function validateUploadedMission(waypoints) {
  const current = tracker.getState();
  if (!current.heartbeat_fresh) throw apiError('Heartbeat drone tidak ada atau lebih lama dari batas aman; upload ditolak.', 400, 'HEARTBEAT_STALE');
  if (current.home_lat == null || current.home_lon == null
    || !Number.isFinite(Number(current.home_lat)) || !Number.isFinite(Number(current.home_lon))
    || (Number(current.home_lat) === 0 && Number(current.home_lon) === 0)) throw apiError('Koordinat Home belum diterima atau tidak valid.', 400, 'HOME_NOT_LOCKED');
  for (const [index, wp] of waypoints.entries()) {
    if (NAV_COMMANDS.has(wp.command) && nav.hitungJarakMeter(current.home_lat, current.home_lon, wp.lat, wp.lon) > config.maxMissionDistanceFromHome) {
      throw apiError(`Waypoint ${index} lebih jauh dari batas ${config.maxMissionDistanceFromHome} meter dari Home.`, 400, 'MISSION_OUT_OF_RANGE');
    }
  }
}

function checkPreflight() {
  const state = tracker.getState();
  const reasons = [];
  if (!state.heartbeat_fresh) reasons.push(`Heartbeat drone tidak ada atau lebih lama dari ${config.heartbeatStaleMs / 1000} detik.`);
  if (!Number.isFinite(Number(state.gps_fix_type)) || Number(state.gps_fix_type) < 3) reasons.push('GPS belum mencapai 3D Fix.');
  if (!Number.isFinite(Number(state.satellites_visible)) || Number(state.satellites_visible) < 6) reasons.push('Jumlah satelit GPS kurang dari 6.');
  const hdop = Number(state.hdop ?? state.eph);
  if (!Number.isFinite(hdop) || hdop > 2.5) reasons.push('HDOP GPS harus tersedia dan tidak lebih dari 2,5.');
  if (!Number.isFinite(Number(state.battery_percent)) || Number(state.battery_percent) < config.minimumBatteryPercent) reasons.push(`Baterai harus tersedia dan minimal ${config.minimumBatteryPercent}%.`);
  if (state.home_lat == null || state.home_lon == null || !Number.isFinite(Number(state.home_lat))
    || !Number.isFinite(Number(state.home_lon)) || (Number(state.home_lat) === 0 && Number(state.home_lon) === 0)) reasons.push('Koordinat Home belum terkunci atau tidak valid.');
  if (!config.allowedFlightModes.includes('AUTO')) reasons.push('Mode AUTO belum dimasukkan ke ALLOWED_FLIGHT_MODES.');
  if (reasons.length) throw apiError(`Pra-terbang ditolak: ${reasons.join(' ')}`, 400, 'PREARM_FAILED');
  return state;
}

async function uploadMissionToDrone(id) {
  const mission = readMission(id);
  const rows = mission.waypoints;
  validateUploadedMission(rows);
  const waypoints = rows.map(({ seq, frame, command, current, autocontinue, param1, param2, param3, param4, lat, lon, alt }) =>
    ({ seq, frame, command, current, autocontinue, param1, param2, param3, param4, lat, lon, alt }));
  const ack = await telemetry.sendCommand('upload_mission', { waypoints });
  return { ...ack, mission_id: Number(id), waypoint_count: waypoints.length };
}

function requireAcceptedCommand(result, label) {
  if (result?.ok === false) throw apiError(result.error || `Perintah ${label} ditolak.`, 502, 'COMMAND_REJECTED');
}

async function waitForTakeoff(targetAltitude) {
  const timeoutAt = Date.now() + 45000;
  while (Date.now() < timeoutAt) {
    const state = tracker.getState();
    if (state.armed === false) throw apiError('Drone kembali DISARMED saat takeoff.', 409, 'TAKEOFF_ABORTED');
    if (Number.isFinite(Number(state.rel_alt)) && Number(state.rel_alt) >= Math.min(2, targetAltitude * 0.5)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw apiError('Drone belum mencapai ketinggian aman setelah perintah takeoff.', 504, 'TAKEOFF_TIMEOUT');
}

async function startMission(id, reportProgress = () => {}) {
  const state = checkPreflight();
  reportProgress({ mission_id: Number(id), stage: 'PRE_ARM', active_waypoint: 0 });
  const mission = readMission(id);
  const upload = await uploadMissionToDrone(id);
  requireAcceptedCommand(upload, 'upload misi');

  if (state.armed !== true) {
    reportProgress({ mission_id: Number(id), stage: 'ARMING', active_waypoint: 0 });
    requireAcceptedCommand(await telemetry.sendCommand('arm', {}), 'arm');
  }

  const firstWaypoint = mission.waypoints[0];
  const isOnGround = !Number.isFinite(Number(state.rel_alt)) || Number(state.rel_alt) < 1;
  if (isOnGround && firstWaypoint?.command !== 22) {
    if (!config.allowedFlightModes.includes('GUIDED')) {
      throw apiError('Mode GUIDED harus diizinkan untuk takeoff sebelum misi.', 503, 'GUIDED_MODE_NOT_CONFIGURED');
    }
    const targetAltitude = Math.min(config.maxAltitude, Math.max(10, Number(firstWaypoint?.alt) || 10));
    requireAcceptedCommand(await telemetry.sendCommand('set_mode', { mode: 'GUIDED' }), 'mode GUIDED');
    reportProgress({ mission_id: Number(id), stage: 'TAKING_OFF', active_waypoint: 0 });
    requireAcceptedCommand(await telemetry.sendCommand('takeoff', { altitude_m: targetAltitude }), 'takeoff');
    await waitForTakeoff(targetAltitude);
  }

  requireAcceptedCommand(await telemetry.sendCommand('set_mode', { mode: 'AUTO' }), 'mode AUTO');
  reportProgress({ mission_id: Number(id), stage: 'STARTING_MISSION', active_waypoint: 0 });
  const result = await telemetry.sendCommand('start_mission', { mission_id: Number(id) });
  requireAcceptedCommand(result, 'mulai misi');
  reportProgress({ mission_id: Number(id), stage: 'NAVIGATING_WAYPOINT', active_waypoint: 0,
    waypoint_count: mission.waypoints.length });
  return result;
}

module.exports = {
  createMission, importMission, listMissions: () => 
  database.listMissions(), 
  readMission,
  getMissionFile, 
  deleteMission, 
  parseWaypointText, 
  waypointFileText, 
  checkPreflight,
  uploadMissionToDrone, 
  startMission
};
