from types import SimpleNamespace
import pytest
from mavlink_engine.parsers.telemetry_parser import parse_message
from mavlink_engine.parsers import telemetry_parser


def _msg(tipe, **fields):
    return SimpleNamespace(get_type=lambda: tipe, **fields)


def test_position():
    r = parse_message(_msg(
        "GLOBAL_POSITION_INT",
        lat=-70000000, lon=1100000000,
        alt=150000, relative_alt=50000, hdg=9000,
    ))
    assert r["lat"] == pytest.approx(-7.0)    # negative (south) stays negative
    assert r["lon"] == pytest.approx(110.0)
    assert r["alt"] == pytest.approx(150.0)
    assert r["rel_alt"] == pytest.approx(50.0)
    assert r["heading"] == pytest.approx(90.0)


def test_heading_unknown_is_none():
    r = parse_message(_msg(
        "GLOBAL_POSITION_INT",
        lat=0, lon=0, alt=0, relative_alt=0, hdg=65535,
    ))
    assert r["heading"] is None


def test_attitude_radians_to_degrees():
    r = parse_message(_msg(
        "ATTITUDE", roll=0.0, pitch=-3.141592653589793 / 2, yaw=3.141592653589793,
    ))
    assert r["roll"] == pytest.approx(0.0)
    assert r["pitch"] == pytest.approx(-90.0)
    assert r["yaw"] == pytest.approx(180.0)


def test_vfr_hud_passthrough():
    r = parse_message(_msg("VFR_HUD", airspeed=5.5, groundspeed=4.2))
    assert r == {"airspeed": 5.5, "groundspeed": 4.2}


def test_heartbeat_armed(monkeypatch):
    monkeypatch.setattr(telemetry_parser.mavutil, "mode_string_v10", lambda m: "GUIDED")
    flag = telemetry_parser.mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
    r = telemetry_parser.parse_message(
        _msg("HEARTBEAT", autopilot=3, base_mode=flag)
    )
    ts = r.pop("heartbeat_timestamp")
    assert isinstance(ts, int) and ts > 0
    assert r == {"armed": True, "flight_mode": "GUIDED"}


def test_heartbeat_disarmed(monkeypatch):
    monkeypatch.setattr(telemetry_parser.mavutil, "mode_string_v10", lambda m: "STABILIZE")
    r = telemetry_parser.parse_message(_msg("HEARTBEAT", autopilot=3, base_mode=0))
    assert r["armed"] is False


def test_heartbeat_from_gcs_ignored():
    invalid = telemetry_parser.mavutil.mavlink.MAV_AUTOPILOT_INVALID
    assert telemetry_parser.parse_message(
        _msg("HEARTBEAT", autopilot=invalid, base_mode=0)
    ) is None


def test_battery_percent():
    assert telemetry_parser.parse_message(_msg("SYS_STATUS", battery_remaining=87)) == {"battery_percent": 87}
    

def test_battery_unknown_is_none():
    assert telemetry_parser.parse_message(_msg("SYS_STATUS", battery_remaining=-1)) == {"battery_percent": None}


def test_unknown_type_returns_none():
    assert parse_message(_msg("STATUSTEXT")) is None

def test_gps_and_home():
    from types import SimpleNamespace
    from mavlink_engine.parsers.telemetry_parser import parse_gps, parse_home
    gps = SimpleNamespace(fix_type=3, satellites_visible=10, eph=120)
    assert parse_gps(gps) == {"gps_fix_type": 3, "satellites_visible": 10, "hdop": 1.2}
    unknown = SimpleNamespace(fix_type=0, satellites_visible=255, eph=65535)
    assert parse_gps(unknown)["satellites_visible"] is None
    assert parse_gps(unknown)["hdop"] is None
    home = SimpleNamespace(latitude=-77701234, longitude=1103771234)
    assert parse_home(home) == {"home_lat": -7.7701234, "home_lon": 110.3771234}