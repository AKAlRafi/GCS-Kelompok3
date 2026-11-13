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

HANDLERS = {
    "GLOBAL_POSITION_INT": parse_pos,
    "ATTITUDE": parse_attitude,
    "VFR_HUD": parse_vfr_hud,
    "HEARTBEAT": parse_heartbeat,
    "SYS_STATUS": parse_sys_status,
    "GPS_RAW_INT": parse_gps,
    "HOME_POSITION": parse_home,
}

def parse_message(msg):
    handler = HANDLERS.get(msg.get_type())
    return handler(msg) if handler else None