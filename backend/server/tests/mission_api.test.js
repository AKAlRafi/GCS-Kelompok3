const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-mission-test-'));
process.env.DB_PATH = path.join(tempFolder, 'gcs-test.db');
process.env.MISSION_DIR = path.join(tempFolder, 'missions');
process.env.ALLOWED_FLIGHT_MODES = 'AUTO,GUIDED';

const serverModule = require('../server');
const database = require('../db');
const tracker = require('../services/stateTracker');
const telemetry = require('../services/telemetry_service');
const navigation = require('../services/navigasiDrone');

let server;
let baseUrl;
const commands = [];
const realSendCommand = telemetry.sendCommand;

before(async () => {
  telemetry.sendCommand = async (type, payload) => {
    commands.push({ type, payload });
    if (type === 'takeoff') {
      tracker.updateTelemetry({ armed: true, rel_alt: 10, heartbeat_timestamp: Date.now() });
    }
    return { ok: true, id: `test-${commands.length}` };
  };
  server = serverModule.startServer({ host: '127.0.0.1', port: 0, connectRedis: false });
  await server.ready;
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/api`;
});

after(async () => {
  telemetry.sendCommand = realSendCommand;
  await server.stopServer();
  fs.rmSync(tempFolder, { recursive: true, force: true });
});

async function request(route, method = 'GET', body, contentType = 'application/json') {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': contentType },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body
  });
  const type = response.headers.get('content-type') || '';
  return { response, data: type.includes('application/json') ? response.json() : response.text() };
}

function provideHealthyTelemetry() {
  tracker.resetState();
  telemetry.processTelemetryMessage(JSON.stringify({
    lat: -7.77, lon: 110.37, alt: 130, rel_alt: 10, heading: 90,
    armed: false, flight_mode: 'GUIDED', battery_percent: 85,
    gps_fix_type: 3, satellites_visible: 10, hdop: 1.2,
    home_lat: -7.77, home_lon: 110.37,
    heartbeat_timestamp: Date.now()
  }));
}

test('navigation calculations produce a right turn and correct horizontal distance', () => {
  const turn = navigation.hitungSudutBelok(90, 180);
  assert.equal(turn.sudut_belok, 90);
  assert.equal(turn.arah, 'KANAN');
  assert.ok(navigation.hitungJarakMeter(0, 0, 0, 0.001) > 100);
  assert.equal(Math.round(navigation.hitungArahBearing(0, 0, 0, 0.001)), 90);
});

test('mission create, QGC WPL detail, download, import, and delete work', async () => {
  const points = [
    { command: 22, lat: -7.77, lon: 110.37, alt: 10 },
    { command: 16, lat: -7.769, lon: 110.371, alt: 15 },
    { command: 19, lat: -7.768, lon: 110.372, alt: 15, param1: 10 },
    { command: 20, lat: 0, lon: 0, alt: 0 }
  ];
  const created = await request('/missions', 'POST', { name: 'uji misi', waypoints: points });
  assert.equal(created.response.status, 201);
  const createdData = await created.data;
  const id = createdData.mission.id;
  const detail = await request(`/missions/${id}`);
  const detailData = await detail.data;
  assert.equal(detailData.mission.waypoints.length, 4);
  assert.equal(detailData.mission.waypoints[1].command, 16);
  const downloaded = await fetch(`${baseUrl}/missions/${id}/download`);
  const text = await downloaded.text();
  assert.match(text, /^QGC WPL 110\n/);
  assert.equal(text.trimEnd().split('\n')[1].split('\t').length, 12);
  const imported = await request('/missions/import', 'POST', text, 'text/plain');
  assert.equal(imported.response.status, 201);
  const importedData = await imported.data;
  assert.equal(importedData.mission.waypoint_count, 4);
  const removed = await request(`/missions/${id}`, 'DELETE');
  assert.equal((await removed.data).ok, true);
});

test('mission WPL import rejects invalid header and column count', async () => {
  const bad = await request('/missions/import', 'POST', 'QGC WPL 110\n0\t1\t3\t16', 'text/plain');
  assert.equal(bad.response.status, 400);
});

test('mission multipart import accepts a .waypoint file', async () => {
  const boundary = 'gcs-boundary';
  const file = 'QGC WPL 110\n0\t1\t3\t16\t0\t0\t0\t0\t-7.77\t110.37\t10\t1\n';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rute.waypoint"\r\nContent-Type: text/plain\r\n\r\n${file}\r\n--${boundary}--\r\n`;
  const result = await request('/missions/import', 'POST', body, `multipart/form-data; boundary=${boundary}`);
  assert.equal(result.response.status, 201);
  assert.equal((await result.data).mission.waypoint_count, 1);
});

