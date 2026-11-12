const fs = require('node:fs');
const flightLogs = require('../services/flight_log_service');

function list(request, response) {
  response.json(flightLogs.listLogs());
}

function status(request, response) {
  response.json(flightLogs.getActiveLog());
}

function start(request, response, next) {
  try {
    response.status(201).json(flightLogs.startLog(request.body.name));
  } catch (error) {
    if (error.message.includes('sedang berjalan')) {
      return response.status(409).json({ error: error.message });
    }
    next(error);
  }
}

async function stop(request, response, next) {
  try {
    response.json(await flightLogs.stopLog());
  } catch (error) {
    if (error.message.includes('Tidak ada')) {
      return response.status(400).json({ error: error.message });
    }
    next(error);
  }
}

function download(request, response) {
  const log = flightLogs.getLog(request.params.id);
  if (!log || !fs.existsSync(log.file_path)) {
    return response.status(404).json({ error: 'File flight log tidak ditemukan.' });
  }
  response.download(log.file_path, log.file_name);
}

function telemetry(request, response) {
  if (!flightLogs.getLog(request.params.id)) {
    return response.status(404).json({ error: 'Flight log tidak ditemukan.' });
  }
  response.json(flightLogs.getTelemetry(request.params.id, request.query.limit));
}

module.exports = { list, status, start, stop, download, telemetry };
