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

# Min secs between attempts to resubscribe to the command channel
RESUBSCRIBE_DELAY = 5.0

# Max messages per read_command() call
MAX_COMMAND_SCAN = 50

class RedisService:
    """Thin wrapper around redis-py for publishing telemetry JSON."""
    def __init__(self):
        # Settings from config.py
        self.host = config.REDIS_HOST
        self.port = config.REDIS_PORT
        self.channel = config.REDIS_CHANNEL
        self.command_channel = config.REDIS_COMMAND_CHANNEL
        self.ack_channel = config.REDIS_ACK_CHANNEL
        self.commands_enabled = config.ENABLE_COMMANDS
        self.client = None     # Set by connect()
        self.pubsub = None      # Command subs, set when commands are enabled
        self._last_error_time = 0.0     # For rate-limited logging
        self._retry_at = 0.0            # No publish attempts before this time
        self._failing = False           # True after a failed publish (for recovery log)
        self._resubscribe_at = 0.0      # No resubscribe attempt before this time

    def connect(self) -> bool:
        """Create the Redis client and verify it with PING.
        If commands are enabled, also subscribe to the command channel; 
        a failed subscription is retried later and does not fail connect().
        Returns:
            True if connected, False otherwise (never None).
        """
        self.close()    # Calling connect() again must not leak the old client
        self._retry_at = 0.0
        self._failing = False
        self._resubscribe_at = 0.0
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
                self.subscribe_commands()
                return True
        except redis.RedisError as e:
            logger.error(f"Failed to connect Redis: {e}")
        self.close()    # Release the client; publish_telemetry skips it (None)
        return False    # Caught error or failed ping
    
    def subscribe_commands(self) -> bool:
        """Subscribe to command channel."""
        if not self.commands_enabled or not self.client:
            return False
        try:
            pubsub = self.client.pubsub()
            pubsub.subscribe(self.command_channel)
        except redis.RedisError as e:
            self._resubscribe_at = time.monotonic() + RESUBSCRIBE_DELAY
            self.log_limited(f"Subscribe to {self.command_channel} failed: {e}")
            return False
        self.pubsub = pubsub
        logger.info(f"Listening for commands on {self.command_channel}")
        return True
    
    def drop_pubsub(self):
        if self.pubsub:
            try:
                self.pubsub.close()
            except Exception as e:
                logger.warning(f"Error while closing command subscription: {e}")
            self.pubsub = None

    def read_command(self) -> dict | None:
        """Next pending command as a dict, or None. Never blocks.
        Messages that are not valid JSON objects are logged and skipped.
        Always None while commands are disabled.
        """
        if not self.command_channel or not self.client:
            return None
        if self.pubsub is None:
            if time.monotonic() < self._resubscribe_at or not self.subscribe_commands():
                return None
        for _ in range(MAX_COMMAND_SCAN):
            try:
                msg = self.pubsub.get_message(timeout=0)
            except redis.RedisError as e:
                # Drop the subscription; it's recreated after RESUBSCRIBE_DELAY
                self.drop_pubsub()
                self._resubscribe_at = time.monotonic() + RESUBSCRIBE_DELAY
                self.log_limited(f"Reading commands failed: {e}")
                return None
            if msg is None:
                return None
            if msg.get("type") != "message":
                continue
            try: 
                command = json.loads(msg["data"])
            except (TypeError, ValueError) as e:
                self.log_limited(f"Ignoring commands that is not valid JSON: {e}")
                continue
            if not isinstance(command, dict):
                self.log_limited("Ignoring commands that is not a JSON object")
                continue
            return command
        return None
    
    def publish(self, channel: str, data: dict, use_backoff: bool) -> bool:
        """Serialize data and publish it"""
        if not self.client:
            self.log_limited("Redis not connected. Call connect() first.")
            return False
 
        if use_backoff and time.monotonic() < self._retry_at:
            return False    # Backing off after a recent failure
 
        # Data errors are kept separate from network errors
        try:
            payload = json.dumps(data, allow_nan=False)
        except (TypeError, ValueError) as e:
            self.log_limited(f"Data is not JSON serializable: {e}")
            return False
 
        try:
            self.client.publish(channel, payload)
        except redis.RedisError as e:
            self._retry_at = time.monotonic() + RETRY_BACKOFF
            self._failing = True
            self.log_limited(f"Publish to {channel} failed: {e}")
            return False
 
        if self._failing:
            self._failing = False
            logger.info("Redis publish recovered.")
        return True

    def publish_telemetry(self, data: dict) -> bool:
        """Serialize `data` to JSON and publish it to the telemetry channel.
        Pub/Sub does not store messages: with no subscriber, the message
        is dropped but the call still returns True.
        After a failed publish, further calls return False immediately
        for RETRY_BACKOFF seconds instead of hitting Redis again."""
        return self.publish(self.channel, data, use_backoff=True)
    
    def publish_ack(self, data: dict) -> bool:
        """Publish a command result to the ack channel.
        An ack must not be dropped just because a telemetry publish failed a moment ago.
        """
        return self.publish(self.ack_channel, data, use_backoff=False)

    def close(self):
        """Close the connection and reset the client.
        After this, publish_telemetry() returns False until connect()
        is called again.
        """
        self.drop_pubsub()
        if self.client:
            try:
                self.client.close()
            except Exception as e:
                logger.warning(f"Error while closing Redis client: {e}")
            self.client = None  # Makes publish_telemetry fail cleanly after close
            logger.info("Redis connection closed.")

    def log_limited(self, message: str):
        """Log an error at most once per ERROR_LOG_INTERVAL"""
        now = time.monotonic()
        if now - self._last_error_time >= ERROR_LOG_INTERVAL:
            logger.error(message)
            self._last_error_time = now