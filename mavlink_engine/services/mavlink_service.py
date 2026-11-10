import logging
import time
from pymavlink import mavutil
from .. import config

logger = logging.getLogger(__name__)

TYPES = ["GLOBAL_POSITION_INT", "ATTITUDE", "VFR_HUD"]

# Safety cap per read_messages() call
MAX_MESSAGES_PER_READ = 500

# Min secs between repeated error logs (avoids log spam at 20 hz)
ERROR_LOG_INTERVAL = 5.0

class MavlinkService:
    def __init__(self):
        self.url = config.MAVLINK_URL
        self.conn = None    # Set by connect()
        self._last_error_time = 0.0     # For rate-limited logging

    def connect(self, heartbeat_timeout: float = 10.0) -> bool:
        """Open the link and wait for the first heartbeat.
        Returns True on success, False on timeout or error.
        """
        self.close()    # Calling connect() again must not leak the old socket
        try:
            self.conn = mavutil.mavlink_connection(self.url)
            hb = self.conn.wait_heartbeat(timeout=heartbeat_timeout)
        except Exception as e:
            logger.error(f"MAVLink connection failed: {e}")
            self.close()
            return False
        if hb is None:
            logger.error(f"No heartbeat within {heartbeat_timeout}s on {self.url}.")
            self.close()    # Release the socket, not just forget it
            return False
        # Log the heartbeat's own source next to conn.target_*: if they
        # differ (e.g. compid=0), check this before sending any command.
        logger.info(
            f"Heartbeat: sysid={hb.get_srcSystem()} compid={hb.get_srcComponent()} "
            f"type={hb.type} autopilot={hb.autopilot} | "
            f"target sysid={self.conn.target_system} compid={self.conn.target_component}"
        )
        return True

    def read_messages(self) -> list:
        """Drain pending wanted messages without blocking (at most
        MAX_MESSAGES_PER_READ per call). Socket errors are logged
        (rate-limited) and whatever was read so far is returned.
        """
        if not self.conn:
            return []
        out = []
        try:
            while len(out) < MAX_MESSAGES_PER_READ:
                msg = self.conn.recv_match(type=TYPES, blocking=False)
                if msg is None:
                    break
                out.append(msg)
        except OSError as e:
            self._log_limited(f"MAVLink read failed: {e}")
        return out

    def close(self):
        """Close the link and reset the connection."""
        if self.conn:
            try:
                self.conn.close()
            except Exception as e:
                logger.warning(f"Error while closing MAVLink link: {e}")
            self.conn = None

    def log_limited(self, message: str):
        """Log an error at most once per ERROR_LOG_INTERVAL."""
        now = time.monotonic()
        if now - self._last_error_time >= ERROR_LOG_INTERVAL:
            logger.error(message)
            self._last_error_time = now