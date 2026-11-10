"""Redis publisher for telemetry data (MAVLink -> Redis channel)."""

import redis
import json
import logging
import time
from .. import config


logger = logging.getLogger(__name__)

# Min secs between repeated error logs (avoids log spam at 20 hz)
ERROR_LOG_INTERVAL = 5.0

# After a failed publish, skip further attempts for this many secs.
# Without it, every tick of a 20 hz loop would retry a dead Redis and can block the loop for up to socket_connect_timeout each time.
RETRY_BACKOFF = 1.0

class RedisService:
    """Thin wrapper around redis-py for publishing telemetry JSON."""
    def __init__(self):
        # Settings from config.py
        self.host = config.REDIS_HOST
        self.port = config.REDIS_PORT
        self.channel = config.REDIS_CHANNEL
        self.client = None     # Set by connect()
        self._last_error_time = 0.0     # For rate-limited logging
        self._retry_at = 0.0            # No publish attempts before this time
        self._failing = False           # True after a failed publish (for recovery log)

    def connect(self) -> bool:
        """Create the Redis client and verify it with PING.
        Returns:
            True if connected, False otherwise (never None).
        """
        self.close()    # Calling connect() again must not leak the old client
        self._retry_at = 0.0
        self._failing = False
        try:
            self.client = redis.Redis(
                host=self.host,
                port=self.port,
                decode_responses=True,
                socket_connect_timeout=2,   # Fail fast on wrong address
                socket_timeout=2,           # Never hang forever on a stalled Redis
                retry=None,
            )
            if self.client.ping():
                logger.info(f"Connected to Redis {self.host}:{self.port}")
                return True
        except redis.RedisError as e:
            logger.error(f"Failed to connect Redis: {e}")
        self.close()    # Release the client; publish_telemetry skips it (None)
        return False    # Caught error or failed ping


    def publish_telemetry(self, data: dict) -> bool:
        """Serialize `data` to JSON and publish it to the configured channel.
        Pub/Sub does not store messages: with no subscriber, the message
        is dropped but the call still returns True.
        After a failed publish, further calls return False immediately
        for RETRY_BACKOFF seconds instead of hitting Redis again.
        Args:
            data: Telemetry dict. Values must be JSON serializable.
        Returns:
            True if published, False if Redis is not connected, the data
            is not serializable, the publish failed, or a retry is pending.
        """
        if not self.client:
            self._log_limited("Redis not connected. Call connect() first.")
            return False

        if time.monotonic() < self._retry_at:
            return False    # Backing off after a recent failure

        # Data errors are kept separate from network errors
        try:
            payload = json.dumps(data, allow_nan=False)
        except (TypeError, ValueError) as e:
            self._log_limited(f"Data is not JSON serializable: {e}")
            return False

        try:
            self.client.publish(self.channel, payload)
        except redis.RedisError as e:
            self._retry_at = time.monotonic() + RETRY_BACKOFF
            self._failing = True
            self._log_limited(f"Publish to {self.channel} failed: {e}")
            return False

        if self._failing:
            self._failing = False
            logger.info("Redis publish recovered.")
        return True

    def close(self):
        """Close the connection and reset the client.
        After this, publish_telemetry() returns False until connect()
        is called again.
        """
        if self.client:
            try:
                self.client.close()
            except Exception as e:
                logger.warning(f"Error while closing Redis client: {e}")
            self.client = None  # Makes publish_telemetry fail cleanly after close
            logger.info("Redis connection closed.")

    def _log_limited(self, message: str):
        """Log an error at most once per ERROR_LOG_INTERVAL"""
        now = time.monotonic()
        if now - self._last_error_time >= ERROR_LOG_INTERVAL:
            logger.error(message)
            self._last_error_time = now