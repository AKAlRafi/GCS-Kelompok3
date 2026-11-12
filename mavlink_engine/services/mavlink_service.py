import logging
import time
from pymavlink import mavutil
from .. import config

logger = logging.getLogger(__name__)

TELEMETRY_TYPES = ["GLOBAL_POSITION_INT", "ATTITUDE", "VFR_HUD", "HEARTBEAT", "SYS_STATUS"]

# Replies we send
REPLY_TYPES = ["COMMAND_ACK", "MISSION_COUNT", "MISSION_ITEM_INT", "MISSION_ITEM", "MISSION_REQUEST_INT",
               "MISSION_REQUEST", "MISSION_ACK"]

TYPES = TELEMETRY_TYPES + REPLY_TYPES

# Safety cap per read_messages() call
MAX_MESSAGES_PER_READ = 500

# Min secs between repeated error logs (avoids log spam at 20 hz)
ERROR_LOG_INTERVAL = 5.0

# Messages set aside by wait_for() (newest kept when over the cap)
MAX_BACKLOG = 500


class MavlinkService:
    """Holds one MAVLink connection."""
    def __init__(self):
        self.url = config.MAVLINK_URL
        self.conn = None    # Set by connect()
        self.vehicle = None # sysid and compid of the autopilot, set by connect()
        self.backlog = []   # Set by wait_for()
        self._last_error_time = 0.0     # For rate-limited logging

    def connect(self, heartbeat_timeout: float = 10.0) -> bool:
        """Open the link and wait for the first heartbeat.
        Returns True on success, False on timeout or error.
        """
        self.close()    # Calling connect() again must not leak the old socket
        try:
            self.conn = mavutil.mavlink_connection(self.url)
            hb = self.wait_vehicle_heartbeat(heartbeat_timeout)
        except Exception as e:
            logger.error(f"MAVLink connection failed: {e}")
            self.close()
            return False
        if hb is None:
            logger.error(f"No heartbeat within {heartbeat_timeout}s on {self.url}.")
            self.close()    # Release the socket
            return False
        self.vehicle = (hb.get_srcSystem(), hb.get_srcComponent())
        logger.info(
            f"Heartbeat: sysid={hb.get_srcSystem()} compid={hb.get_srcComponent()} "
            f"type={hb.type} autopilot={hb.autopilot} | "
            f"target sysid={self.conn.target_system} compid={self.conn.target_component}"
        )
        return True
    
    def wait_vehicle_heartbeat(self, timeout: float):
        """First heartbeat from a real autopilot, or None on timeout.
        Heartbeats from GCS / companion components (autopilot=INVALID) are skipped."""
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            hb = self.conn.wait_heartbeat(timeout=remaining)
            if hb is None:
                return None
            if hb.autopilot != mavutil.mavlink.MAV_AUTOPILOT_INVALID:
                return hb

    def close(self):
        """Close the link and reset the connection."""
        self.backlog = []
        if self.conn:
            try:
                self.conn.close()
            except Exception as e:
                logger.warning(f"Error while closing MAVLink link: {e}")
            self.conn = None
        self.vehicle = None

    # Target
    @property
    def target_system(self) -> int:
        """System id commands are addressed to (0 while not connected)."""
        return self.vehicle[0] if self.vehicle else 0
    
    @property
    def target_component(self) -> int:
        """Component id commands are addressed to (0 while not connected)."""
        return self.vehicle[1] if self.vehicle else 0
    
    # Reading
    def from_vehicle(self, msg) -> bool:
        """Keep only our vehicle's messages. Other systems are dropped;
        HEARTBEAT must also come from the same component."""
        if self.vehicle is None:
            return True
        sysid, compid = self.vehicle
        if msg.get_srcSystem() != sysid:
            return False
        if msg.get_type() == "HEARTBEAT" and msg.get_srcComponent() != compid:
            return False
        return True
    
    def read_messages(self, timeout: float = 0.0) -> list:
        """Return messages: telemetry and replies"""
        if self.backlog:
            out, self.backlog = self.backlog, []
            room = MAX_MESSAGES_PER_READ - len(out)
            if room > 0:
                out.extend(self.read_raw(0.0, room))
            return out
        return self.read_raw(timeout, MAX_MESSAGES_PER_READ)
    
    def read_raw(self, timeout: float, limit: int) -> list:
        """Read straight from the link (at most `limit` messages from our vehicle)."""
        if not self.conn:
            return []
        out = []
        try:
            if timeout > 0:
                first = self.conn.recv_match(type=TYPES, blocking=True, timeout=timeout)
                if first is None:
                    return out
                if self.from_vehicle(first):
                    out.append(first)
            while len(out) < limit:
                msg = self.conn.recv_match(type=TYPES, blocking=False)
                if msg is None:
                    break
                if self.from_vehicle(msg):
                    out.append(msg)
        except OSError as e:
            self.log_limited(f"MAVLink read failed: {e}")
            if timeout > 0:
                time.sleep(timeout)     # A failing socket must not spin the caller
        return out
    
    def wait_for(self, types, timeout: float, match=None):
        """Wait up to `timeout` secs for one specific reply."""
        deadline = time.monotonic() + timeout
        held = []
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                batch = self.read_raw(remaining, MAX_MESSAGES_PER_READ)
                for i, msg in enumerate(batch):
                    if msg.get_type() in types and (match is None or match(msg)):
                        held.extend(batch[:i])
                        held.extend(batch[i + 1:])
                        return msg
                held.extend(batch)
        finally:
            self.backlog.extend(held)
            del self.backlog[:-MAX_BACKLOG]    # Keep only the newest

    def send(self, name: str, *args) -> bool:
        """Send one MAVLink message, e.g. send("command_long", sys, comp, ...)."""
        if not self.conn:
            self.log_limited(f"Cannot send {name}: not connected")
            return False
        helper = getattr(self.conn.mav, f"{name}_send", None)
        if helper is None:
            raise ValueError(f"Unknown MAVLink message: {name}")
        try:
            helper(*args)
        except OSError as e:
            self.log_limited(f"MAVLink send {name} failed: {e}")
            return False
        return True



    def log_limited(self, message: str):
        """Log an error at most once per ERROR_LOG_INTERVAL."""
        now = time.monotonic()
        if now - self._last_error_time >= ERROR_LOG_INTERVAL:
            logger.error(message)
            self._last_error_time = now