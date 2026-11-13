const { createClient } = require('redis');
const { randomUUID } = require('node:crypto');
const config = require('../config');
const flightLogs = require('./flight_log_service');
const stateTracker = require('./stateTracker');

const publisherClient = createClient({ url: config.redisUrl });
const subscriberClient = publisherClient.duplicate();
let latestTelemetry = {};
let onTelemetry = () => {};
let onMissionStarted = () => {};
let onMissionProgress = () => {};
let lastTelemetryReceivedAt = 0;
let isTelemetrySubscribed = false;
let isAckSubscribed = false;
let connectionPromise = null;
const pendingCommandAcks = new Map();
const maxCommandsAwaitingAck = 32;
const lastRedisErrorAt = new Map();
const telemetryNumberFields = [
  'lat', 'lon', 'alt', 'rel_alt', 'heading', 'roll', 'pitch', 'yaw',
  'airspeed', 'groundspeed', 'battery_percent', 'battery_voltage', 'timestamp',
  'climb_rate', 'gps_fix_type', 'satellites_visible', 'satellite_count', 'gps_satellites',
  'eph', 'hdop', 'home_lat', 'home_lon', 'home_latitude', 'home_longitude',
  'latitude', 'longitude', 'absolute_altitude', 'relative_altitude', 'ground_speed', 'air_speed',
  'heartbeat_timestamp'
];

for (const [name, client] of [['Redis', publisherClient], ['Redis subscriber', subscriberClient]]) {
  client.on('error', (error) => {
    const now = Date.now();
    if (now - (lastRedisErrorAt.get(name) || 0) < 5000) return;
    lastRedisErrorAt.set(name, now);
    console.error(`${name} error:`, error.message);
  });
}

function setTelemetryListener(listener) {
  onTelemetry = listener;
}

function setMissionStarter(listener) {
  onMissionStarted = typeof listener === 'function' ? listener : () => {};
}

function trackMission(id) {
  onMissionStarted(id);
}

function reportMissionProgress(progress) {
  onMissionProgress(progress);
}

function setMissionProgressListener(listener) {
  onMissionProgress = typeof listener === 'function' ? listener : () => {};
}

function validateTelemetry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Telemetry harus berupa objek JSON.');
  }

  const validatedTelemetry = {};
  for (const field of telemetryNumberFields) {
    if (data[field] === undefined) continue;
    if (data[field] !== null && (typeof data[field] !== 'number' || !Number.isFinite(data[field]))) {
      throw new Error(`Field telemetry ${field} harus berupa angka terbatas.`);
    }
    validatedTelemetry[field] = data[field];
  }
  if (validatedTelemetry.lat != null && (validatedTelemetry.lat < -90 || validatedTelemetry.lat > 90)) {
    throw new Error('Latitude telemetry di luar batas.');
  }
  if (validatedTelemetry.lon != null && (validatedTelemetry.lon < -180 || validatedTelemetry.lon > 180)) {
    throw new Error('Longitude telemetry di luar batas.');
  }
  if (validatedTelemetry.heading != null && (validatedTelemetry.heading < 0 || validatedTelemetry.heading > 360)) {
    throw new Error('Heading telemetry di luar batas.');
  }
  if (validatedTelemetry.battery_percent != null && (validatedTelemetry.battery_percent < 0 || validatedTelemetry.battery_percent > 100)) {
    throw new Error('Persentase baterai telemetry di luar batas.');
  }
  if (data.flight_mode !== undefined) {
    if (typeof data.flight_mode !== 'string' || data.flight_mode.length > 64) {
      throw new Error('Flight mode telemetry tidak valid.');
    }
    validatedTelemetry.flight_mode = data.flight_mode;
  }
  if (data.armed !== undefined) {
    if (data.armed !== null && typeof data.armed !== 'boolean') {
      throw new Error('Status armed telemetry harus berupa boolean.');
    }
    validatedTelemetry.armed = data.armed;
  }
  if (Object.keys(validatedTelemetry).length === 0) throw new Error('Telemetry tidak berisi field yang dikenal.');
  return validatedTelemetry;
}

function processTelemetryMessage(message) {
  try {
    const data = validateTelemetry(JSON.parse(message));
    latestTelemetry = { ...latestTelemetry, ...data, received_at: new Date().toISOString() };
    latestTelemetry = stateTracker.updateTelemetry(latestTelemetry);
    lastTelemetryReceivedAt = Date.now();
    flightLogs.saveTelemetry(latestTelemetry);
    onTelemetry(latestTelemetry);
    return true;
  } catch (error) {
    console.error('Data telemetry tidak bisa diproses:', error.message);
    return false;
  }
}

