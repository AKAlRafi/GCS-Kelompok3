"""Settings for mavlink_engine"""

import os

# Redis
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_CHANNEL = os.getenv("REDIS_CHANNEL", "telemetry")

# MAVLink
MAVLINK_URL = os.getenv("MAVLINK_URL", "udpin:0.0.0.0:14551")

# Telemetry
PUBLISH_INTERVAL = float(os.getenv("PUBLISH_INTERVAL", "0.05")) # 20 hz frequency

# Commands
REDIS_COMMAND_CHANNEL = os.getenv("REDIS_COMMAND_CHANNEL", "commands")
REDIS_ACK_CHANNEL = os.getenv("REDIS_ACK_CHANNEL", "command_acks")
ENABLE_COMMANDS = os.getenv("ENABLE_COMMANDS", "0") == "1"

# Validation limits
MAX_WAYPOINTS = int(os.getenv("MAX_WAYPOINTS", 100))
MAX_ALTITUDE = float(os.getenv("MAX_ALTITUDE", 500))