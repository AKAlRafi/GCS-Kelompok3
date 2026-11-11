import math
from pymavlink import mavutil

HDG_UNKNOWN = 65535

def parse_pos(msg) -> dict:
    return {
        "lat": msg.lat / 1e7,
        "lon": msg.lon / 1e7,
        "alt": msg.alt / 1000,
        "rel_alt": msg.relative_alt / 1000,
        "heading": None if msg.hdg == HDG_UNKNOWN else msg.hdg / 100,
    }

def parse_attitude(msg) -> dict:
    return {
        "roll": math.degrees(msg.roll),
        "pitch": math.degrees(msg.pitch),
        "yaw": math.degrees(msg.yaw),
    }

def parse_vfr_hud(msg) -> dict:
    return {
        "airspeed": msg.airspeed,
        "groundspeed": msg.groundspeed,
    }

def parse_heartbeat(msg) -> dict | None:
    if msg.autopilot == mavutil.mavlink.MAV_AUTOPILOT_INVALID:
        return None
    return {
        "armed": bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED),
        "flight_mode": mavutil.mode_string_v10(msg),
    }

def parse_sys_status(msg) -> dict:
    pct = msg.battery_remaining
    return {
        "battery_percent": None if pct < 0 else pct,
    }

HANDLERS = {
    "GLOBAL_POSITION_INT": parse_pos,
    "ATTITUDE": parse_attitude,
    "VFR_HUD": parse_vfr_hud,
    "HEARTBEAT": parse_heartbeat,
    "SYS_STATUS": parse_sys_status,
}

def parse_message(msg):
    handler = HANDLERS.get(msg.get_type())
    return handler(msg) if handler else None