test('upload fails closed without a fresh heartbeat and locked home', async () => {
  tracker.resetState();
  const created = await request('/missions', 'POST', { waypoints: [{ lat: -7.77, lon: 110.37, alt: 10 }] });
  const id = (await created.data).mission.id;
  const upload = await request(`/missions/${id}/upload`, 'POST', {});
  assert.equal(upload.response.status, 400);
  assert.equal((await upload.data).code, 'HEARTBEAT_STALE');
});

test('start fails pre-arm when GPS readiness is not present', async () => {
  tracker.resetState();
  tracker.updateTelemetry({ armed: false, flight_mode: 'GUIDED', heartbeat_timestamp: Date.now(),
    battery_percent: 85, home_lat: -7.77, home_lon: 110.37 });
  const created = await request('/missions', 'POST', { waypoints: [{ lat: -7.77, lon: 110.37, alt: 10 }] });
  const id = (await created.data).mission.id;
  const result = await request(`/missions/${id}/start`, 'POST', {});
  assert.equal(result.response.status, 400);
  assert.match((await result.data).error, /GPS belum mencapai 3D Fix/);
});

test('preflight passes with telemetry and start publishes expected command sequence', async () => {
  provideHealthyTelemetry();
  const created = await request('/missions', 'POST', { waypoints: [{ lat: -7.77, lon: 110.37, alt: 10 }] });
  const id = (await created.data).mission.id;
  commands.length = 0;
  const started = await request(`/missions/${id}/start`, 'POST', {});
  assert.equal(started.response.status, 200);
  assert.deepEqual(commands.map((command) => command.type), ['upload_mission', 'arm', 'set_mode', 'start_mission']);
  assert.equal(commands[0].payload.waypoints[0].command, 16);
});

test('start on the ground arms and takes off in GUIDED before switching to AUTO', async () => {
  provideHealthyTelemetry();
  tracker.updateTelemetry({ rel_alt: 0 });
  const created = await request('/missions', 'POST', { waypoints: [{ lat: -7.769, lon: 110.371, alt: 12 }] });
  const id = (await created.data).mission.id;
  commands.length = 0;

  const started = await request(`/missions/${id}/start`, 'POST', {});

  assert.equal(started.response.status, 200);
  assert.deepEqual(commands.map((command) => command.type), [
    'upload_mission', 'arm', 'set_mode', 'takeoff', 'set_mode', 'start_mission'
  ]);
  assert.deepEqual(commands[3].payload, { altitude_m: 12 });
  assert.deepEqual(commands[4].payload, { mode: 'AUTO' });
});

test('ROTATE_YAW accepts a valid turn and sends CONDITION_YAW payload', async () => {
  provideHealthyTelemetry();
  const result = await request('/drone/maneuver', 'POST', {
    action: 'ROTATE_YAW', mode: 'relative', angle_deg: 90,
    direction: 'KANAN', speed_deg_s: 30
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(commands.at(-1), {
    type: 'condition_yaw',
    payload: { angle_deg: 90, speed_deg_s: 30, direction: 1, relative: true }
  });
});
