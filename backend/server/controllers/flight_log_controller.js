const flightLogs = require('../services/flight_log_service');

function list(request, response) {
  response.json(flightLogs.listLogs());
}

function status(request, response) {
  response.json(flightLogs.getActiveLog());
}

function start(request, response, next) {
  try {
    const name = request.body?.name;
    if (name !== undefined && (typeof name !== 'string' || name.length > 120)) {
      return response.status(400).json({ ok: false, error: 'name harus berupa teks maksimal 120 karakter.' });
    }
    response.status(201).json(flightLogs.startLog(name));
  } catch (error) {
    if (error.message.includes('sedang berjalan')) {
      return response.status(409).json({ ok: false, error: error.message });
    }
    next(error);
  }
}

async function stop(request, response, next) {
  try {
    response.json(await flightLogs.stopLog());
  } catch (error) {
    if (error.message.includes('Tidak ada')) {
      return response.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
}

function download(request, response) {
  const logId = Number(request.params.id);
  if (!Number.isSafeInteger(logId) || logId < 1) return response.status(400).json({ ok: false, error: 'ID log tidak valid.' });
  const log = flightLogs.getLog(logId);
  if (!log) {
    return response.status(404).json({ ok: false, error: 'Flight log tidak ditemukan.' });
  }
  response.type('application/x-ndjson');
  response.attachment(log.file_name);
  const stream = flightLogs.createJsonlStream(logId);
  stream.on('error', (error) => response.destroy(error));
  stream.pipe(response);
}

function telemetry(request, response) {
  const logId = Number(request.params.id);
  if (!Number.isSafeInteger(logId) || logId < 1) return response.status(400).json({ ok: false, error: 'ID log tidak valid.' });
  if (!flightLogs.getLog(logId)) {
    return response.status(404).json({ ok: false, error: 'Flight log tidak ditemukan.' });
  }
  response.json(flightLogs.getTelemetry(logId, request.query.limit));
}

module.exports = { list, status, start, stop, download, telemetry };
