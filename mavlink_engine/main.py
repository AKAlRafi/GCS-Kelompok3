"""Entry point: read MAVLink, parse, merge into state, publish to Redis."""

import logging
import math
import time
from .parsers.telemetry_parser import parse_message
from .services.mavlink_service import MavlinkService, TYPES
from .services.redis_service import RedisService

logger = logging.getLogger(__name__)

# State is published only when every field has been seen at least once
REQUIRED_KEYS = {
    "lat", "lon", "alt", "rel_alt", "heading",
    "roll", "pitch", "yaw", "airspeed", "groundspeed",
}

WAIT_TIMEOUT = 0.1         # Max wait for a message; the loop still wakes this 
MIN_PUBLISH_INTERVAL = 0.02    # Cap at 50 publishes/s if the link floods
RECONNECT_DELAY = 5.0      # Time in seconds between reconnect attempts
MAX_PUBLISH_FAILS = 20     # Consecutive failures before reconnecting Redis
STALE_AFTER = 2.0          # A message type silent this long = stale data
PARSE_ERROR_LOG_INTERVAL = 5.0   # Avoid log spam

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


def run() -> None:
    mav = MavlinkService()
    redis_svc = RedisService()

    state = {}
    last_seen = {}          # Message type -> monotonic time of last message
    dirty = False           # True = new data not yet published
    last_publish = 0.0
    fail_count = 0
    last_redis_try = 0.0
    last_parse_error = 0.0
    stale_warned = False

    try:
        connect_mavlink(mav)
        if not redis_svc.connect():
            logger.warning("Redis not available yet; will retry while running.")

        while True:
            # Wait for data, then merge
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

            # Types that were seen before but went silent = stale
            now = time.monotonic()
            stale = [t for t in TYPES
                     if t in last_seen and now - last_seen[t] > STALE_AFTER]

            # Publish only new data
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

            # Reconnect Redis with a pause
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