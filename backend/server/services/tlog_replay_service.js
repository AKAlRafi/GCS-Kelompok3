const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('../config');
const database = require('../db');

const execFileAsync = promisify(execFile);
const engineFolder = path.resolve(__dirname, '../../mavlink_engine');
const pythonPath = process.platform === 'win32'
  ? path.join(engineFolder, '.venv', 'Scripts', 'python.exe')
  : path.join(engineFolder, '.venv', 'bin', 'python');

function listTlogs() {
  return database.syncTlogFiles();
}

function getDownloadPath(fileName) {
  const filePath = resolveTlog(fileName);
  const file = database.getTlogFile(fileName);
  if (!file || path.resolve(file.file_path) !== filePath) {
    const error = new Error('File TLOG tidak tercatat di database.');
    error.status = 404;
    throw error;
  }
  return filePath;
}

function resolveTlog(fileName) {
  if (typeof fileName !== 'string' || fileName.includes('/') || fileName.includes('\\')
    || path.basename(fileName) !== fileName
    || !fileName.toLowerCase().endsWith('.tlog')) {
    const error = new Error('Nama file TLOG tidak valid.');
    error.status = 400;
    throw error;
  }
  const filePath = path.resolve(config.tlogFolder, fileName);
  if (path.dirname(filePath) !== path.resolve(config.tlogFolder) || !fs.existsSync(filePath)) {
    const error = new Error('File TLOG tidak ditemukan.');
    error.status = 404;
    throw error;
  }
  return filePath;
}

async function loadReplay(fileName) {
  const filePath = resolveTlog(fileName);
  if (!fs.existsSync(pythonPath)) {
    const error = new Error('Python environment MAVLink belum tersedia.');
    error.status = 503;
    throw error;
  }
  try {
    const { stdout } = await execFileAsync(pythonPath, ['-m', 'mavlink_engine.read_tlog', filePath], {
      cwd: path.resolve(engineFolder, '..'),
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (cause) {
    const error = new Error(cause.killed
      ? 'Pembacaan TLOG melewati batas waktu.'
      : `TLOG gagal dibaca: ${(cause.stderr || cause.message).trim()}`);
    error.status = cause.killed ? 408 : 422;
    throw error;
  }
}

module.exports = { listTlogs, loadReplay, getDownloadPath };
