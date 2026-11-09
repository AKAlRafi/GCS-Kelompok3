import logging
from pymavlink import mavutil
from .. import config

logger = logging.getLogger(__name__)

TYPES = ["GLOBAL_POSITION_INT", "ATTITUDE", "VFR_HUD"]


class MavlinkService:
    def __init__(self):
        self.url = config.MAVLINK_URL
        self.conn = None    # Set by connect()

    def connect(self, heartbeat_timeout: float = 10.0) -> bool:
        """Open the link and wait for the first heartbeat.
        Returns True on success, False on timeout or error.
        """
        try:
            self.conn = mavutil.mavlink_connection(self.url)
            hb = self.conn.wait_heartbeat(timeout=heartbeat_timeout)
        except Exception as e:
            logger.error(f"MAVLink connection failed: {e}")
            self.conn = None
            return False
        if hb is None:
            logger.error(f"No heartbeat within {heartbeat_timeout}s on {self.url}.")
            self.conn = None
            return False
        logger.info(f"Heartbeat: sysid={self.conn.target_system} compid={self.conn.target_component}")
        return True
    
    def read_messages(self) -> list:
        """Drain all pending wanted messages without blocking."""
        if not self.conn:
            return []
        out = []
        while True:
            msg = self.conn.recv_match(type=TYPES, blocking=False)
            if msg is None:
                return out
            out.append(msg)

    def close(self):
        """Close the link and reset the connection."""
        if self.conn:
            self.conn.close()
            self.conn = None
            