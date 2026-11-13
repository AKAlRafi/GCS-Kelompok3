import axios from 'axios';
import { API_TOKEN, API_URL } from '../config';

const http = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 10_000,
  headers: API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {},
});

const slow = { timeout: 60_000 };
const data = (response) => response.data;

const cleanWaypoints = (waypoints) => waypoints.map((waypoint) => {
  const payload = { ...waypoint };
  for (const key of ['id', 'distance_m', 'bearing_deg', 'turn']) delete payload[key];
  return payload;
});

export const connectionApi = {
  status: () => http.get('/connection/status').then(data),
};

export const commandApi = {
  send: (type, payload = {}) => http.post('/commands', { type, payload }, slow).then(data),
  maneuver: (body) => http.post('/drone/maneuver', body, slow).then(data),
};

export const missionApi = {
  list: () => http.get('/missions').then(data),
  get: (id) => http.get(`/missions/${id}`).then(data),
  create: ({ name, waypoints }) => http.post('/missions', {
    name,
    waypoints: cleanWaypoints(waypoints),
  }).then(data),
  remove: (id) => http.delete(`/missions/${id}`).then(data),
  upload: (id) => http.post(`/missions/${id}/upload`, {}, slow).then(data),
  start: (id) => http.post(`/missions/${id}/start`, {}, slow).then(data),
  control: (type) => http.post('/missions/command', { type }, slow).then(data),
  clearFromVehicle: () => http.post('/missions/command', { type: 'clear_mission' }, slow).then(data),
  downloadFromVehicle: () => http.get('/fc/missions/download', slow).then(data),
};

export const logApi = {
  status: () => http.get('/logs/status').then(data),
  start: (name) => http.post('/logs/start', { name }).then(data),
  stop: () => http.post('/logs/stop', {}, slow).then(data),
  list: () => http.get('/logs').then(data),
  download: (id) => http.get(`/logs/${id}/download`, { responseType: 'blob', timeout: 60_000 }),
};
