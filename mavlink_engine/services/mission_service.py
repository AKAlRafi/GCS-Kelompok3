"""MAVLink mission protocol: upload, download and clear a mission."""

import logging
import time
import math
from pymavlink import mavutil
from .. import config
from ..parsers.mission_parser import parse_mission_item

logger = logging.getLogger(__name__)

# MAVLink mission result codes (MAV_MISSION_RESULT)
MISSION_RESULT_NAMES = {
    0: "MAV_MISSION_ACCEPTED",
    1: "MAV_MISSION_ERROR",
    2: "MAV_MISSION_UNSUPPORTED_FRAME",
    3: "MAV_MISSION_UNSUPPORTED",
    4: "MAV_MISSION_NO_SPACE",
    5: "MAV_MISSION_INVALID",
    6: "MAV_MISSION_INVALID_PARAM1",
    7: "MAV_MISSION_INVALID_PARAM2",
    8: "MAV_MISSION_INVALID_PARAM3",
    9: "MAV_MISSION_INVALID_PARAM4",
    10: "MAV_MISSION_INVALID_PARAM5_X",
    11: "MAV_MISSION_INVALID_PARAM6_Y",
    12: "MAV_MISSION_INVALID_PARAM7_Z",
    13: "MAV_MISSION_INVALID_SEQUENCE",
    14: "MAV_MISSION_DENIED",
    15: "MAV_MISSION_OPERATION_CANCELLED",
}

# Allowed commands for mission
ALLOWED_MISSION_COMMANDS = {16, 19, 20, 21, 22, 115, 178, 183, 203}


