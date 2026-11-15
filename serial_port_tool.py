"""List serial ports and detect a MAVLink serial baud rate for eksekusi.ps1."""

import sys


BAUD_CANDIDATES = (115200, 57600, 921600, 230400, 460800, 38400, 19200, 9600)


def list_ports() -> int:
    from serial.tools import list_ports

    for port in list_ports.comports():
        print(f"{port.device}\t{port.description or 'Serial device'}")
    return 0


def probe_baud(port_name: str) -> int:
    from pymavlink import mavutil

    for baud_rate in BAUD_CANDIDATES:
        connection = None
        try:
            connection = mavutil.mavlink_connection(
                port_name,
                baud=baud_rate,
                autoreconnect=False,
            )
            if connection.wait_heartbeat(timeout=1.5) is not None:
                print(baud_rate)
                return 0
        except Exception:
            pass
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass

    print("NOT_FOUND")
    return 0


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "list":
        return list_ports()
    if len(sys.argv) == 3 and sys.argv[1] == "probe":
        return probe_baud(sys.argv[2])
    print("Usage: serial_port_tool.py list | probe COMx", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
