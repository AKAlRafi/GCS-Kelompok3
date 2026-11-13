"""Entry point: read MAVLink, parse, merge into state, publish to Redis, and handle commands."""

import logging
import math
import time
from pymavlink import mavutil
from .parsers.telemetry_parser import parse_message
from .services.command_service import CommandService
from .services.mavlink_service import MavlinkService, TELEMETRY_TYPES
from .services.mission_service import MissionService
from .services.redis_service import RedisService
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
DEFAULT_STALE_AFTER = 2.0                # A message type silent this long = stale data
STALE_AFTER = {"HEARTBEAT": 5.0, "SYS_STATUS": 5.0}
PARSE_ERROR_LOG_INTERVAL = 5.0   # Avoid log spam
MAX_COMMANDS_PER_TICK = 10       # Cap command processing per loop iteration
HOME_REQUEST_INTERVAL = 5.0

MISSION_COMMANDS = ("upload_mission", "download_mission", "clear_mission")


def connect_mavlink(mav) -> None:
    """Block until the first heartbeat arrives (retry forever)."""
    while not mav.connect():
        logger.warning(f"Retrying MAVLink in {RECONNECT_DELAY}s")
        time.sleep(RECONNECT_DELAY)


def clean(data: dict) -> dict:
    """Replace NaN/inf with None (JSON null): redis_service rejects them."""
    return {
        k: (None if isinstance(v, float) and not math.isfinite(v) else v)
        for k, v in data.items()
    }


def dispatch_command(payload, command_svc, mission_svc) -> dict:
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
        else:
            res = command_svc.execute_command({**inner, "command": name})

    return {"id": cmd_id, **res} if cmd_id is not None else res


def process_commands(
    redis_svc: RedisService,
    command_svc: CommandService,
    mission_svc: MissionService,
) -> int:
    """Read pending commands from Redis without blocking and publish acks."""
    processed = 0
    while processed < MAX_COMMANDS_PER_TICK:
        cmd_data = redis_svc.read_command()
        if cmd_data is None:
            break
        try:
            result = dispatch_command(cmd_data, command_svc, mission_svc)
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
    mav = MavlinkService()
    redis_svc = RedisService()
    command_svc = CommandService(mav)
    mission_svc = MissionService(mav)

    state = {}
    last_seen = {}          # Message type -> monotonic time of last message
    dirty = False           # True = new data not yet published
    last_publish = 0.0
    fail_count = 0
    last_redis_try = 0.0
    last_parse_error = 0.0
    stale_warned = False
    last_home_req = 0.0

    try:
        connect_mavlink(mav)
        if not redis_svc.connect():
            logger.warning("Redis not available yet; will retry while running.")

        while True:
            # Read incoming MAVLink telemetry and merge into state
            for msg in mav.read_messages(timeout=WAIT_TIMEOUT):
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

            # Check and execute pending commands from Redis
            process_commands(redis_svc, command_svc, mission_svc)
            now_m = time.monotonic()
            if "home_lat" not in state and now_m - last_home_req >= HOME_REQUEST_INTERVAL:
                last_home_req = now_m
                mav.send("command_long", mav.target_system(), mav.target_component(),
                        mavutil.mavlink.MAV_CMD_REQUEST_MESSAGE, 0, 242, 0, 0, 0, 0, 0, 0)
            # Check stale telemetry types
            now = time.monotonic()
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