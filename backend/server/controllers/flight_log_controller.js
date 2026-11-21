const flightLogs = require('../services/flight_log_service');
const telemetryService = require('../services/telemetry_service');

function list(request, response) {
  response.json(flightLogs.listLogs());
}

function status(request, response) {
  response.json(flightLogs.getActiveLog());
}

async function start(request, response, next) {
  try {
    const name = request.body?.name;
    if (name !== undefined && (typeof name !== 'string' || name.length > 120)) {
      return response.status(400).json({ ok: false, error: 'name harus berupa teks maksimal 120 karakter.' });
    }
    if (flightLogs.getActiveLog().active) {
      return response.status(409).json({ ok: false, error: 'Flight log sedang berjalan.' });
    }
    const tlog = await telemetryService.sendRecordingCommand('start_recording');
    if (!tlog.ok) throw new Error(tlog.error || 'TLOG gagal dimulai.');
    try {
      response.status(201).json({ ...flightLogs.startLog(name), tlog: tlog.file });
    } catch (error) {
      await telemetryService.sendRecordingCommand('stop_recording');
      throw error;
    }
  } catch (error) {
    if (error.message.includes('sedang berjalan')) {
      return response.status(409).json({ ok: false, error: error.message });
    }
    next(error);
  }
}

async function stop(request, response, next) {
  try {
    const [tlogResult, jsonlResult] = await Promise.allSettled([
      telemetryService.sendRecordingCommand('stop_recording'),
      flightLogs.getActiveLog().active ? flightLogs.stopLog() : Promise.resolve({ ok: true })
    ]);
    if (jsonlResult.status === 'rejected') throw jsonlResult.reason;
    if (tlogResult.status === 'rejected') throw tlogResult.reason;
    if (!tlogResult.value.ok) throw new Error(tlogResult.value.error || 'TLOG gagal dihentikan.');
    response.json({ ok: true });
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
