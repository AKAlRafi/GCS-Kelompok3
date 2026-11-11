// GARIS BESARNYA 
// mengatur komunikasi lewat rest api
// prepare front end get data to backend 

// impor library kirim http request
import axios from 'axios';
import { API_URL } from "../config";

// konfigurasi http 
const http = axios.create ({
    baseURL: `${API_URL}/api`,
    timeout: 10_000,
})

const SLOW = { timeout: 30_000 }; // data banyak = lama

//menyaring data posisi dari respons axios lewat res.data
const clean = (waypoints) => 
    waypoints.map(({lat, lon, alt}) => ({ lat, lon, alt }));
const data = (res) => res.data;

// koneksi API minta. kirim, update, hapus
export const connectionApi = {
    status: () => http.get('/connection/status').then(data),
    connect: (port, baud) =>
     http.post('/connection/connect', { port, baud }, SLOW).then(data),
    disconnect: () =>
     http.post('/connection/disconnect').then(data),
}

export const missionApi = { //misi and wp
    //DB
    list: () => http.get('/missions').then(data),
    get: (id) => http.get(`/missions/${id}`).then(data),

    create: ({ name, waypoints }) =>
        http.post('/missions', {
            name, 
            waypoints: clean(waypoints),
        }).then(data),

    update: (id, { name, waypoints }) =>
        http.post('/missions', {
            name, 
            waypoints: clean(waypoints),
        }).then(data),

    remove: (id) =>
        http.delete(`/missions/${id}`).then(data),

    //komunikasi with backend for missions
    uploadToFc: (waypoints) =>
        http.post('/fc/missions/upload', {
            waypoints: clean(waypoints),
        }, SLOW).then(data),

    downloadFromFc: () =>
        http.get('/fc/missions/download', SLOW).then(data),
};

//api untuk flight log  
export const logApi = {
    status:()=>http.get('/logs/status').then(data),
    start: () => http.post('/logs/start').then(data),
    stop: () => http.post('/logs/stop').then(data),
    list: () => http.get('/logs').then(data),

    downloadUrl: (id) =>
    `${API_URL}/api/logs/${id}/download`,
}