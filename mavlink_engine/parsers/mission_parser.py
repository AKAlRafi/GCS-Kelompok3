def parse_mission_item(msg) -> dict:
        """Convert a MISSION_ITEM_INT or MISSION_ITEM message into a dictionary."""
        is_int = msg.get_type() == "MISSION_ITEM_INT"
        lat = msg.x / 1e7 if is_int else float(msg.x)
        lon = msg.y / 1e7 if is_int else float(msg.y)

        return {
            "seq": msg.seq,
            "frame": msg.frame,
            "command": msg.command,
            "current": msg.current,
            "autocontinue": msg.autocontinue,
            "param1": msg.param1,
            "param2": msg.param2,
            "param3": msg.param3,
            "param4": msg.param4,
            "lat": lat,
            "lon": lon,
            "alt": float(msg.z),
        }