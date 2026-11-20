const telemetryService = require('../services/telemetry_service');

function getHealth(request, response) {
  response.json(telemetryService.getHealth());
}

function getLatest(request, response) {
  response.json(telemetryService.getLatestTelemetry());
}

module.exports = { getHealth, getLatest };
