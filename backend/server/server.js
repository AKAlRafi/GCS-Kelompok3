const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const config = require('./config');
const database = require('./db');
const apiRoutes = require('./routes');
const telemetryService = require('./services/telemetry_service');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT'] }
});

app.use(express.json({ limit: '1mb' }));
app.get('/', (request, response) => response.json({ ok: true, service: 'gcs-backend' }));
app.use('/api', apiRoutes);
app.use((error, request, response, next) => {
  console.error('Permintaan API gagal:', error.message);
  if (response.headersSent) return next(error);
  response.status(400).json({ error: error.message || 'Permintaan tidak bisa diproses.' });
});

io.on('connection', (socket) => {
  socket.emit('telemetry', telemetryService.getLatestTelemetry());
});

// Server HTTP tetap hidup agar status bisa diperiksa saat Redis belum tersedia.
async function connectToRedis() {
  try {
    await telemetryService.connectTelemetry((telemetry) => io.emit('telemetry', telemetry));
    console.log(`Terhubung ke Redis, channel ${config.redisChannel}.`);
  } catch (error) {
    console.error('Redis belum tersedia:', error.message);
  }
}

const httpServer = server.listen(config.port, config.host, () => {
  console.log(`GCS backend berjalan di http://${config.host}:${config.port}`);
  connectToRedis();
});

const redisRetry = setInterval(() => {
  if (!telemetryService.getHealth().redis) connectToRedis();
}, 5000);

async function stopServer() {
  clearInterval(redisRetry);
  await telemetryService.closeTelemetry().catch(() => {});
  database.close();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
