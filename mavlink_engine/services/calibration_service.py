"""Sensor calibration over MAVLink (ArduPilot).
Commands from the backend (type -> method):
    calibrate          {"sensor": "gyro|baro|airspeed|level|accel|accel_simple|mag"}
    calibrate_confirm  {"position": 1..6}   accel only: vehicle is now in that position
    calibrate_accept   {}                   mag only
    calibrate_cancel   {}

Progress goes out as events through the `publish` callback (Redis channel
`calibration_events`). on_message() must be called for every incoming message
of CALIBRATION_TYPES; main.py does that.
"""

import logging
import time
from pymavlink import mavutil
from .. import config
from .command_service import COMMAND_RESULT_NAMES

logger = logging.getLogger(__name__)

from .mavlink_service import CALIBRATION_TYPES  # noqa: F401
CALIBRATION_COMMANDS = {"calibrate", "calibrate_confirm", "calibrate_accept", "calibrate_cancel"}

# Sensors that finish by themselves with the COMMAND_ACK
INSTANT_SENSORS = {"gyro", "baro", "airspeed", "level"}
# Sensors that run a longer, interactive procedure
INTERACTIVE_SENSORS = {"accel", "accel_simple", "mag"}
SENSORS = INSTANT_SENSORS | INTERACTIVE_SENSORS

ACCEL_POSITIONS = {1: "LEVEL", 2: "LEFT", 3: "RIGHT", 4: "NOSE_DOWN", 5: "NOSE_UP", 6: "BACK"}
ACCEL_DONE = 16777215       # ACCELCAL_VEHICLE_POS_SUCCESS
ACCEL_FAILED = 16777216     # ACCELCAL_VEHICLE_POS_FAILED

MAG_CAL_SUCCESS = 4         # MAG_CAL_STATUS


