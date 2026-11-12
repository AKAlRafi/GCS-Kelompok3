const telemetryService = require('../services/telemetry_service');

function getConnectionStatus(request, response) {
  response.json(telemetryService.getConnectionStatus());
}

async function send(request, response) {
  const { type, payload = {} } = request.body || {};
  if (typeof type !== 'string' || !/^[a-z][a-z0-9_]{1,50}$/.test(type)) {
    return response.status(400).json({ error: 'Field type harus berupa nama perintah yang valid.' });
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return response.status(400).json({ error: 'Field payload harus berupa objek JSON.' });
  }
  return sendAndWait(type, payload, response);
}

function uploadMission(request, response) {
  const waypoints = request.body?.waypoints;
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return response.status(400).json({ error: 'Waypoints harus berupa array yang tidak kosong.' });
  }
  return sendAndWait('upload_mission', { waypoints }, response);
}

function downloadMission(request, response) {
  return sendAndWait('download_mission', {}, response);
}

async function sendAndWait(type, payload, response) {
  try {
    const acknowledgement = await telemetryService.sendCommand(type, payload);
    if (acknowledgement.ok === false) {
      return response.status(502).json({ error: acknowledgement.error || 'Perintah ditolak oleh MAVLink.' });
    }
    return response.json(acknowledgement);
  } catch (error) {
    const status = {
      COMMAND_TIMEOUT: 504,
      REDIS_UNAVAILABLE: 503,
      COMMANDS_DISABLED: 503
    }[error.code] || 500;
    return response.status(status).json({ error: error.message });
  }
}

module.exports = { getConnectionStatus, send, uploadMission, downloadMission };
