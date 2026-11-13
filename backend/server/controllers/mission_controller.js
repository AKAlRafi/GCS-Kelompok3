const missions = require('../services/mission_service');
const telemetry = require('../services/telemetry_service');

function create(request, response, next) {
  try { return response.status(201).json({ ok: true, mission: missions.createMission(request.body) }); }
  catch (error) { return next(error); }
}

function list(request, response) {
  return response.json({ ok: true, missions: missions.listMissions() });
}

function detail(request, response, next) {
  try { return response.json({ ok: true, mission: missions.readMission(request.params.id) }); }
  catch (error) { return next(error); }
}

function download(request, response, next) {
  try {
    const file = missions.getMissionFile(request.params.id);
    return response.download(file.filePath, file.fileName, (error) => { if (error && !response.headersSent) next(error); });
  } catch (error) { return next(error); }
}

function importFile(request, response, next) {
  try {
    let text = typeof request.body === 'string' ? request.body : request.body?.raw_text;
    let name = request.body?.name;
    if (Buffer.isBuffer(request.body)) {
      const contentType = request.get('content-type') || '';
      if (contentType.startsWith('multipart/form-data')) {
        const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!boundary) throw new Error('Boundary multipart tidak ditemukan.');
        const marker = `--${boundary[1] || boundary[2]}`;
        const parts = request.body.toString('utf8').split(marker);
        const filePart = parts.find((part) => /filename="[^"]+"/i.test(part));
        if (!filePart) throw new Error('Field file .waypoint tidak ditemukan.');
        const splitAt = filePart.indexOf('\r\n\r\n');
        if (splitAt < 0) throw new Error('Isi file multipart tidak valid.');
        text = filePart.slice(splitAt + 4).replace(/\r\n--?\s*$/, '').replace(/\r\n$/, '');
        const filename = filePart.match(/filename="([^"]+)"/i)?.[1] || 'impor.waypoint';
        if (!filename.toLowerCase().endsWith('.waypoint')) throw new Error('File harus berformat .waypoint.');
        name = filename.replace(/\.waypoint$/i, '');
      } else text = request.body.toString('utf8');
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error('Kirim raw text QGC WPL 110 atau file multipart .waypoint.');
    return response.status(201).json({ ok: true, mission: missions.importMission(text, name) });
  } catch (error) { error.status ||= 400; return next(error); }
}

function remove(request, response, next) {
  try { return response.json(missions.deleteMission(request.params.id)); }
  catch (error) { return next(error); }
}

async function upload(request, response, next) {
  try { return response.json(await missions.uploadMissionToDrone(request.params.id)); }
  catch (error) { return next(error); }
}

async function start(request, response, next) {
  try {
    const result = await missions.startMission(request.params.id, telemetry.reportMissionProgress);
    telemetry.trackMission(request.params.id);
    return response.json(result);
  }
  catch (error) { return next(error); }
}

module.exports = { create, list, detail, download, importFile, remove, upload, start };
