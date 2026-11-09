from pymavlink import mavutil

connection_string = "udp:localhost:14551"

master = mavutil.mavlink_connection(connection_string)

master.wait_for_heartbeat()
print(f"Heartbeat received from system {master.target_system} component {master.target_component}")