class CalibrationService:
    def __init__(self, mavlink_service, publish=None, armed_fn=None, timeout = config.COMMAND_TIMEOUT):
        self.mavlink = mavlink_service
        self.publish = publish          # publish(event: dict) -> any
        self.armed_fn = armed_fn        # returns True / False / None (unknown)
        self.timeout = timeout
        self.sensor = None              # Sensor being calibrated (interactive only)

    # Helpers
    def event(self, status: str, **extra):
        data = {"event": "calibration", "sensor": self.sensor, "status": status,
                "timestamp": int(time.time() * 1000), **extra}
        if self.publish:
            try:
                self.publish(data)
            except Exception as e:
                logger.error(f"Calibration event publish failed: {e}")

    def precheck(self):
        if not config.ENABLE_COMMANDS:
            return {"ok": False, "error": "Commands are disabled (ENABLE_COMMANDS=0)"}
        if self.mavlink is None or self.mavlink.master() is None:
            return {"ok": False, "error": "MAVLink not connected"}
        return None

    def send_command(self, command: int, params, expected_ack: bool = True):
        """Send a COMMAND_LONG with up to 7 params; wait for its ACK. Returns (ok, result_name)."""
        p = list(params) + [0.0] * (7 - len(params))
        if not self.mavlink.send("command_long", self.mavlink.target_system(),
                                 self.mavlink.target_component(), command, 0, *p):
            return False, "SEND_FAILED"
        if not expected_ack:
            return True, "SENT"
        ack = self.mavlink.wait_for(["COMMAND_ACK"], self.timeout,
                                    match=lambda m: m.command == command)
        if ack is None:
            return False, "NO_ACK"
        name = COMMAND_RESULT_NAMES.get(ack.result, f"MAV_RESULT_{ack.result}")
        return ack.result in (0, 5), name

    # Command
    def start(self, sensor) -> dict:
        err = self.precheck()
        if err:
            return err
        if not isinstance(sensor, str) or sensor.lower() not in SENSORS:
            return {"ok": False, "error": f"Unknown sensor. Use one of: {', '.join(sorted(SENSORS))}"}
        sensor = sensor.lower()
        if self.armed_fn is None or self.armed_fn() is not False:
            return {"ok": False, "error": "Calibration needs a disarmed vehicle (armed state unknown or armed)"}
        if self.sensor is not None:
            return {"ok": False, "error": f"Calibration already running: {self.sensor}"}

        m = mavutil.mavlink
        if sensor == "gyro":
            cmd, params = m.MAV_CMD_PREFLIGHT_CALIBRATION, [1, 0, 0, 0, 0, 0, 0]
        elif sensor in ("baro", "airspeed"):
            cmd, params = m.MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 1, 0, 0, 0, 0]
        elif sensor == "level":
            cmd, params = m.MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 2, 0, 0]
        elif sensor == "accel":
            cmd, params = m.MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 1, 0, 0]
        elif sensor == "accel_simple":
            cmd, params = m.MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 4, 0, 0]
        else:  # mag: all compasses, no retry, autosave, no delay, no autoreboot
            cmd, params = m.MAV_CMD_DO_START_MAG_CAL, [0, 0, 1, 0, 0, 0, 0]

        self.sensor = sensor
        self.event("started")
        ok, result = self.send_command(cmd, params)
        if not ok:
            self.event("failed", message=result)
            self.sensor = None
            return {"ok": False, "error": f"Calibration rejected: {result}", "command": f"calibrate:{sensor}"}

        if sensor in INSTANT_SENSORS:
            self.event("done", message=result)
            self.sensor = None
        elif sensor == "mag":
            # Ask for progress reports (best effort, no ACK)
            for msg_id in (191, 192):
                self.send_command(m.MAV_CMD_SET_MESSAGE_INTERVAL, [msg_id, 200000], expected_ack=False)
        return {"ok": True, "command": f"calibrate:{sensor}", "result": result}

    def confirm_position(self, position) -> dict:
        err = self.precheck()
        if err:
            return err
        if self.sensor not in ("accel",):
            return {"ok": False, "error": "No accelerometer calibration is running"}
        try:
            pos = int(position)
        except (TypeError, ValueError):
            return {"ok": False, "error": "position must be an integer 1-6"}
        if pos not in ACCEL_POSITIONS:
            return {"ok": False, "error": "position must be 1-6"}
        # The FC wants the same command echoed back with the same param1
        ok, _ = self.send_command(mavutil.mavlink.MAV_CMD_ACCELCAL_VEHICLE_POS, [pos], expected_ack=False)
        if not ok:
            return {"ok": False, "error": "Failed to send position confirmation"}
        self.event("position_confirmed", position=pos, name=ACCEL_POSITIONS[pos])
        return {"ok": True, "command": f"calibrate_confirm:{pos}", "result": "SENT"}

    def accept(self) -> dict:
        err = self.precheck()
        if err:
            return err
        if self.sensor != "mag":
            return {"ok": False, "error": "No compass calibration is running"}
        ok, result = self.send_command(mavutil.mavlink.MAV_CMD_DO_ACCEPT_MAG_CAL, [0])
        if not ok:
            return {"ok": False, "error": f"Accept rejected: {result}"}
        return {"ok": True, "command": "calibrate_accept", "result": result}

    def cancel(self) -> dict:
        err = self.precheck()
        if err:
            return err
        if self.sensor is None:
            return {"ok": False, "error": "No calibration is running"}
        result = "CANCELLED"
        if self.sensor == "mag":
            ok, result = self.send_command(mavutil.mavlink.MAV_CMD_DO_CANCEL_MAG_CAL, [0])
            if not ok:
                return {"ok": False, "error": f"Cancel rejected: {result}"}
        self.event("cancelled")
        self.sensor = None
        return {"ok": True, "command": "calibrate_cancel", "result": result}

    def execute(self, name: str, params: dict) -> dict:
        if name == "calibrate":
            return self.start(params.get("sensor"))
        if name == "calibrate_confirm":
            return self.confirm_position(params.get("position"))
        if name == "calibrate_accept":
            return self.accept()
        if name == "calibrate_cancel":
            return self.cancel()
        return {"ok": False, "error": f"Unknown calibration command: {name}"}

    # Incoming messages
    def on_message(self, msg) -> None:
        if self.sensor is None:
            return
        t = msg.get_type()
        if t == "STATUSTEXT":
            text = msg.text.decode(errors="replace") if isinstance(msg.text, bytes) else str(msg.text)
            self.event("message", message=text.rstrip("\x00"), severity=msg.severity)
        elif t == "COMMAND_LONG" and self.sensor == "accel" \
                and msg.command == mavutil.mavlink.MAV_CMD_ACCELCAL_VEHICLE_POS:
            value = int(msg.param1)
            if value == ACCEL_DONE:
                self.event("done")
                self.sensor = None
            elif value == ACCEL_FAILED:
                self.event("failed", message="Accelerometer calibration failed")
                self.sensor = None
            elif value in ACCEL_POSITIONS:
                self.event("position_needed", position=value, name=ACCEL_POSITIONS[value])
        elif t == "MAG_CAL_PROGRESS" and self.sensor == "mag":
            self.event("progress", percent=msg.completion_pct, compass_id=msg.compass_id)
        elif t == "MAG_CAL_REPORT" and self.sensor == "mag":
            if msg.cal_status == MAG_CAL_SUCCESS:
                self.event("done", compass_id=msg.compass_id, fitness=round(msg.fitness, 2),
                           autosaved=bool(msg.autosaved))
            else:
                self.event("failed", compass_id=msg.compass_id,
                           message=f"Compass calibration failed (status {msg.cal_status})")
            self.sensor = None