function processAcknowledgement(message) {
  try {
    const acknowledgement = JSON.parse(message);
    if (!acknowledgement || typeof acknowledgement !== 'object' || Array.isArray(acknowledgement)) return;
    const commandId = acknowledgement.id || acknowledgement.command_id;
    const pendingCommand = pendingCommandAcks.get(commandId);
    if (!pendingCommand || typeof acknowledgement.ok !== 'boolean') return;
    clearTimeout(pendingCommand.timeout);
    pendingCommandAcks.delete(commandId);
    pendingCommand.resolve(acknowledgement);
  } catch (error) {
    console.error('Balasan perintah tidak bisa diproses:', error.message);
  }
}

async function connectTelemetry() {
  if (connectionPromise) return connectionPromise;
  connectionPromise = (async () => {
    if (!publisherClient.isOpen) await publisherClient.connect();
    if (!subscriberClient.isOpen) await subscriberClient.connect();
    if (!isTelemetrySubscribed) {
      // Telemetry dari engine disimpan saat log aktif lalu diteruskan ke WebSocket.
      await subscriberClient.subscribe(config.redisChannel, processTelemetryMessage);
      isTelemetrySubscribed = true;
    }
    if (!isAckSubscribed) {
      await subscriberClient.subscribe(config.redisAckChannel, processAcknowledgement);
      isAckSubscribed = true;
    }
  })();
  try {
    await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

async function sendCommand(type, payload = {}) {
  if (!config.commandsEnabled) {
    const error = new Error('Pengiriman perintah sedang dinonaktifkan.');
    error.code = 'COMMANDS_DISABLED';
    throw error;
  }
  if (!publisherClient.isReady || !isAckSubscribed) {
    const error = new Error('Koneksi Redis untuk perintah belum siap.');
    error.code = 'REDIS_UNAVAILABLE';
    throw error;
  }
  if (pendingCommandAcks.size >= maxCommandsAwaitingAck) {
    const error = new Error('Terlalu banyak perintah yang masih menunggu balasan.');
    error.code = 'COMMAND_QUEUE_FULL';
    throw error;
  }

  const id = randomUUID();
  const message = JSON.stringify({ id, type, payload });
  // ID ini menghubungkan perintah dari GCS dengan balasan mavlink_engine Fikrie.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommandAcks.delete(id);
      const error = new Error(`Tidak ada balasan untuk perintah ${type}.`);
      error.code = 'COMMAND_TIMEOUT';
      reject(error);
    }, config.commandTimeoutMs);
    pendingCommandAcks.set(id, { resolve, reject, timeout });

    publisherClient.publish(config.redisCommandChannel, message).then((subscriberCount) => {
      if (subscriberCount > 0) return;
      clearTimeout(timeout);
      pendingCommandAcks.delete(id);
      const error = new Error('Tidak ada engine yang berlangganan channel perintah.');
      error.code = 'COMMAND_UNAVAILABLE';
      reject(error);
    }).catch((error) => {
      clearTimeout(timeout);
      pendingCommandAcks.delete(id);
      error.code = 'REDIS_UNAVAILABLE';
      reject(error);
    });
  });
}

function getLatestTelemetry() {
  return stateTracker.getState();
}

function getHealth() {
  return {
    ok: true,
    redis: publisherClient.isReady && subscriberClient.isReady,
    channel: config.redisChannel,
    command_channel: config.redisCommandChannel,
    command_ack_channel: config.redisAckChannel,
    commands_enabled: config.commandsEnabled,
    telemetry_queue: require('../db').getTelemetryQueueStatus()
  };
}

function getConnectionStatus() {
  const telemetryFresh = lastTelemetryReceivedAt > 0 && Date.now() - lastTelemetryReceivedAt < 5000;
  return {
    connected: telemetryFresh,
    redis: publisherClient.isReady && subscriberClient.isReady,
    mavlink_url: config.mavlinkUrl,
    last_telemetry_at: latestTelemetry.received_at || null
  };
}

async function closeTelemetry() {
  for (const [id, pendingCommand] of pendingCommandAcks) {
    clearTimeout(pendingCommand.timeout);
    pendingCommand.reject(new Error('Koneksi server ditutup.'));
    pendingCommandAcks.delete(id);
  }
  if (subscriberClient.isOpen) await subscriberClient.quit();
  if (publisherClient.isOpen) await publisherClient.quit();
}

function resetTelemetryState() {
  latestTelemetry = {};
  lastTelemetryReceivedAt = 0;
}

module.exports = {
  connectTelemetry,
  setTelemetryListener,
  setMissionStarter,
  trackMission,
  reportMissionProgress,
  setMissionProgressListener,
  processTelemetryMessage,
  processAcknowledgement,
  getLatestTelemetry,
  getHealth,
  getConnectionStatus,
  stateTracker,
  sendCommand,
  resetTelemetryState,
  closeTelemetry
};
