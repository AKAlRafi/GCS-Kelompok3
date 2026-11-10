import math

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

def parse_heartbeat(msg) -> dict:
    from pymavlink import mavutil
    return {
        "flight_mode": mavutil.mode_string_v10(msg),
        "armed": bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED),
    }

def parse_battery(msg) -> dict:
    return {"battery_percent": None if msg.battery_remaining < 0 else msg.battery_remaining}

HANDLERS = {
    "GLOBAL_POSITION_INT": parse_pos,
    "ATTITUDE": parse_attitude,
    "VFR_HUD": parse_vfr_hud,
    "HEARTBEAT": parse_heartbeat,
    "SYS_STATUS": parse_battery,
}

def parse_message(msg):
    handler = HANDLERS.get(msg.get_type())
    return handler(msg) if handler else None
