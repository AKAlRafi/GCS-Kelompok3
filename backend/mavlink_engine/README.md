# mavlink_engine

Program Python yang menghubungkan wahana (atau simulator) dengan backend GCS.

- **Ke arah backend:** membaca pesan MAVLink, mengubahnya menjadi JSON, dan mengirimnya lewat Redis.
- **Ke arah wahana:** menerima perintah dari backend, mengirimnya sebagai pesan MAVLink, lalu membalas hasilnya.

```
Wahana / SITL  <--MAVLink-->  mavlink_engine  <--Redis-->  Backend  <--WebSocket-->  Frontend
```

## Persiapan

Kamu butuh Python 3.10 atau lebih baru dan server Redis yang berjalan.

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Menjalankan

Jalankan dari folder **di atas** `mavlink_engine/`, sebagai modul:

```bash
python3 -m mavlink_engine.main
```

Contoh untuk SITL, dengan perintah dinyalakan:

```bash
ENABLE_COMMANDS=1 MAVLINK_URL=udpin:0.0.0.0:14551 python -m mavlink_engine.main
```

Kalau koneksi putus, engine mencoba terhubung lagi setiap 5 detik.

## Konfigurasi

Semua pengaturan dibaca dari environment variable (`config.py`).

| Variable | Default | Fungsi |
|---|---|---|
| `MAVLINK_URL` | `udpin:0.0.0.0:14551` | Alamat koneksi ke wahana atau SITL |
| `REDIS_HOST` | `localhost` | Host Redis |
| `REDIS_PORT` | `6379` | Port Redis |
| `REDIS_CHANNEL` | `telemetry` | Channel telemetri |
| `REDIS_COMMAND_CHANNEL` | `commands` | Channel perintah dari backend |
| `REDIS_ACK_CHANNEL` | `command_acks` | Channel balasan perintah |
| `REDIS_CALIBRATION_CHANNEL` | `calibration_events` | Channel event kalibrasi dan waypoint |
| `PUBLISH_INTERVAL` | `0.05` | Jeda publikasi telemetri (detik), 20 kali per detik |
| `ENABLE_COMMANDS` | `0` | `1` untuk mengizinkan perintah ke wahana |
| `ALLOW_FORCE_ARM` | `0` | `1` untuk mengizinkan arm paksa |
| `COMMAND_TIMEOUT` | `3` | Batas tunggu balasan perintah (detik) |
| `MISSION_TIMEOUT` | `3` | Batas tunggu tiap langkah misi (detik) |
| `MISSION_MAX_RETRIES` | `3` | Jumlah ulang kirim waypoint |
| `MAX_WAYPOINTS` | `100` | Batas jumlah waypoint |
| `MAX_ALTITUDE` | `120` | Batas ketinggian waypoint (meter) |

**Keamanan:** `ENABLE_COMMANDS` bernilai `0` secara default. Selama nilainya `0`, engine menolak semua perintah ke wahana, termasuk arm, ganti mode, misi, parameter, dan kalibrasi. Nyalakan hanya untuk SITL. Untuk pesawat asli, biarkan `0`.

## Struktur folder

```
mavlink_engine/
│
├── __init__.py
├── config.py
├── main.py
├── requirements.txt
│
├── parsers/
│   ├── __init__.py
│   ├── mission_parser.py
│   └── telemetry_parser.py
│
├── services/
│   ├── __init__.py
│   ├── calibration_service.py
│   ├── command_service.py
│   ├── mavlink_service.py
│   ├── mission_service.py
│   ├── parameter_service.py
│   ├── redis_service.py
│   └── tlog_service.py
│
└── tests/
    ├── test_calibration_service.py
    ├── test_command_service.py
    ├── test_main.py
    ├── test_mavlink_service.py
    ├── test_mission_service.py
    ├── test_parameter_service.py
    ├── test_redis_service.py
    ├── test_telemetry_parser.py
    └── test_tlog_service.py
```

Setiap file di `services/` berisi satu kelas dengan satu tugas. `main.py` membuat objek-objek itu dan menjalankan loop. `parsers/` berisi fungsi biasa tanpa state.

## Cara kerja

Tiap putaran loop, engine:

1. Membaca pesan MAVLink dari wahana.
2. Mengubahnya menjadi JSON dan menggabungkannya dalam satu paket telemetri.
3. Mengirim paket itu ke channel `telemetry`, hanya kalau semua tipe pesan masih segar. Batas segar adalah 2 detik, dan 5 detik untuk `HEARTBEAT`, `SYS_STATUS`, `GPS_RAW_INT`, dan `SCALED_IMU`.
4. Membaca perintah dari channel `commands` (paling banyak 10 per putaran), menjalankannya, lalu mengirim balasan ke `command_acks`.

Engine mengenali wahana lewat heartbeat dari autopilot. Heartbeat dari GCS atau perangkat lain diabaikan, dan hanya pesan dari wahana itu yang diproses.

## Telemetri

Paket JSON di channel `telemetry` memuat kolom berikut:

| Kelompok | Kolom |
|---|---|
| Posisi | `lat`, `lon`, `alt`, `rel_alt`, `home_lat`, `home_lon` |
| Sikap | `roll`, `pitch`, `yaw`, `heading` |
| Kecepatan | `airspeed`, `groundspeed` |
| Status | `armed`, `flight_mode`, `battery_percent`, `heartbeat_timestamp` |
| GPS | `gps_fix_type`, `satellites_visible`, `hdop` |
| IMU | `imu_ax`, `imu_ay`, `imu_az`, `imu_gx`, `imu_gy`, `imu_gz`, `imu_mx`, `imu_my`, `imu_mz` |
| Radio | `rssi`, `rssi_percent`, `rssi_dbm`, `radio_rssi`,
