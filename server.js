
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
require('dotenv').config();

const folder = path.dirname(fileURLToPath(__filename));
const logFolder = path.join(folder, 'data', 'logs');
fs.mkdirSync(logFolder, { recursive: true });
let database;
let activeLog = null;
let latestTelemetry = {};

// ==========================================
// 1. INISIALISASI EXPRESS
// ==========================================

const app = express();
app.use(express.json());

// Membuat HTTP Server
const server = http.createServer(app);

// ==========================================
// 2. KONEKSI REDIS
// ==========================================

// Redis Client untuk operasi biasa
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

// Redis Subscriber khusus menerima telemetri
const redisSubscriber = redisClient.duplicate();

// Listener error
redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redisSubscriber.on('error', (err) => {
    console.error('Redis Subscriber Error:', err);
});

// ==========================================
// 3. INISIALISASI SOCKET.IO
// ==========================================

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// ==========================================
// 4. ROUTE HTTP
// ==========================================

app.get('/', (req, res) => {
    res.send('<h1>Server HTTP dan Socket.IO Berjalan!</h1>');
});

// ==========================================
// 5. LISTENER SOCKET.IO
// ==========================================

io.on('connection', (socket) => {

    console.log(`Pengguna terhubung: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`Pengguna terputus: ${socket.id}`);
    });

});

// ==========================================
// 6. REDIS SUBSCRIBER
// ==========================================

async function subscribeTelemetry() {

    // Harus sama dengan REDIS_CHANNEL pada Python
    const CHANNEL = process.env.REDIS_CHANNEL || 'telemetry';

    await redisSubscriber.subscribe(CHANNEL, (message) => {

        try {

            // Mengubah JSON string menjadi JavaScript Object
            const telemetryData = JSON.parse(message);

            latestTelemetry = { ...latestTelemetry, ...telemetryData, received_at: new Date().toISOString() };

            if (activeLog) {
                const row = {
                    log_id: activeLog.id,
                    recorded_at: latestTelemetry.received_at,
                    latitude: latestTelemetry.lat,
                    longitude: latestTelemetry.lon,
                    altitude: latestTelemetry.alt,
                    relative_altitude: latestTelemetry.rel_alt,
                    ground_speed: latestTelemetry.groundspeed,
                    air_speed: latestTelemetry.airspeed,
                    roll: latestTelemetry.roll,
                    pitch: latestTelemetry.pitch,
                    yaw: latestTelemetry.yaw,
                    heading: latestTelemetry.heading,
                    battery_percent: latestTelemetry.battery_percent,
                    flight_mode: latestTelemetry.flight_mode,
                    armed: latestTelemetry.armed
                };
                database.saveTelemetry(row);
                activeLog.stream.write(`${JSON.stringify(latestTelemetry)}\n`);
            }

            console.log('Telemetri diterima dari Python:', telemetryData);

            // Meneruskan data ke seluruh client Socket.IO
            io.emit('telemetry-update', latestTelemetry);

        } catch (error) {

            console.error('Gagal memproses data telemetri:', error);

        }

    });

    console.log(`Berhasil subscribe ke channel: ${CHANNEL}`);
}

app.get('/api/health', (req, res) => res.json({ ok: true, redis: redisClient.isReady }));
app.get('/api/telemetry', (req, res) => res.json(latestTelemetry));
app.get('/api/parameters', (req, res) => res.json(database.listParameters()));
app.put('/api/parameters', (req, res) => {
    try {
        if (!Array.isArray(req.body.parameters)) throw new Error('parameters must be an array.');
        res.json(database.saveParameters(req.body.parameters));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.get('/api/logs', (req, res) => res.json(database.listFlightLogs()));
app.post('/api/logs/start', (req, res) => {
    if (activeLog) return res.status(409).json({ error: 'Log sudah berjalan.' });
    const name = String(req.body.name || 'penerbangan').replace(/[^a-zA-Z0-9_-]/g, '-');
    const fileName = `${Date.now()}-${name}.jsonl`;
    const filePath = path.join(logFolder, fileName);
    activeLog = { id: database.createFlightLog({ name, fileName, filePath }), stream: fs.createWriteStream(filePath) };
    res.json({ ok: true, id: activeLog.id });
});
app.post('/api/logs/stop', async (req, res) => {
    if (!activeLog) return res.status(400).json({ error: 'Belum ada log yang berjalan.' });
    const log = activeLog;
    activeLog = null;
    await new Promise(resolve => log.stream.end(resolve));
    database.finishFlightLog(log.id);
    res.json({ ok: true });
});
app.get('/api/logs/:id/download', (req, res) => {
    const log = database.getFlightLog(req.params.id);
    if (!log || !fs.existsSync(log.file_path)) return res.status(404).json({ error: 'File log tidak ditemukan.' });
    res.download(log.file_path, log.file_name);
});
app.get('/api/logs/:id/telemetry', (req, res) => {
    if (!database.getFlightLog(req.params.id)) return res.status(404).json({ error: 'Log tidak ditemukan.' });
    res.json(database.listTelemetry(req.params.id, req.query.limit));
});

// ==========================================
// 7. FUNGSI UTAMA SERVER
// ==========================================

async function startServer() {

    try {

        // Menghubungkan Redis Client
        await redisClient.connect();

        console.log('Redis Client berhasil terhubung!');

        // Menghubungkan Redis Subscriber
        await redisSubscriber.connect();

        console.log('Redis Subscriber berhasil terhubung!');

        database = await import('./db.js');

        // Test Redis
        // Subscribe ke channel telemetri Python
        await subscribeTelemetry();

        // Menjalankan HTTP Server
        const PORT = 3000;

        server.listen(PORT, () => {

            console.log(`Server berjalan pada http://localhost:${PORT}`);

        });

    } catch (error) {

        console.error('Gagal menjalankan server:', error);

        process.exit(1);

    }

}

// ==========================================
// 8. MENJALANKAN SERVER
// ==========================================

startServer();
