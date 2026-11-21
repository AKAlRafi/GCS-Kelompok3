const flightLogs = require('../services/flight_log_service');
const telemetryService = require('../services/telemetry_service');
const tlogReplayService = require('../services/tlog_replay_service');

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
    const requestedWaypoints = request.body?.waypoints;
    if (requestedWaypoints !== undefined && (!Array.isArray(requestedWaypoints) || requestedWaypoints.length > 1000)) {
      return response.status(400).json({ ok: false, error: 'Daftar waypoint untuk replay tidak valid.' });
    }
    const waypoints = (requestedWaypoints || []).map((point) => ({
      lat: Number(point.lat), lon: Number(point.lon), alt: Number(point.alt),
    }));
    if (waypoints.some((point) => !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90
      || !Number.isFinite(point.lon) || point.lon < -180 || point.lon > 180
      || !Number.isFinite(point.alt))) {
      return response.status(400).json({ ok: false, error: 'Koordinat waypoint untuk replay tidak valid.' });
    }
    const tlog = await telemetryService.sendRecordingCommand('start_recording');
    if (!tlog.ok) throw new Error(tlog.error || 'TLOG gagal dimulai.');
    try {
      const log = flightLogs.startLog(name);
      const tlogName = require('node:path').basename(tlog.file);
      tlogReplayService.setWaypoints(tlogName, waypoints);
      response.status(201).json({ ...log, tlog: tlogName });
    } catch (error) {
      await telemetryService.sendRecordingCommand('stop_recording');
      if (flightLogs.getActiveLog().active) await flightLogs.stopLog();
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