class MissionService:
    def __init__(self, mavlink_service, timeout, max_retries):
        self.mavlink = mavlink_service
        self.timeout = config.MISSION_TIMEOUT
        self.max_retries = config.MISSION_MAX_RETRIES
        self.max_waypoints = config.MAX_WAYPOINTS
        self.max_altitude = config.MAX_ALTITUDE

    def is_connected(self) -> bool:
        return self.mavlink is not None and self.mavlink.master() is not None

    def wait_message(self, msg_types: list[str], timeout: float | None = None):
        wait_time = timeout if timeout is not None else self.timeout
        return self.mavlink.wait_for(msg_types, wait_time)

    def validate_waypoints(self, waypoints: list[dict]) -> tuple[bool, str]:
        """Validate waypoint structure, data types, and safety bounds."""
        if not isinstance(waypoints, list) or len(waypoints) == 0:
            return False, "Waypoint list is empty"
        if len(waypoints) > self.max_waypoints:
            return False, f"Waypoint count exceeds limit ({len(waypoints)} > {self.max_waypoints})"
        for i, wp in enumerate(waypoints):
            if not isinstance(wp, dict):
                return False, f"Waypoint {i} must be a dictionary"
            if not all(k in wp for k in ("lat", "lon", "alt")):
                return False, f"Waypoint {i} is missing required fields (lat, lon, alt)"
            try:
                lat = float(wp["lat"])
                lon = float(wp["lon"])
                alt = float(wp["alt"])
            except (TypeError, ValueError):
                return False, f"Waypoint {i} has invalid numeric coordinates or altitude"
            if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
                return False, f"Waypoint {i} coordinates out of valid range ({lat}, {lon})"
            if not math.isfinite(alt) or alt < 0 or alt > self.max_altitude:
                return False, f"Waypoint {i} altitude is out of safe bounds: {alt} m"
            try:
                cmd = int(wp.get("command", 16))
            except (TypeError, ValueError):
                return False, f"Waypoint {i} has invalid command"
            if cmd not in ALLOWED_MISSION_COMMANDS:
                return False, f"Waypoint {i} command {cmd} is not allowed"
        return True, ""

    def send_mission_item(self, seq: int, wp: dict):
        """Send a single mission item using MISSION_ITEM_INT format."""
        master = self.mavlink.master()
        try:
            frame = int(wp.get("frame", mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT))
            command = int(wp.get("command", mavutil.mavlink.MAV_CMD_NAV_WAYPOINT))
            current = int(wp.get("current", 1 if seq == 0 else 0))
            autocontinue = int(wp.get("autocontinue", 1))

            param1 = float(wp.get("param1", 0.0))
            param2 = float(wp.get("param2", 0.0))
            param3 = float(wp.get("param3", 0.0))
            param4 = float(wp.get("param4", 0.0))

            lat_int = int(round(float(wp["lat"]) * 1e7))
            lon_int = int(round(float(wp["lon"]) * 1e7))
            alt_float = float(wp["alt"])
        except (TypeError, ValueError, KeyError) as e:
            raise ValueError(f"Invalid parameter format on waypoint {seq}: {e}") from e
        try:
            master.mav.mission_item_int_send(
                master.target_system,
                master.target_component,
                seq,
                frame,
                command,
                current,
                autocontinue,
                param1,
                param2,
                param3,
                param4,
                lat_int,
                lon_int,
                alt_float,
            )
        except OSError as e:
            logger.error(f"Connection error sending waypoint {seq}: {e}")
            raise

    def upload_mission(self, waypoints: list[dict]) -> dict:
        """Upload a list of waypoints to the vehicle using the MAVLink mission protocol."""
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}
        valid, err_msg = self.validate_waypoints(waypoints)
        if not valid:
            return {"ok": False, "error": err_msg}
        master = self.mavlink.master()
        home = {"lat": 0.0, "lon": 0.0, "alt": 0.0, "frame": mavutil.mavlink.MAV_FRAME_GLOBAL,
                "command": mavutil.mavlink.MAV_CMD_NAV_WAYPOINT, "current": 0}
        items = [home] + list(waypoints)   # ArduPilot: seq 0 = home
        count = len(items)
        deadline = time.monotonic() + self.timeout * self.max_retries * 3 + count * self.timeout
        logger.info(f"Starting mission upload for {count - 1} waypoints.")
        try:
            for attempt in range(1, self.max_retries + 1):
                master.mav.mission_count_send(
                    master.target_system,
                    master.target_component,
                    count,
                )
                while True:
                    if time.monotonic() > deadline:
                        return {"ok": False, "error": "Mission upload failed: overall timeout"}
                    msg = self.wait_message(["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"])
                    if msg is None:
                        logger.warning(f"Timeout during mission upload on attempt {attempt}/{self.max_retries}")
                        break
                    msg_type = msg.get_type()
                    if msg_type in ("MISSION_REQUEST_INT", "MISSION_REQUEST"):
                        seq = msg.seq
                        if seq < 0 or seq >= count:
                            return {"ok": False, "error": f"Requested sequence out of range: {seq}"}
                        self.send_mission_item(seq, items[seq])
                    elif msg_type == "MISSION_ACK":
                        if msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                            logger.info(f"Mission upload succeeded: {count} waypoints")
                            return {"ok": True, "count": count - 1}
                        reason = MISSION_RESULT_NAMES.get(msg.type, f"CODE_{msg.type}")
                        logger.error(f"Mission upload rejected by vehicle: {reason}")
                        return {"ok": False, "error": f"Mission rejected: {reason}"}
        except ValueError as e:
            logger.error(f"Mission upload data error: {e}")
            return {"ok": False, "error": str(e)}
        except OSError as e:
            logger.error(f"Mission upload connection error: {e}")
            return {"ok": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.exception(f"Unexpected error during mission upload: {e}")
            return {"ok": False, "error": f"Unexpected error: {e}"}

        return {"ok": False, "error": "Mission upload failed: timeout exceeded"}

    def download_mission(self) -> dict:
        """Download the complete mission list stored on the vehicle."""
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}
        master = self.mavlink.master()
        logger.info("Starting mission download from vehicle.")
        try:
            count = None
            for attempt in range(1, self.max_retries + 1):
                master.mav.mission_request_list_send(
                    master.target_system,
                    master.target_component,
                )
                msg = self.wait_message(["MISSION_COUNT"])
                if msg is not None:
                    count = msg.count
                    break
                logger.warning(f"Timeout waiting for MISSION_COUNT on attempt {attempt}/{self.max_retries}")
            if count is None:
                return {"ok": False, "error": "Mission download failed: no MISSION_COUNT response"}
            if count == 0:
                master.mav.mission_ack_send(
                    master.target_system,
                    master.target_component,
                    mavutil.mavlink.MAV_MISSION_ACCEPTED,
                )
                return {"ok": True, "count": 0, "waypoints": []}

            waypoints = []
            for seq in range(count):
                item_received = False
                for attempt in range(1, self.max_retries + 1):
                    master.mav.mission_request_int_send(
                        master.target_system,
                        master.target_component,
                        seq,
                    )
                    msg = self.wait_message(["MISSION_ITEM_INT", "MISSION_ITEM"])
                    if msg is not None and msg.seq == seq:
                        waypoints.append(parse_mission_item(msg))
                        item_received = True
                        break
                    logger.warning(f"Timeout waiting for waypoint {seq} on attempt {attempt}/{self.max_retries}")
                if not item_received:
                    return {
                        "ok": False,
                        "error": f"Mission download failed at waypoint {seq}",
                    }
            master.mav.mission_ack_send(
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_MISSION_ACCEPTED,
            )
            logger.info(f"Mission download succeeded: {len(waypoints)} waypoints")
            waypoints = waypoints[1:]
            for i, wp in enumerate(waypoints):
                wp["seq"] = i
            return {"ok": True, "count": len(waypoints), "waypoints": waypoints}
        except OSError as e:
            logger.error(f"Mission download connection error: {e}")
            return {"ok": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.exception(f"Unexpected error during mission download: {e}")
            return {"ok": False, "error": f"Unexpected error: {e}"}

    def clear_mission(self) -> dict:
        """Clear all mission items stored on the vehicle."""
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}
        master = self.mavlink.master()
        logger.info("Clearing mission on vehicle.")
        try:
            for attempt in range(1, self.max_retries + 1):
                master.mav.mission_clear_all_send(
                    master.target_system,
                    master.target_component,
                )
                msg = self.wait_message(["MISSION_ACK"])
                if msg is not None:
                    if msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                        logger.info("Mission cleared from vehicle.")
                        return {"ok": True}
                    reason = MISSION_RESULT_NAMES.get(msg.type, f"CODE_{msg.type}")
                    return {"ok": False, "error": f"Failed to clear mission: {reason}"}
                logger.warning(f"Timeout clearing mission on attempt {attempt}/{self.max_retries}")

        except OSError as e:
            logger.error(f"Mission clear connection error: {e}")
            return {"ok": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.exception(f"Unexpected error clearing mission: {e}")
            return {"ok": False, "error": f"Unexpected error: {e}"}
        return {"ok": False, "error": "Mission clear failed: timeout exceeded"}