import logging
import time

from . import config
from .parsers.telemetry_parser import parse_message
from .services.mavlink_service import MavlinkService
from .services.redis_service import RedisService


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main():
    mavlink = MavlinkService()
    redis = RedisService()

    if not redis.connect():
        raise SystemExit("Redis is unavailable. Start Redis and try again.")
    if not mavlink.connect():
        redis.close()
        raise SystemExit("No MAVLink heartbeat received. Check the vehicle link.")

    telemetry = {}
    try:
        while True:
            messages = mavlink.read_messages(timeout=config.PUBLISH_INTERVAL)
            for message in messages:
                telemetry.update(parse_message(message) or {})
            if messages:
                redis.publish_telemetry(telemetry)
    except KeyboardInterrupt:
        logging.info("Telemetry service stopped")
    finally:
        mavlink.close()
        redis.close()


if __name__ == "__main__":
    main()
