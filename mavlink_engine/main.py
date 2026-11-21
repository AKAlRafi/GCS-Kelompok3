"""Entry point: read MAVLink, parse, merge into state, publish to Redis, and handle commands."""

import logging
import math
import time
from pymavlink import mavutil
from .parsers.telemetry_parser import parse_message
from .services.calibration_service import CalibrationService, CALIBRATION_COMMANDS, CALIBRATION_TYPES
from .services.command_service import CommandService
from .services.mavlink_service import MavlinkService, TELEMETRY_TYPES
from .services.mission_service import MissionService
from .services.redis_service import RedisService
from .services.parameter_service import ParameterService
from .services.tlog_service import TlogService
from . import config

logger = logging.getLogger(__name__)

# State is published only when every field has been seen at least once
REQUIRED_KEYS = {
    "lat", "lon", "alt", "rel_alt", "heading",
    "roll", "pitch", "yaw", "airspeed", "groundspeed",
}

WAIT_TIMEOUT = 0.1               # Max wait for a message; the loop still wakes this often
MIN_PUBLISH_INTERVAL = config.PUBLISH_INTERVAL
RECONNECT_DELAY = 5.0            # Time in seconds between reconnect attempts
MAX_PUBLISH_FAILS = 20           # Consecutive failures before reconnecting Redis
DEFAULT_STALE_AFTER = 2.0
STALE_AFTER = {"HEARTBEAT": 5.0, "SYS_STATUS": 5.0, "GPS_RAW_INT": 5.0, "SCALED_IMU": 5.0}
HOME_REQUEST_INTERVAL = 5.0
# Messages not in the FC's default stream: message type -> (message id, interval in microseconds).
# Requested again every HOME_REQUEST_INTERVAL until the first one arrives (until then the request may be lost).
PARSE_ERROR_LOG_INTERVAL = 5.0   # Avoid log spam
MAX_COMMANDS_PER_TICK = 10       # Cap command processing per loop iteration
STREAM_REQUESTS = {"SCALED_IMU": (26, 100000), "RC_CHANNELS": (65, 500000), "SERVO_OUTPUT_RAW": (36, 200000)}   # For servo and IMU


def serial_ports_hint() -> str:
    """List serial ports the computer can see (helps when the FC is not found)."""
    try:
        from serial.tools import list_ports
        ports = [f"{p.device} ({p.description})" for p in list_ports.comports()]
    except ImportError:
        return "pyserial is not installed (pip install pyserial)"
    return ", ".join(ports) if ports else "none found"


def connect_mavlink(mav) -> None:
    """Block until the first heartbeat arrives (retry forever)."""
    print(f"[MAVLINK] Connecting to {mav.url} ...", flush=True)
    first_failure = True
    while not mav.connect():
        if first_failure and str(mav.url).lower().startswith("serial:"):
            print(f"[MAVLINK] No heartbeat. Serial ports seen: {serial_ports_hint()}", flush=True)
        first_failure = False
        logger.warning(f"Retrying MAVLink in {RECONNECT_DELAY}s")
        time.sleep(RECONNECT_DELAY)


class HeartbeatReporter:
    """Prints heartbeat status only when something changes, so the console stays quiet:
    first heartbeat, mode/armed change, heartbeat lost, heartbeat resumed."""

    def __init__(self, stale_after: float, out=print):
        self.stale_after = stale_after
        self.out = out
        self.seen = False
        self.lost = False
        self.last_time = 0.0
        self.last = (None, None)    # (flight_mode, armed)

    def _say(self, text: str):
        self.out(f"[HEARTBEAT] {time.strftime('%H:%M:%S')} {text}", flush=True)

    def on_heartbeat(self, parsed: dict, sysid: int, now: float):
        current = (parsed.get("flight_mode"), parsed.get("armed"))
        if not self.seen:
            self.seen = True
            self._say(f"first heartbeat from sysid={sysid}: mode={current[0]} armed={current[1]}")
        elif self.lost:
            self.lost = False
            self._say(f"resumed: mode={current[0]} armed={current[1]}")
        elif current != self.last:
            self._say(f"changed: mode={current[0]} armed={current[1]}")
        self.last = current
        self.last_time = now

    def check(self, now: float):
        if self.seen and not self.lost and now - self.last_time > self.stale_after:
            self.lost = True
            self._say(f"LOST (no heartbeat for more than {self.stale_after:.0f}s)")


