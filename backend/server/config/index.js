const path = require('node:path');

const backendFolder = path.resolve(__dirname, '../..');

function resolveBackendPath(value, fallback) {
  return path.resolve(backendFolder, value || fallback);
}

module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 5000),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisChannel: process.env.REDIS_CHANNEL || 'telemetry',
  redisCommandChannel: process.env.REDIS_COMMAND_CHANNEL || 'commands',
  redisAckChannel: process.env.REDIS_ACK_CHANNEL || 'command_acks',
  commandsEnabled: process.env.ENABLE_COMMANDS === '1',
  commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS || 60000),
  mavlinkUrl: process.env.MAVLINK_URL || 'udpin:0.0.0.0:14551',
  databasePath: resolveBackendPath(process.env.DB_PATH, 'data/gcs.db'),
  logFolder: resolveBackendPath(process.env.LOG_DIR, 'data/logs')
};
