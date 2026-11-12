# Backend GCS

Backend memakai Node.js untuk API, database SQLite, dan WebSocket. Pembaca MAVLink
berjalan sebagai proses Python terpisah dan mengirim data telemetry lewat Redis.

## Menjalankan

1. Siapkan Redis dan pastikan alamatnya sesuai `REDIS_URL` di `.env`.
2. Di `backend/node_server`, jalankan `npm install` lalu `npm start`.
3. Di direktori `backend`, siapkan dependensi Python dengan
   `python -m pip install -r mavlink_engine/requirements.txt`.
4. Jalankan pembaca MAVLink dari direktori `backend` dengan
   `python -m mavlink_engine.main`.

Atur `MAVLINK_URL` untuk koneksi drone, misalnya `udpin:0.0.0.0:14551`.
Database dan flight log otomatis dibuat di `backend/data/`.

API tersedia di `/api/health`, `/api/telemetry`, `/api/parameters`, dan `/api/logs`.
Pembaruan langsung dikirim lewat event Socket.IO bernama `telemetry`.
