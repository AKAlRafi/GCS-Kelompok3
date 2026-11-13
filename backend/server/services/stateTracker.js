const { hitungArahBearing, hitungJarakMeter, hitungSelisihKetinggian, hitungSudutBelok } = require('./navigasiDrone');
const config = require('../config');

let state = {};
let listener = () => {};

function setStateListener(onUpdate) {
  listener = typeof onUpdate === 'function' ? onUpdate : () => {};
}

function updateTelemetry(input, receivedAt = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Telemetry harus berupa objek.');
  const next = { ...input };
  const aliases = {
    lat: ['latitude'], lon: ['longitude'], alt: ['absolute_altitude'], rel_alt: ['relative_altitude'],
    home_lat: ['home_latitude'], home_lon: ['home_longitude'], groundspeed: ['ground_speed'],
    airspeed: ['air_speed'], satellites_visible: ['gps_satellites', 'satellite_count'], hdop: ['eph']
  };
  for (const [canonical, alternatives] of Object.entries(aliases)) {
    if (next[canonical] !== undefined) continue;
    const alternate = alternatives.find((key) => next[key] !== undefined);
    if (alternate) next[canonical] = next[alternate];
  }
  state = {
    ...state,
    ...next,
    heartbeat_at: next.heartbeat_timestamp != null && Number.isFinite(Number(next.heartbeat_timestamp))
      ? Number(next.heartbeat_timestamp) : state.heartbeat_at,
    received_at: new Date(receivedAt).toISOString()
  };
  listener(getState());
  return getState();
}

function getState(now = Date.now()) {
  const current = { ...state };
  current.heartbeat_age_ms = state.heartbeat_at != null ? now - state.heartbeat_at : null;
  current.heartbeat_fresh = current.heartbeat_age_ms !== null && current.heartbeat_age_ms >= 0
    && current.heartbeat_age_ms <= config.heartbeatStaleMs;
  return current;
}

function resetState() { state = {}; }

function calculateTo(target) {
  const current = getState();
  if (![current.lat, current.lon, current.heading, current.rel_alt].every((value) => Number.isFinite(Number(value)))) {
    throw new Error('Data posisi, heading, atau ketinggian drone belum lengkap.');
  }
  const distance_m = hitungJarakMeter(current.lat, current.lon, target.lat, target.lon);
  const bearing_deg = hitungArahBearing(current.lat, current.lon, target.lat, target.lon);
  const turn = hitungSudutBelok(current.heading, bearing_deg);
  return {
    distance_m: Number(distance_m.toFixed(2)),
    bearing_deg: Number(bearing_deg.toFixed(2)),
    ...turn,
    altitude_error_meter: hitungSelisihKetinggian(current.rel_alt, target.alt)
  };
}

module.exports = { updateTelemetry, getState, resetState, setStateListener, calculateTo };
