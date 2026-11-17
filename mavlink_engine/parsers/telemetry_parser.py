import math
import time
from pymavlink import mavutil

HDG_UNKNOWN = 65535
DECIMALS = 2

def _round(value, digits=DECIMALS):
    return round(value, digits) + 0.0

def parse_pos(msg) -> dict:
    return {
        "lat": msg.lat / 1e7,
        "lon": msg.lon / 1e7,
        "alt": _round(msg.alt / 1000),
        "rel_alt": _round(msg.relative_alt / 1000),
        "heading": None if msg.hdg == HDG_UNKNOWN else msg.hdg / 100,
    }

def parse_attitude(msg) -> dict:
    return {
        "roll": _round(math.degrees(msg.roll)),
        "pitch": _round(math.degrees(msg.pitch)),
        "yaw": _round(math.degrees(msg.yaw)),
    }

def parse_vfr_hud(msg) -> dict:
    return {
        "airspeed": _round(msg.airspeed),
        "groundspeed": _round(msg.groundspeed),
    }

def parse_heartbeat(msg) -> dict | None:
    if msg.autopilot == mavutil.mavlink.MAV_AUTOPILOT_INVALID:
        return None
    return {
        "armed": bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED),
        "flight_mode": mavutil.mode_string_v10(msg),
        "heartbeat_timestamp": int(time.time() * 1000),
    }

def parse_sys_status(msg) -> dict:
    pct = msg.battery_remaining
    return {
        "battery_percent": None if pct < 0 else pct,
    }

def parse_gps(msg) -> dict:
    return {
        "gps_fix_type": msg.fix_type,
        "satellites_visible": None if msg.satellites_visible == 255 else msg.satellites_visible,
        "hdop": None if msg.eph == 65535 else _round(msg.eph / 100),
    }

def parse_home(msg) -> dict:
    return {"home_lat": msg.latitude / 1e7, "home_lon": msg.longitude / 1e7}

G = 9.81

def parse_imu(msg) -> dict:
    """SCALED_IMU: acc in mG, gyro in mrad/s, mag in mgauss."""
    return {
        "imu_ax": _round(msg.xacc / 1000 * G),
        "imu_ay": _round(msg.yacc / 1000 * G),
        "imu_az": _round(msg.zacc / 1000 * G),
        "imu_gx": _round(math.degrees(msg.xgyro / 1000)),
        "imu_gy": _round(math.degrees(msg.ygyro / 1000)),
        "imu_gz": _round(math.degrees(msg.zgyro / 1000)),
        "imu_mx": _round(msg.xmag / 1000, 3),
        "imu_my": _round(msg.ymag / 1000, 3),
        "imu_mz": _round(msg.zmag / 1000, 3),
    }

RSSI_UNKNOWN = 255

def valid(value):
    return None if value == RSSI_UNKNOWN else value

def rssi_dbm(raw):
    """SiK radio (3DR / RFD900) RSSI and noise: dBm = raw / 1.9 - 127. Other radios use other scales."""
    return None if raw is None else _round(raw / 1.9 - 127, 1)

def parse_rc_channels(msg) -> dict:
    """RC receiver signal (not the telemetry radio). 0-254, 255 = unknown."""
    rssi = valid(msg.rssi)
    return {
        "rssi": rssi,
        "rssi_percent": None if rssi is None else min(100, _round((rssi / 254) * 100, 0)),
    }

def parse_radio_status(msg) -> dict:
    """Telemetry radio link. Raw values plus dBm (SiK scale)."""
    rssi = valid(msg.rssi)
    remrssi = valid(msg.remrssi)
    return {
        "radio_rssi": rssi,
        "radio_rssi_dbm": rssi_dbm(rssi),
        "radio_remrssi": remrssi,
        "radio_remrssi_dbm": rssi_dbm(remrssi),
        "radio_noise_dbm": rssi_dbm(valid(msg.noise)),
        "radio_txbuf": msg.txbuf,
    }

HANDLERS = {
    "GLOBAL_POSITION_INT": parse_pos,
    "ATTITUDE": parse_attitude,
    "VFR_HUD": parse_vfr_hud,
    "HEARTBEAT": parse_heartbeat,
    "SYS_STATUS": parse_sys_status,
    "GPS_RAW_INT": parse_gps,
    "HOME_POSITION": parse_home,
    "SCALED_IMU": parse_imu,  
    "RC_CHANNELS": parse_rc_channels,
    "RADIO_STATUS": parse_radio_status,
}

def parse_message(msg):
    handler = HANDLERS.get(msg.get_type())
    return handler(msg) if handler else None