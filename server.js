
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
require('dotenv').config();

// ==========================================
// 1. INISIALISASI EXPRESS
// ==========================================

const app = express();

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
    const CHANNEL = 'telemetry';

    await redisSubscriber.subscribe(CHANNEL, (message) => {

        try {

            // Mengubah JSON string menjadi JavaScript Object
            const telemetryData = JSON.parse(message);

            console.log('Telemetri diterima dari Python:', telemetryData);

            // Meneruskan data ke seluruh client Socket.IO
            io.emit('telemetry-update', telemetryData);

        } catch (error) {

            console.error('Gagal memproses data telemetri:', error);

        }

    });

    console.log(`Berhasil subscribe ke channel: ${CHANNEL}`);
}

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

        // Test Redis
        await redisClient.set('framework', 'Express');

        const value = await redisClient.get('framework');

        console.log('Stored value:', value);

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