def clean(data):
    """Replace NaN/inf with None (JSON null): redis_service rejects them."""
    if isinstance(data, dict):
        return {k: clean(v) for k, v in data.items()}
    if isinstance(data, list):
        return [clean(v) for v in data]
    return None if isinstance(data, float) and not math.isfinite(data) else data


MISSION_COMMANDS = ("upload_mission", "download_mission", "clear_mission")
PARAM_COMMANDS = ("download_params", "get_param", "set_param")


def dispatch_command(payload, command_svc, mission_svc, calibration_svc=None, param_svc=None) -> dict:
    """Route a backend message {id, type, payload} to MissionService or CommandService."""
    if not isinstance(payload, dict):
        return {"ok": False, "error": "Command payload must be a dictionary"}

    cmd_id = payload.get("id")
    raw_name = payload.get("type") or payload.get("command")
    inner = payload.get("payload")
    if not isinstance(inner, dict):
        inner = payload.get("params") if isinstance(payload.get("params"), dict) else {}

    if not isinstance(raw_name, str) or not raw_name.strip():
        res = {"ok": False, "error": "Missing or invalid command name"}
    else:
        name = raw_name.strip().lower()
        if name in MISSION_COMMANDS:
            if not getattr(config, "ENABLE_COMMANDS", False):
                res = {"ok": False, "error": "Commands are disabled (ENABLE_COMMANDS=0)"}
            elif name == "upload_mission":
                res = mission_svc.upload_mission(inner.get("waypoints"))
            elif name == "download_mission":
                res = mission_svc.download_mission()
            else:
                res = mission_svc.clear_mission()
        elif name in PARAM_COMMANDS:
            if param_svc is None:
                res = {"ok": False, "error": "Parameters are not available"}
            elif not getattr(config, "ENABLE_COMMANDS", False):
                res = {"ok": False, "error": "Commands are disabled (ENABLE_COMMANDS=0)"}
            elif name == "download_params":
                res = param_svc.download_all_params()
            elif name == "get_param":
                res = param_svc.get_param(inner.get("id"))
            else:
                res = param_svc.set_param(inner.get("id"), inner.get("value"), inner.get("type"))
        elif name in CALIBRATION_COMMANDS:
            if calibration_svc is None:
                res = {"ok": False, "error": "Calibration is not available"}
            else:
                res = calibration_svc.execute(name, inner)
        else:
            res = command_svc.execute_command({**inner, "command": name})

    return {"id": cmd_id, **res} if cmd_id is not None else res


def process_commands(
    redis_svc: RedisService,
    command_svc: CommandService,
    mission_svc: MissionService,
    calibration_svc=None,
    param_svc=None,
) -> int:
    """Read pending commands from Redis without blocking and publish acks."""
    processed = 0
    while processed < MAX_COMMANDS_PER_TICK:
        cmd_data = redis_svc.read_command()
        if cmd_data is None:
            break
        try:
            result = dispatch_command(cmd_data, command_svc, mission_svc, calibration_svc, param_svc)
        except Exception as e:
            logger.exception(f"Command failed: {e}")
            result = {"ok": False, "error": f"Internal error: {e}"}
            cid = cmd_data.get("id") if isinstance(cmd_data, dict) else None
            if cid is not None:
                result["id"] = cid
        redis_svc.publish_ack(clean(result))
        processed += 1
    return processed


