"""Redis publisher for telemetry data (MAVLink -> Redis channel)."""

import redis
import json
import logging
import time
from .. import config


logger = logging.getLogger(__name__)

# Min secs between repeated error logs (avoids log spam at 20 hz)
ERROR_LOG_INTERVAL = 5.0

class RedisService:
    """Thin wrapper around redis-py for publishing telemetry JSON."""

    def __init__(self):
        # Settings from config.py
        self.host = config.REDIS_HOST
        self.port = config.REDIS_PORT
        self.channel = config.REDIS_CHANNEL
        self.client = None     # Set by connect()
        self._last_error_time = 0.0     # For rate-limited logging
    
    def connect(self) -> bool:
        """Create the Redis client and verify it with PING.
        Returns:
            True if connected, False otherwise (never None).
        """
        try:
            self.client = redis.Redis(
                host=self.host,
                port=self.port,
                decode_responses=True,
                socket_connect_timeout=2,   # Fail fast on wrong address
                retry=None,
            )
            if self.client.ping():
                logger.info(f"Connected to Redis {self.host}:{self.port}")
                return True
        except redis.RedisError as e:
            logger.error(f"Failed to connect Redis: {e}")
        self.client = None  # Make publish_telemetry skip an unhealthy client
        return False    # Caught error or failed ping
    

    def publish_telemetry(self, data: dict) -> bool:
        """Serialize `data` to JSON and publish it to the configured channel.
        Pub/Sub does not store messages: with no subscriber, the message
        is dropped but the call still returns True.
        Args:
            data: Telemetry dict. Values must be JSON serializable.
        Returns:
            True if published, False if Redis is not connected, the data
            is not serializable, or the publish failed.
        """
        if not self.client:
            self._log_limited("Redis not connected. Call connect() first.")
            return False
        
        # Data errors are kept separate from network errors
        try:
            payload = json.dumps(data)
        except (TypeError, ValueError) as e:
            self._log_limited(f"Data is not JSON serializable: {e}")
            return False
        
        try:
            self.client.publish(self.channel, payload)
            return True
        except redis.RedisError as e:
            self._log_limited(f"Publish to {self.channel} failed: {e}")
            return False
        
    def close(self):
        """Close the connection and reset the client.
        After this, publish_telemetry() returns False until connect()
        is called again.
        """
        if self.client:
            self.client.close()
            self.client = None  # Makes publish_telemetry fail cleanly after close
            logger.info("Redis connection closed.")

    def _log_limited(self, message: str):
        """Log an error at most once per ERROR_LOG_INTERVAL"""
        now = time.monotonic()
        if now - self._last_error_time >= ERROR_LOG_INTERVAL:
            logger.error(message)
            self._last_error_time = now