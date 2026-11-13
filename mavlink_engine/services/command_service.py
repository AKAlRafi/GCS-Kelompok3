"""MAVLink command service for ArduPlane (fixed wing)."""

import logging
import time
from pymavlink import mavutil
from .. import config

logger = logging.getLogger(__name__)

ALLOWED_COMMANDS = {"arm", "disarm", "set_mode", "mode", "rtl", "land", "takeoff", "guided_goto",
                    "change_speed", "start_mission", "pause_mission", "resume_mission"}

# MAVLink command acknowledgment result codes (MAV_RESULT)
COMMAND_RESULT_NAMES = {
    0: "MAV_RESULT_ACCEPTED",
    1: "MAV_RESULT_TEMPORARILY_REJECTED",
    2: "MAV_RESULT_DENIED",
    3: "MAV_RESULT_UNSUPPORTED",
    4: "MAV_RESULT_FAILED",
    5: "MAV_RESULT_IN_PROGRESS",
    6: "MAV_RESULT_CANCELLED",
}


class CommandService:
    def __init__(self, mavlink_service, timeout: float = 3.0):
        self.mavlink = mavlink_service
        self.timeout = getattr(config, "COMMAND_TIMEOUT", timeout)
        self.enabled = getattr(config, "ENABLE_COMMANDS", False)

    def is_connected(self) -> bool:
        """Check whether the MAVLink master connection is active."""
        return self.mavlink is not None and self.mavlink.master() is not None

    def extract_params(self, payload: dict) -> dict:
        """Support both flat JSON payloads and nested 'params' dictionaries."""
        nested = payload.get("params")
        if isinstance(nested, dict):
            return {**nested, **{k: v for k, v in payload.items() if k not in ("command", "params")}}
        return {k: v for k, v in payload.items() if k != "command"}

    def validate_command(self, payload: dict) -> tuple[bool, str, str, dict]:
        """Validate command whitelist and parameters.
        Returns:
            (is_valid, error_message, normalized_command, extracted_params)
        """
        if not isinstance(payload, dict):
            return False, "Command payload must be a dictionary", "", {}
        raw_cmd = payload.get("command")
        if not isinstance(raw_cmd, str) or not raw_cmd.strip():
            return False, "Missing or invalid 'command' field", "", {}
        cmd = raw_cmd.strip().lower()
        if cmd not in ALLOWED_COMMANDS:
            return False, f"Command '{cmd}' is not allowed", cmd, {}
        params = self.extract_params(payload)
        if cmd in ("arm", "disarm"):
            if "force" in params and not isinstance(params["force"], bool):
                return False, "Parameter 'force' must be a boolean", cmd, params
            if "arm" in params and not isinstance(params["arm"], bool):
                return False, "Parameter 'arm' must be a boolean", cmd, params
            if params.get("force") and not getattr(config, "ALLOW_FORCE_ARM", False):
                return False, "Force arm/disarm is disabled", cmd, params
        elif cmd in ("set_mode", "mode"):
            mode_val = params.get("mode")
            if not isinstance(mode_val, str) or not mode_val.strip():
                return False, "Parameter 'mode' must be a non-empty string", cmd, params
            params["mode"] = mode_val.strip().upper()

        def _num(key, lo, hi):
            v = params.get(key)
            return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi

        max_alt = getattr(config, "MAX_ALTITUDE", 500)
        # Plane climbs to TKOFF_ALT on the FC, so altitude_m is optional (checked if given)
        if cmd == "takeoff" and "altitude_m" in params and not _num("altitude_m", 1, max_alt):
            return False, "altitude_m out of range", cmd, params
        if cmd == "guided_goto" and not (_num("lat", -90, 90) and _num("lon", -180, 180) and _num("alt", 1, max_alt)):
            return False, "guided_goto needs valid lat, lon, alt", cmd, params
        if cmd == "change_speed" and not _num("speed_mps", 0.5, 50):
            return False, "speed_mps must be 0.5-50", cmd, params

        return True, "", cmd, params

    def wait_command_ack(self, expected_command: int, command_name: str) -> dict:
        """Wait for a matching COMMAND_ACK from the vehicle."""
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            msg = self.mavlink.wait_for(
                ["COMMAND_ACK"], remaining,
                match=lambda m: m.command == expected_command,
            )
            if msg is None:
                break
            if msg.result == mavutil.mavlink.MAV_RESULT_IN_PROGRESS:
                logger.info(f"Command '{command_name}' in progress...")
                continue
            if msg.result == mavutil.mavlink.MAV_RESULT_ACCEPTED:
                logger.info(f"Command '{command_name}' accepted by vehicle")
                return {"ok": True, "command": command_name, "result": COMMAND_RESULT_NAMES[0]}
            reason = COMMAND_RESULT_NAMES.get(msg.result, f"CODE_{msg.result}")
            logger.warning(f"Command '{command_name}' rejected: {reason}")
            return {"ok": False, "error": f"Command rejected: {reason}"}
        logger.warning(f"Timeout waiting for COMMAND_ACK on '{command_name}'")
        return {"ok": False, "error": f"Command '{command_name}' failed: timeout exceeded"}

    def send_command_long(
        self,
        command_id: int,
        param1: float = 0.0,
        param2: float = 0.0,
        param3: float = 0.0,
        param4: float = 0.0,
        param5: float = 0.0,
        param6: float = 0.0,
        param7: float = 0.0,
    ):
        """Send a MAVLink COMMAND_LONG message to the target vehicle."""
        master = self.mavlink.master()
        master.mav.command_long_send(
            master.target_system,
            master.target_component,
            command_id,
            0,  # Confirmation
            param1,
            param2,
            param3,
            param4,
            param5,
            param6,
            param7,
        )

    def handle_arm_disarm(self, arm: bool, force: bool = False) -> dict:
        command_name = "arm" if arm else "disarm"
        param1 = 1.0 if arm else 0.0
        param2 = 21196.0 if force else 0.0  # ArduPilot force arm/disarm magic number
        self.send_command_long(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            param1=param1,
            param2=param2,
        )
        return self.wait_command_ack(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            command_name,
        )

    def handle_set_mode(self, mode_name: str) -> dict:
        master = self.mavlink.master()
        mode_mapping = master.mode_mapping()
        if not isinstance(mode_mapping, dict) or mode_name not in mode_mapping:
            return {"ok": False, "error": f"Unsupported flight mode: {mode_name}"}
        mode_id = mode_mapping[mode_name]
        self.send_command_long(
            mavutil.mavlink.MAV_CMD_DO_SET_MODE,
            param1=float(mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED),
            param2=float(mode_id),
        )
        return self.wait_command_ack(
            mavutil.mavlink.MAV_CMD_DO_SET_MODE,
            f"set_mode:{mode_name}",
        )

    def handle_long(self, command_id, name, **p):
        self.send_command_long(command_id, **p)
        return self.wait_command_ack(command_id, name)

    @staticmethod
    def _renamed(result: dict, name: str, note: str | None = None) -> dict:
        """Re-label a set_mode result so the ack carries the command the caller sent."""
        if not result.get("ok"):
            return result
        out = {**result, "command": name}
        if note:
            out["note"] = note
        return out

    def handle_takeoff(self) -> dict:
        """ArduPlane rejects NAV_TAKEOFF as a direct command, so use TAKEOFF mode.
        The climb altitude comes from the FC parameter TKOFF_ALT."""
        return self._renamed(
            self.handle_set_mode("TAKEOFF"), "takeoff",
            "Plane climbs to TKOFF_ALT set on the FC; altitude_m is not sent",
        )

    def handle_start_mission(self) -> dict:
        return self._renamed(self.handle_set_mode("AUTO"), "start_mission")

    def handle_change_speed(self, speed):
        # param1 = 0 -> airspeed, param3 = -1 -> no throttle change
        return self.handle_long(mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED, "change_speed",
                                param1=0.0, param2=float(speed), param3=-1.0)

    def handle_guided_goto(self, lat, lon, alt):
        """DO_REPOSITION (the command GCS 'go to' uses); switches the plane to GUIDED."""
        master = self.mavlink.master()
        master.mav.command_int_send(
            master.target_system, master.target_component,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            mavutil.mavlink.MAV_CMD_DO_REPOSITION,
            0, 0,
            -1.0,   # speed: default
            1.0,    # flags: change mode to GUIDED
            0.0,    # radius: default
            float("nan"),   # yaw: unchanged
            int(round(lat * 1e7)), int(round(lon * 1e7)), float(alt),
        )
        return self.wait_command_ack(mavutil.mavlink.MAV_CMD_DO_REPOSITION, "guided_goto")

    def handle_rtl(self) -> dict:
        self.send_command_long(mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH)
        return self.wait_command_ack(
            mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
            "rtl",
        )

    def handle_land(self) -> dict:
        self.send_command_long(mavutil.mavlink.MAV_CMD_NAV_LAND)
        return self.wait_command_ack(
            mavutil.mavlink.MAV_CMD_NAV_LAND,
            "land",
        )

    def execute_command(self, payload: dict) -> dict:
        """Validate and execute an allowed vehicle command."""
        if not self.enabled:
            return {"ok": False, "error": "Commands are disabled (ENABLE_COMMANDS=0)"}
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}
        valid, err_msg, cmd, params = self.validate_command(payload)
        if not valid:
            return {"ok": False, "error": err_msg}
        logger.info(f"Executing command '{cmd}' with params={params}")
        try:
            if cmd == "arm":
                arm_flag = params.get("arm", True)
                force_flag = params.get("force", False)
                return self.handle_arm_disarm(arm=arm_flag, force=force_flag)
            if cmd == "disarm":
                force_flag = params.get("force", False)
                return self.handle_arm_disarm(arm=False, force=force_flag)
            if cmd in ("set_mode", "mode"):
                return self.handle_set_mode(params["mode"])
            if cmd == "rtl":
                return self.handle_rtl()
            if cmd == "land":
                return self.handle_land()
            if cmd == "takeoff":
                return self.handle_takeoff()
            if cmd == "guided_goto":
                return self.handle_guided_goto(params["lat"], params["lon"], params["alt"])
            if cmd == "change_speed":
                return self.handle_change_speed(params["speed_mps"])
            if cmd == "start_mission":
                return self.handle_start_mission()
            if cmd == "pause_mission":
                return self.handle_set_mode("LOITER")
            if cmd == "resume_mission":
                return self.handle_set_mode("AUTO")
        except OSError as e:
            logger.error(f"Connection error executing command '{cmd}': {e}")
            return {"ok": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.exception(f"Unexpected error executing command '{cmd}': {e}")
            return {"ok": False, "error": f"Unexpected error: {e}"}
        return {"ok": False, "error": f"Unhandled command: {cmd}"}