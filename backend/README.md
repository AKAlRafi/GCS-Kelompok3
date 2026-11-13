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

## Manajemen misi dan manuver

Backend menyediakan `POST/GET /api/missions`, `POST /api/missions/import`,
`GET /api/missions/:id`, `GET /api/missions/:id/download`,
`DELETE /api/missions/:id`, serta `POST /api/missions/:id/upload` dan
`POST /api/missions/:id/start`. File QGC WPL 110 disimpan di `data/missions/`.
Impor menerima raw text `text/plain` atau `multipart/form-data` dengan field file
berekstensi `.waypoint`.

`POST /api/drone/maneuver` menerima action `ROTATE_YAW`,
`TURN_TO_COORDINATE`, `CHANGE_ALTITUDE`, atau `CHANGE_SPEED`.
`POST /api/missions/command` menerima `{ "type": "start_mission",
"mission_id": 1 }` atau perintah cepat `pause_mission`, `resume_mission`,
`rtl`, `land`, dan `clear_mission`.

Socket.IO mengirim event `telemetry`, `navigation_guidance`,
`mission_progress`, dan `failsafe_warning`. Upload dan start misi hanya lolos
gatekeeper jika backend menerima timestamp heartbeat, 3D GPS fix, minimal enam
satelit, HDOP, baterai, status DISARMED, serta koordinat Home yang valid.
Engine yang saat ini diaudit belum mengirim beberapa data itu dan belum membaca
command channel di loop utamanya. Karena itu, fitur kendali tetap fail-closed
dan harus disambungkan serta diuji di simulator sebelum digunakan pada pesawat.
