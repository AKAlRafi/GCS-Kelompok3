import asyncio
import base64
import json
import os

import redis.asyncio as redis
from pymavlink import mavutil

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")


async def main():
    bus = redis.from_url(REDIS_URL, decode_respons=True)
    commands = bus.pubsub()
    await commands.subscribe("gcs:commands")
    connection = None
    state = {
        "connected" : False,
        "linkOpen" : False
    }
    print("menunggu perintah dari express...")

    while True:
        command_msg = await commands.get_message(ignore_subscribe_messages=True, timeout=0.01)
        if command_msg:
            command = json.loads(command_msg["data"])
            if command["type"] == "connect":
                endpoint = command.get("endpoint", "udp://0.0.0.0::14551")
                endpoint = endpoint.replace("udp://", "udp:")
                connection = mavutil.mavlink_connection(endpoint, autoreconnect=True)
                state.update({"connected": False, "linkOpen": True, "endpoint": endpoint})
                print(f"MAVLink mendengarkan: {endpoint}")
            elif command["type"] == "disconnect":
                if connection:
                    connection.close()
                    connection = None
                state = {"connected": False, "linkOpen": False}
                await bus.publish("gcs:telemetry", json.dumps(state))

        if not connection:
            await asyncio.sleep(0.05)
            continue

        message = connection.recv_match(blocking=False)
        if message is None:
            await asyncio.sleep(0.02)
            continue

        kind = message.get_type()
        values = {}
        if kind == "HEARTBEAT":
            state["connected"] = True
            state["armed"] = bool(message.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
            state["mode"] = mavutil.mode_string_v10(message)
        elif kind == "GLOBAL_POSITION_INT":
            values.update({"lat": message.lat / 1e7, "lon": message.lon / 1e7,
                           "alt": message.relative_alt / 1000,
                           "speed": round((message.vx ** 2 + message.vy ** 2) ** 0.5 / 100, 2)})
        elif kind == "ATTITUDE":
            values.update({"roll": round(message.roll * 57.2958),
                           "pitch": round(message.pitch * 57.2958),
                           "yaw": round(message.yaw * 57.2958) % 360})
        elif kind == "SYS_STATUS" and message.battery_remaining >= 0:
            values["battery"] = message.battery_remaining

        raw = message.get_msgbuf()
        state.update(values)
        state["updated"] = asyncio.get_running_loop().time()
        state["timestamp"] = int(__import__("time").time() * 1000)
        state["raw"] = base64.b64encode(raw).decode("ascii")
        await bus.publish("gcs:telemetry", json.dumps(state))


if __name__ == "__main__":
    asyncio.run(main())