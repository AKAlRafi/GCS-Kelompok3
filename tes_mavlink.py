from pymavlink import mavutil
from datetime import datetime
import time

# 1. Hubungkan ke MAVProxy / SITL
# Menggunakan udpin untuk mendengarkan data yang dikirim via output add 127.0.0.1:14551
print("Menunggu heartbeat...")
master = mavutil.mavlink_connection('udpin:0.0.0.0:14551')

# Tunggu sampai sinyal heartbeat pertama tertangkap dari kendaraan/drone
master.wait_heartbeat()
print(f"Heartbeat terdeteksi dari sistem (system ID: {master.target_system}, component ID: {master.target_component})")
waktu = datetime.now().strftime("%H:%M:%S")

# 2. Loop utama untuk membaca data telemetri secara terus-menerus
try:
    while True:
        # Mengambil pesan MAVLink yang masuk
        msg = master.recv_match(blocking=True, timeout=1.0)
        
        if not msg:
            continue
            
        # Filter khusus untuk membaca data posisi/ketinggian (GLOBAL_POSITION_INT)
        if msg.get_type() == 'GLOBAL_POSITION_INT':
            lat = msg.lat / 1e7          # Latitude
            lon = msg.lon / 1e7          # Longitude
            alt = msg.relative_alt / 1e3 # Ketinggian relatif dari tanah (dalam meter)
            
            print(f"[{waktu}] Lat: {lat:.6f} | Lon: {lon:.6f} | Alt: {alt:.2f} meter")
            
        # Atau bisa juga memantau mode terbang yang sedang aktif
        elif msg.get_type() == 'HEARTBEAT':
            mode = mavutil.mode_string_v10(msg)
            # print(f"Mode aktif: {mode}")

except KeyboardInterrupt:
    print("\nProgram dihentikan oleh pengguna.")