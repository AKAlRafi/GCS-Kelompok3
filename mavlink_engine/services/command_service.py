"""MAVLink command service: validate JSON commands and dispatch to vehicle."""

import logging
import time
from pymavlink import mavutil
from .. import config

logger = logging.getLogger(__name__)

ALLOWED_COMMANDS = {"arm", "disarm", "set_mode", "mode", "rtl", "land", "takeoff", "guided_goto",
                    "condition_yaw", "change_speed", "start_mission", "pause_mission", "resume_mission"}

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
    def __init__(self, mavlink_service, timeout: float = config.COMMAND_TIMEOUT):
        self.mavlink = mavlink_service
        self.timeout = timeout
        self.enabled = config.ENABLE_COMMANDS

    def is_connected(self) -> bool:
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
            if params.get("force") and not config.ALLOW_FORCE_ARM:
                return False, "Force arm/disarm is disabled", cmd, params
        elif cmd in ("set_mode", "mode"):
            mode_val = params.get("mode")
            if not isinstance(mode_val, str) or not mode_val.strip():
                return False, "Parameter 'mode' must be a non-empty string", cmd, params
            params["mode"] = mode_val.strip().upper()

        def _num(key, lo, hi):
            v = params.get(key)
            return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi

        max_alt = config.MAX_ALTITUDE
        if cmd == "takeoff" and not _num("altitude_m", 1, max_alt):
            return False, "altitude_m out of range", cmd, params
        if cmd == "guided_goto" and not (_num("lat", -90, 90) and _num("lon", -180, 180) and _num("alt", 1, max_alt)):
            return False, "guided_goto needs valid lat, lon, alt", cmd, params
        if cmd == "condition_yaw" and not (
            _num("angle_deg", 0, 360) and _num("speed_deg_s", 0.1, 180)
            and params.get("direction") in (-1, 1) and isinstance(params.get("relative"), bool)
        ):
            return False, "Invalid condition_yaw payload", cmd, params
        if cmd == "change_speed" and not _num("speed_mps", 0.5, 25):
            return False, "speed_mps must be 0.5-25", cmd, params

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
                logger.info(f"Command '{command_name}' in progress.")
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
    
    def handle_long(self, command_id, name, **p):
        self.send_command_long(command_id, **p)
        return self.wait_command_ack(command_id, name)

    def handle_takeoff(self, alt):
        return self.handle_long(mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, "takeoff", param7=float(alt))

    def handle_condition_yaw(self, angle, speed, direction, relative):
        return self.handle_long(mavutil.mavlink.MAV_CMD_CONDITION_YAW, "condition_yaw",
                                param1=float(angle), param2=float(speed),
                                param3=float(direction), param4=1.0 if relative else 0.0)

    def handle_change_speed(self, speed):
        return self.handle_long(mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED, "change_speed",
                                param1=1.0, param2=float(speed), param3=-1.0)

    def handle_start_mission(self):
        return self.handle_long(mavutil.mavlink.MAV_CMD_MISSION_START, "start_mission")

    def handle_guided_goto(self, lat, lon, alt):
        master = self.mavlink.master()
        master.mav.set_position_target_global_int_send(
            0, master.target_system, master.target_component,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            0b110111111000,                     # position only
            int(round(lat * 1e7)), int(round(lon * 1e7)), float(alt),
            0, 0, 0, 0, 0, 0, 0, 0
        )
        return {"ok": True, "command": "guided_goto", "result": "SENT"}   # No ACK exists for this message

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
                return self.handle_takeoff(params["altitude_m"])
            if cmd == "guided_goto":
                return self.handle_guided_goto(params["lat"], params["lon"], params["alt"])
            if cmd == "condition_yaw":
                return self.handle_condition_yaw(params["angle_deg"], params["speed_deg_s"],
                                                params["direction"], params["relative"])
            if cmd == "change_speed":
                return self.handle_change_speed(params["speed_mps"])
            if cmd == "start_mission":
                return self.handle_start_mission()
            if cmd == "pause_mission":
                return self.handle_set_mode("BRAKE")
            if cmd == "resume_mission":
                return self.handle_set_mode("AUTO")
            
        except OSError as e:
            logger.error(f"Connection error executing command '{cmd}': {e}")
            return {"ok": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.exception(f"Unexpected error executing command '{cmd}': {e}")
            return {"ok": False, "error": f"Unexpected error: {e}"}
        return {"ok": False, "error": f"Unhandled command: {cmd}"}