def run() -> None:
    tlog_svc = TlogService()
    mav = MavlinkService(tlog_service=tlog_svc)
    redis_svc = RedisService()
    command_svc = CommandService(mav)
    mission_svc = MissionService(mav)
    state = {}
    param_svc = ParameterService(mav)
    param_svc.armed_fn = lambda: state.get("armed")
    calibration_svc = CalibrationService(mav, publish=redis_svc.publish_event,
                                         armed_fn=lambda: state.get("armed"))

    last_seen = {}          # Message type -> monotonic time of last message
    dirty = False           # True = new data not yet published
    last_publish = 0.0
    fail_count = 0
    last_redis_try = 0.0
    last_parse_error = 0.0
    stale_warned = False
    last_home_req = 0.0
    seen_types = set()      # Message types received at least once
    last_stream_req = {}    # Message type -> time of the last interval request
    heartbeat = HeartbeatReporter(STALE_AFTER["HEARTBEAT"])

    try:
        connect_mavlink(mav)
        if not redis_svc.connect():
            logger.warning("Redis not available yet; will retry while running.")

        while True:
            # Read incoming MAVLink telemetry and merge into state
            for msg in mav.read_messages(timeout=WAIT_TIMEOUT):
                seen_types.add(msg.get_type())
                if msg.get_type() in CALIBRATION_TYPES:
                    calibration_svc.on_message(msg)
                if msg.get_type() == "MISSION_ITEM_REACHED":
                    redis_svc.publish_event({
                        "event": "waypoint_reached",
                        "seq": msg.seq,
                        "timestamp": int(time.time() * 1000),
                    })
                try:
                    parsed = parse_message(msg)
                except AttributeError as e:
                    now = time.monotonic()
                    if now - last_parse_error >= PARSE_ERROR_LOG_INTERVAL:
                        logger.error(f"Unexpected message fields: {e}")
                        last_parse_error = now
                    continue
                if parsed:
                    state.update(parsed)
                    last_seen[msg.get_type()] = time.monotonic()
                    dirty = True
                    if msg.get_type() == "HEARTBEAT":
                        heartbeat.on_heartbeat(parsed, msg.get_srcSystem(), time.monotonic())

            # Check and execute pending commands from Redis
            process_commands(redis_svc, command_svc, mission_svc, calibration_svc, param_svc)

            tlog_svc.flush()

            now_m = time.monotonic()
            if "home_lat" not in state and now_m - last_home_req >= HOME_REQUEST_INTERVAL:
                last_home_req = now_m
                mav.send("command_long", mav.target_system(), mav.target_component(),
                         mavutil.mavlink.MAV_CMD_REQUEST_MESSAGE, 0, 242, 0, 0, 0, 0, 0, 0)

            # Ask for extra messages (IMU, RC) until they arrive
            for mtype, (msg_id, interval_us) in STREAM_REQUESTS.items():
                if mtype not in seen_types and now_m - last_stream_req.get(mtype, 0.0) >= HOME_REQUEST_INTERVAL:
                    last_stream_req[mtype] = now_m
                    mav.send("command_long", mav.target_system(), mav.target_component(),
                             mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL, 0, msg_id, interval_us, 0, 0, 0, 0, 0)

            # Check stale telemetry types
            now = time.monotonic()
            heartbeat.check(now)
            stale = [t for t in TELEMETRY_TYPES
                     if t in last_seen and now - last_seen[t] > STALE_AFTER.get(t, DEFAULT_STALE_AFTER)]

            # Publish telemetry if fresh and complete
            if stale:
                if not stale_warned:
                    logger.warning(f"Stale MAVLink data, not publishing: {stale}")
                    stale_warned = True
            else:
                if stale_warned:
                    logger.info("MAVLink data resumed.")
                    stale_warned = False
                if (dirty and REQUIRED_KEYS <= state.keys()
                        and now - last_publish >= MIN_PUBLISH_INTERVAL):
                    payload = clean(dict(state, timestamp=int(time.time() * 1000)))
                    dirty = False
                    last_publish = now
                    if redis_svc.publish_telemetry(payload):
                        fail_count = 0
                    else:
                        fail_count += 1

            # Reconnect Redis with a pause on repeated failures
            now = time.monotonic()
            if fail_count >= MAX_PUBLISH_FAILS and now - last_redis_try > RECONNECT_DELAY:
                last_redis_try = now
                logger.warning("Reconnecting to Redis...")
                if redis_svc.connect():
                    fail_count = 0
    except KeyboardInterrupt:
        logger.info("Stopping...")
    finally:
        mav.close()
        redis_svc.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run()