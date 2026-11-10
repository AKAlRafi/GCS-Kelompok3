"""Entry point: read MAVLink, parse, merge into state, publish to Redis."""

import logging
import math
import time
from . import config
from .parsers.telemetry_parser import parse_message
from .services.mavlink_service import MavlinkService, TYPES
from .services.redis_service import RedisService

logger = logging.getLogger(__name__)

# State is published only when every field has been seen at least once
REQUIRED_KEYS = {
    "lat", "lon", "alt", "rel_alt", "heading",
    "roll", "pitch", "yaw", "airspeed", "groundspeed",
}
RECONNECT_DELAY = 5.0      # Time in seconds between reconnect attempts
MAX_PUBLISH_FAILS = 20     # Consecutive failures before reconnecting Redis
STALE_AFTER = 2.0          # A message type silent this long = stale data
PARSE_ERROR_LOG_INTERVAL = 5.0   # Avoid log spam at 20 Hz


def handle_commands(mav, redis_svc):
    """Placeholder: check for incoming commands (not implemented yet)."""
    pass


def connect_mavlink(mav) -> None:
    """Block until the first heartbeat arrives (retry forever)."""
    while not mav.connect():
        logger.warning(f"Retrying MAVLink in {RECONNECT_DELAY}s")
        time.sleep(RECONNECT_DELAY)


def clean(data: dict) -> dict:
    """Replace NaN/inf with None (JSON null): redis_service rejects them,
    and one bad field must not drop the whole message."""
    return {
        k: (None if isinstance(v, float) and not math.isfinite(v) else v)
        for k, v in data.items()
    }


def run() -> None:
    mav = MavlinkService()
    redis_svc = RedisService()
    state = {}
    last_seen = {}          # Message type -> monotonic time of last message
    fail_count = 0
    last_redis_try = 0.0
    last_parse_error = 0.0
    stale_warned = False

    try:
        # Inside try: Ctrl+C during startup also closes cleanly
        connect_mavlink(mav)
        if not redis_svc.connect():
            logger.warning("Redis not available yet; will retry while running.")

        next_tick = time.monotonic()
        while True:
            handle_commands(mav, redis_svc)

            # Read and merge
            for msg in mav.read_messages():
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

            # Types that were seen before but went silent = stale
            now = time.monotonic()
            stale = [t for t in TYPES
                     if t in last_seen and now - last_seen[t] > STALE_AFTER]

            # Publish only fresh, complete data
            if stale:
                if not stale_warned:
                    logger.warning(f"Stale MAVLink data, not publishing: {stale}")
                    stale_warned = True
            else:
                if stale_warned:
                    logger.info("MAVLink data resumed.")
                    stale_warned = False
                if REQUIRED_KEYS <= state.keys():
                    payload = clean(dict(state, timestamp=int(time.time() * 1000)))
                    if redis_svc.publish_telemetry(payload):
                        fail_count = 0
                    else:
                        fail_count += 1

            # Reconnect Redis with a pause
            now = time.monotonic()
            if fail_count >= MAX_PUBLISH_FAILS and now - last_redis_try > RECONNECT_DELAY:
                last_redis_try = now
                logger.warning("Reconnecting to Redis...")
                if redis_svc.connect():
                    fail_count = 0

            # Keep a steady rhythm (schedule from start time, not fixed sleep)
            next_tick += config.PUBLISH_INTERVAL
            sleep_for = next_tick - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                next_tick = time.monotonic()   
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