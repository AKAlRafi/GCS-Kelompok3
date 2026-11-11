// Load the libraries used by the HTTP API, Redis connection, and live browser updates.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Resolve file paths from this server file.
const folder = __dirname;
const logFolder = path.join(folder, 'data', 'logs');

fs.mkdirSync(logFolder, { recursive: true });


// These values are shared by the API routes and the telemetry subscriber.
let database;
let activeLog = null;
let latestTelemetry = {};

// Create the Express application and allow it to read JSON request bodies.
const app = express();
app.use(express.json());

// Use one HTTP server for both REST endpoints and Socket.IO connections.
const server = http.createServer(app);

// Redis stores the telemetry message channel. The subscriber connection is kept
// separate because Redis dedicates subscribed connections to receiving messages.
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});
const redisSubscriber = redisClient.duplicate();

// Report Redis connection errors so a failed or interrupted connection is visible in the terminal.
redisClient.on('error', (error) => {
    console.error('Redis client error:', error);
});

redisSubscriber.on('error', (error) => {
    console.error('Redis subscriber error:', error);
});

// Socket.IO sends live telemetry updates to browser clients over this HTTP server.
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// A small status page that confirms the HTTP server is responding.
app.get('/', (req, res) => {
    res.send('<h1>HTTP and Socket.IO server is running.</h1>');
});

// Track browser connections to help diagnose whether the frontend is connected.
io.on('connection', (socket) => {
    console.log(`Browser connected: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`Browser disconnected: ${socket.id}`);
    });
});

// Listen to the Redis channel where the Python MAVLink process publishes telemetry.
async function subscribeTelemetry() {
    const channel = process.env.REDIS_CHANNEL || 'telemetry';

    await redisSubscriber.subscribe(channel, (message) => {
        try {
            // Redis messages arrive as text, so parse the JSON before using the values.
            const telemetryData = JSON.parse(message);

            // Merge partial updates so fields omitted from a message keep their last known values.
            latestTelemetry = {
                ...latestTelemetry,
                ...telemetryData,
                received_at: new Date().toISOString()
            };

            // While a flight log is active, save each telemetry update to the SQL database
            // and append the complete current state to a newline-delimited JSON file.
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

            console.log('Telemetry received from Python:', telemetryData);

            // Broadcast the newest combined telemetry state to every connected browser.
            io.emit('telemetry-update', latestTelemetry);
        } catch (error) {
            // Invalid JSON or a failed save should be reported without crashing the server.
            console.error('Could not process telemetry message:', error);
        }
    });

    console.log(`Subscribed to Redis channel: ${channel}`);
}

// Health endpoint: reports whether Redis is connected and ready.
app.get('/api/health', (req, res) => {
    res.json({ ok: true, redis: redisClient.isReady });
});

// Return the most recently received telemetry state to a browser that loads or reconnects.
app.get('/api/telemetry', (req, res) => {
    res.json(latestTelemetry);
});

// Return all saved configuration parameters from the SQL database.
app.get('/api/parameters', (req, res) => {
    res.json(database.listParameters());
});

// Replace the saved parameter set. The request must provide a parameters array.
app.put('/api/parameters', (req, res) => {
    try {
        if (!Array.isArray(req.body.parameters)) {
            throw new Error('The parameters field must be an array.');
        }

        res.json(database.saveParameters(req.body.parameters));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Return the saved flight log records.
app.get('/api/logs', (req, res) => {
    res.json(database.listFlightLogs());
});

// Start a new flight log record and open its JSON Lines file for appending telemetry.
app.post('/api/logs/start', (req, res) => {
    if (activeLog) {
        return res.status(409).json({ error: 'A flight log is already running.' });
    }

    const name = String(req.body.name || 'flight').replace(/[^a-zA-Z0-9_-]/g, '-');
    const fileName = `${Date.now()}-${name}.jsonl`;
    const filePath = path.join(logFolder, fileName);
    const id = database.createFlightLog({ name, fileName, filePath });

    activeLog = {
        id,
        stream: fs.createWriteStream(filePath)
    };

    res.json({ ok: true, id: activeLog.id });
});

// Close the current log file and mark its database record as finished.
app.post('/api/logs/stop', async (req, res) => {
    if (!activeLog) {
        return res.status(400).json({ error: 'There is no active flight log.' });
    }

    const log = activeLog;
    activeLog = null;
    await new Promise((resolve) => log.stream.end(resolve));
    database.finishFlightLog(log.id);

    res.json({ ok: true });
});

// Download a log file by its database ID.
app.get('/api/logs/:id/download', (req, res) => {
    const log = database.getFlightLog(req.params.id);

    if (!log || !fs.existsSync(log.file_path)) {
        return res.status(404).json({ error: 'The log file was not found.' });
    }

    res.download(log.file_path, log.file_name);
});

// Return telemetry rows recorded for one flight log. The optional limit is handled by db.js.
app.get('/api/logs/:id/telemetry', (req, res) => {
    if (!database.getFlightLog(req.params.id)) {
        return res.status(404).json({ error: 'The flight log was not found.' });
    }

    res.json(database.listTelemetry(req.params.id, req.query.limit));
});

// Connect the required services before accepting browser or API traffic.
async function startServer() {
    try {
        await redisClient.connect();
        console.log('Redis client connected.');

        await redisSubscriber.connect();
        console.log('Redis subscriber connected.');

        // db.js is an ES module, so load it dynamically from this CommonJS server.
        database = await import('./db.js');

        // Begin receiving Python telemetry before opening the HTTP port.
        await subscribeTelemetry();

        const port = Number(process.env.PORT || 3000);
        server.listen(port, () => {
            console.log(`Server is running at http://127.0.0.1:${port}`);
        });
    } catch (error) {
        console.error('Could not start the server:', error);
        process.exit(1);
    }
}

// Start the application after all routes and listeners have been registered.
startServer();
