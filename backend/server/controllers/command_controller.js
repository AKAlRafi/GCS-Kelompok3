const telemetryService = require('../services/telemetry_service');
const { validateCommand } = require('../services/command_validation_service');

function getConnectionStatus(request, response) {
  response.json(telemetryService.getConnectionStatus());
}

function send(request, response, next) {
  try {
    const { type, payload = {} } = request.body || {};
    const command = validateCommand(type, payload);
    return sendAndWait(command.type, command.payload, response, next);
  } catch (error) {
    return next(error);
  }
}

function uploadMission(request, response, next) {
  try {
    const command = validateCommand('upload_mission', request.body || {});
    return sendAndWait(command.type, command.payload, response, next);
  } catch (error) {
    return next(error);
  }
}

function downloadMission(request, response, next) {
  return sendAndWait('download_mission', {}, response, next);
}

async function sendAndWait(type, payload, response, next) {
  try {
    const acknowledgement = await telemetryService.sendCommand(type, payload);
    if (acknowledgement.ok === false) {
      const error = new Error(acknowledgement.error || 'Perintah ditolak oleh MAVLink.');
      error.status = 502;
      error.code = 'COMMAND_REJECTED';
      throw error;
    }
    return response.json(acknowledgement);
  } catch (error) {
    error.status ||= ({
      COMMAND_TIMEOUT: 504,
      REDIS_UNAVAILABLE: 503,
      COMMANDS_DISABLED: 503,
      COMMAND_QUEUE_FULL: 429,
      COMMAND_UNAVAILABLE: 503
    }[error.code] || 500);
    return next(error);
  }
}

module.exports = { getConnectionStatus, send, uploadMission, downloadMission };
