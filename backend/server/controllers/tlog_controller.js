const tlogs = require('../services/tlog_replay_service');

function list(request, response) {
  response.json({ tlogs: tlogs.listTlogs() });
}

function download(request, response, next) {
  try {
    const fileName = request.params.fileName;
    const filePath = tlogs.getDownloadPath(fileName);
    response.download(filePath, fileName);
  } catch (error) {
    next(error);
  }
}

async function replay(request, response, next) {
  try {
    const data = await tlogs.loadReplay(request.params.fileName);
    if (!data.samples.length) {
      return response.status(422).json({ ok: false, error: 'TLOG ini belum punya data posisi drone untuk diputar.' });
    }
    response.json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = { list, download, replay };
