//untuk menentukan alamat backend/server dari BE yg dihubungi FE
export const API_URL = //file lain bisa mengambil alamat 
  import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

export const SOCKET_URL = //menerima pembaruan secara berkelanjutan
  import.meta.env.VITE_SOCKET_URL ?? API_URL; // baca konfigurasi dari env