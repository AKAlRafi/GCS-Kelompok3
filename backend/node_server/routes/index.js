const express = require('express');
const telemetry = require('../controllers/telemetry_controller');
const parameters = require('../controllers/parameter_controller');
const flightLogs = require('../controllers/flight_log_controller');
const commands = require('../controllers/command_controller');

const router = express.Router();

router.get('/health', telemetry.getHealth);
router.get('/telemetry', telemetry.getLatest);
router.get('/connection/status', commands.getConnectionStatus);
router.post('/commands', commands.send);
router.post('/fc/missions/upload', commands.uploadMission);
router.get('/fc/missions/download', commands.downloadMission);
router.get('/parameters', parameters.list);
router.put('/parameters', parameters.save);
router.get('/logs', flightLogs.list);
router.get('/logs/status', flightLogs.status);
router.post('/logs/start', flightLogs.start);
router.post('/logs/stop', flightLogs.stop);
router.get('/logs/:id/download', flightLogs.download);
router.get('/logs/:id/telemetry', flightLogs.telemetry);

module.exports = router;
