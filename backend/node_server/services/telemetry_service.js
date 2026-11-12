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
const waitingForAcks = new Map();

for (const [name, client] of [['Redis', publisherClient], ['Redis subscriber', subscriberClient]]) {
  client.on('error', (error) => console.error(`${name} error:`, error.message));
}

async function connectTelemetry(onUpdate) {
  onTelemetry = onUpdate;
  if (!publisherClient.isOpen) await publisherClient.connect();
  if (!subscriberClient.isOpen) await subscriberClient.connect();
  if (!isTelemetrySubscribed) {
    // Telemetry dari engine disimpan saat log aktif lalu diteruskan ke WebSocket.
    await subscriberClient.subscribe(config.redisChannel, (message) => {
      try {
        const data = JSON.parse(message);
        latestTelemetry = { ...latestTelemetry, ...data, received_at: new Date().toISOString() };
        lastTelemetryReceivedAt = Date.now();
        flightLogs.saveTelemetry(latestTelemetry);
        onTelemetry(latestTelemetry);
      } catch (error) {
        console.error('Data telemetry tidak bisa diproses:', error.message);
      }
    });
    isTelemetrySubscribed = true;
  }

  if (!isAckSubscribed) {
    await subscriberClient.subscribe(config.redisAckChannel, (message) => {
      try {
        const acknowledgement = JSON.parse(message);
        const commandId = acknowledgement.id || acknowledgement.command_id;
        const pendingCommand = waitingForAcks.get(commandId);
        if (!pendingCommand) return;
        clearTimeout(pendingCommand.timeout);
        waitingForAcks.delete(commandId);
        pendingCommand.resolve(acknowledgement);
      } catch (error) {
        console.error('Balasan perintah tidak bisa diproses:', error.message);
      }
    });
    isAckSubscribed = true;
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

    publisherClient.publish(config.redisCommandChannel, message).catch((error) => {
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
    commands_enabled: config.commandsEnabled
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

module.exports = {
  connectTelemetry,
  getLatestTelemetry,
  getHealth,
  getConnectionStatus,
  sendCommand,
  closeTelemetry
};
