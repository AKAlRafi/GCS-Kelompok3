let counter = 0;

export const UGM_HOME = Object.freeze({ lat: -7.7707, lon: 110.3775 });

export const newId = () => `wp-${Date.now()}-${counter++}`;

export function normalizeCoordinates(value, axis) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const limit = axis === 'lat' ? 90 : 180;
  const degrees = Math.abs(number) > limit ? number / 1e7 : number;
  return Math.abs(degrees) <= limit ? degrees : null;
}

export const normalizeWp = (list = []) => list.map((waypoint) => ({
  ...waypoint,
  id: newId(),
  lat: normalizeCoordinates(waypoint.lat ?? waypoint.latitude, 'lat'),
  lon: normalizeCoordinates(waypoint.lon ?? waypoint.lng ?? waypoint.longitude, 'lon'),
  alt: Number(waypoint.alt ?? waypoint.altitude ?? 10),
  command: Number(waypoint.command ?? 16),
})).filter((waypoint) => waypoint.lat !== null && waypoint.lon !== null);

export function normalizeTelemetry(input) {
  const outer = input && typeof input === 'object' ? input : {};
  const payload = outer.telemetry && typeof outer.telemetry === 'object'
    ? outer.telemetry
    : outer.data && typeof outer.data === 'object' ? outer.data : outer;
  const position = payload.position ?? payload.gps ?? {};
  const pick = (...values) => values.find((value) => value !== undefined && value !== null);
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  let lat = normalizeCoordinates(pick(payload.lat, payload.latitude, position.lat, position.latitude), 'lat');
  let lon = normalizeCoordinates(pick(payload.lon, payload.lng, payload.longitude, position.lon, position.lng, position.longitude), 'lon');
  if (lat === 0 && lon === 0) {
    lat = null;
    lon = null;
  }
  const alt = numberOrNull(pick(payload.alt, payload.absolute_altitude, payload.altitude, position.alt));
  const relAlt = numberOrNull(pick(payload.rel_alt, payload.relative_alt, payload.relative_altitude, position.relative_alt));
  const yaw = numberOrNull(pick(payload.yaw, payload.attitude?.yaw));

  return {
    ...payload,
    ...(lat !== null ? { lat } : {}),
    ...(lon !== null ? { lon } : {}),
    ...(alt !== null ? { alt } : {}),
    ...(relAlt !== null ? { rel_alt: relAlt } : {}),
    ...(numberOrNull(pick(payload.roll, payload.attitude?.roll)) !== null
      ? { roll: numberOrNull(pick(payload.roll, payload.attitude?.roll)) } : {}),
    ...(numberOrNull(pick(payload.pitch, payload.attitude?.pitch)) !== null
      ? { pitch: numberOrNull(pick(payload.pitch, payload.attitude?.pitch)) } : {}),
    ...(yaw !== null ? { yaw } : {}),
    ...(numberOrNull(pick(payload.heading, payload.course, yaw)) !== null
      ? { heading: numberOrNull(pick(payload.heading, payload.course, yaw)) } : {}),
    ...(numberOrNull(pick(payload.groundspeed, payload.ground_speed, payload.speed)) !== null
      ? { groundspeed: numberOrNull(pick(payload.groundspeed, payload.ground_speed, payload.speed)) } : {}),
    ...(numberOrNull(pick(payload.airspeed, payload.air_speed)) !== null
      ? { airspeed: numberOrNull(pick(payload.airspeed, payload.air_speed)) } : {}),
    ...(numberOrNull(pick(payload.battery_percent, payload.battery_remaining)) !== null
      ? { battery_percent: numberOrNull(pick(payload.battery_percent, payload.battery_remaining)) } : {}),
    ...(numberOrNull(pick(payload.gps_fix_type, payload.fix_type)) !== null
      ? { gps_fix_type: numberOrNull(pick(payload.gps_fix_type, payload.fix_type)) } : {}),
    ...(numberOrNull(pick(payload.satellites_visible, payload.satellite_count, payload.gps_satellites)) !== null
      ? { satellites_visible: numberOrNull(pick(payload.satellites_visible, payload.satellite_count, payload.gps_satellites)) } : {}),
    ...(numberOrNull(pick(payload.hdop, payload.eph)) !== null
      ? { hdop: numberOrNull(pick(payload.hdop, payload.eph)) } : {}),
  };
}
