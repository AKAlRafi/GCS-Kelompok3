# Backend GCS

Backend memakai Node.js untuk API, database SQLite, dan WebSocket. Engine MAVLink
berada di branch `mavlink_develop` dan mengirim data telemetry lewat Redis.

## Menjalankan

1. Siapkan Redis dan pastikan alamatnya sesuai `REDIS_URL` di `.env`.
2. Dari `backend/server`, jalankan `npm install` lalu `npm start`.
3. Jalankan engine Python dari checkout branch `mavlink_develop` dan pastikan
   environment Redis serta MAVLink diatur untuk proses tersebut.

Atur `MAVLINK_URL` untuk koneksi drone, misalnya `udpin:0.0.0.0:14551`.
Database dan flight log otomatis dibuat di `backend/data/`.

API tersedia di `/api/health`, `/api/telemetry`, `/api/parameters`, dan `/api/logs`.
Pembaruan langsung dikirim lewat event Socket.IO bernama `telemetry`.

Node mengirim permintaan ke Redis channel `commands` dan menunggu balasan di
`command_acks`. Di kode branch `mavlink_develop` yang diaudit, `main.py` belum
memanggil pembaca perintah atau pengirim ACK, jadi eksekusi perintah belum tersambung.
