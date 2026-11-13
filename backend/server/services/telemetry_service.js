const { createClient } = require('redis');
const { randomUUID } = require('node:crypto');
const config = require('../config');
const flightLogs = require('./flight_log_service');

const publisherClient = createClient({ url: config.redisUrl });
const subscriberClient = publisherClient.duplicate();
let latestTelemetry = {};
let onTelemetry = () => {};
let lastTelemetryReceivedAt = 0;
let isTelemetrySubscribed = false;
let isAckSubscribed = false;
let connectionPromise = null;
const waitingForAcks = new Map();
const maxPendingCommands = 32;
const lastRedisErrorAt = new Map();
const telemetryNumberFields = [
  'lat', 'lon', 'alt', 'rel_alt', 'heading', 'roll', 'pitch', 'yaw',
  'airspeed', 'groundspeed', 'battery_percent', 'timestamp'
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

function validateTelemetry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Telemetry harus berupa objek JSON.');
  }

  const cleanData = {};
  for (const field of telemetryNumberFields) {
    if (data[field] === undefined) continue;
    if (data[field] !== null && (typeof data[field] !== 'number' || !Number.isFinite(data[field]))) {
      throw new Error(`Field telemetry ${field} harus berupa angka terbatas.`);
    }
    cleanData[field] = data[field];
  }
  if (cleanData.lat != null && (cleanData.lat < -90 || cleanData.lat > 90)) {
    throw new Error('Latitude telemetry di luar batas.');
  }
  if (cleanData.lon != null && (cleanData.lon < -180 || cleanData.lon > 180)) {
    throw new Error('Longitude telemetry di luar batas.');
  }
  if (cleanData.heading != null && (cleanData.heading < 0 || cleanData.heading > 360)) {
    throw new Error('Heading telemetry di luar batas.');
  }
  if (cleanData.battery_percent != null && (cleanData.battery_percent < 0 || cleanData.battery_percent > 100)) {
    throw new Error('Persentase baterai telemetry di luar batas.');
  }
  if (data.flight_mode !== undefined) {
    if (typeof data.flight_mode !== 'string' || data.flight_mode.length > 64) {
      throw new Error('Flight mode telemetry tidak valid.');
    }
    cleanData.flight_mode = data.flight_mode;
  }
  if (data.armed !== undefined) {
    if (data.armed !== null && typeof data.armed !== 'boolean') {
      throw new Error('Status armed telemetry harus berupa boolean.');
    }
    cleanData.armed = data.armed;
  }
  if (Object.keys(cleanData).length === 0) throw new Error('Telemetry tidak berisi field yang dikenal.');
  return cleanData;
}

function processTelemetryMessage(message) {
  try {
    const data = validateTelemetry(JSON.parse(message));
    latestTelemetry = { ...latestTelemetry, ...data, received_at: new Date().toISOString() };
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
    const pendingCommand = waitingForAcks.get(commandId);
    if (!pendingCommand || typeof acknowledgement.ok !== 'boolean') return;
    clearTimeout(pendingCommand.timeout);
    waitingForAcks.delete(commandId);
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
  if (waitingForAcks.size >= maxPendingCommands) {
    const error = new Error('Terlalu banyak perintah yang masih menunggu balasan.');
    error.code = 'COMMAND_QUEUE_FULL';
    throw error;
  }

  const id = randomUUID();
  const message = JSON.stringify({ id, type, payload });
  // ID yang sama dipakai untuk mencocokkan perintah dengan balasan dari engine.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waitingForAcks.delete(id);
      const error = new Error(`Tidak ada balasan untuk perintah ${type}.`);
      error.code = 'COMMAND_TIMEOUT';
      reject(error);
    }, config.commandTimeoutMs);
    waitingForAcks.set(id, { resolve, reject, timeout });

    publisherClient.publish(config.redisCommandChannel, message).then((subscriberCount) => {
      if (subscriberCount > 0) return;
      clearTimeout(timeout);
      waitingForAcks.delete(id);
      const error = new Error('Tidak ada engine yang berlangganan channel perintah.');
      error.code = 'COMMAND_UNAVAILABLE';
      reject(error);
    }).catch((error) => {
      clearTimeout(timeout);
      waitingForAcks.delete(id);
      error.code = 'REDIS_UNAVAILABLE';
      reject(error);
    });
  });
}

function getLatestTelemetry() {
  return latestTelemetry;
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
  for (const [id, pendingCommand] of waitingForAcks) {
    clearTimeout(pendingCommand.timeout);
    pendingCommand.reject(new Error('Koneksi server ditutup.'));
    waitingForAcks.delete(id);
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
  processTelemetryMessage,
  processAcknowledgement,
  getLatestTelemetry,
  getHealth,
  getConnectionStatus,
  sendCommand,
  resetTelemetryState,
  closeTelemetry
};
