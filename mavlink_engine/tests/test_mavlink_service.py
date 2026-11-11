from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from pymavlink import mavutil
from mavlink_engine.services import mavlink_service
from mavlink_engine.services.mavlink_service import MavlinkService

INVALID = mavutil.mavlink.MAV_AUTOPILOT_INVALID


def _hb(sysid, compid, autopilot=3):
    return SimpleNamespace(
        autopilot=autopilot, type=2,
        get_srcSystem=lambda: sysid, get_srcComponent=lambda: compid,
    )


def _msg(tipe, sysid=1, compid=1):
    return SimpleNamespace(
        get_type=lambda: tipe,
        get_srcSystem=lambda: sysid, get_srcComponent=lambda: compid,
    )


def _service_with_vehicle(*msgs):
    """Service already 'connected' to vehicle (1, 1); recv_match yields msgs."""
    s = MavlinkService()
    s.conn = MagicMock()
    s.vehicle = (1, 1)
    s.conn.recv_match.side_effect = list(msgs) + [None]
    return s


def _connect_with(heartbeats, timeout=0.2):
    s = MavlinkService()
    conn = MagicMock()
    conn.wait_heartbeat.side_effect = heartbeats
    with patch.object(mavlink_service.mavutil, "mavlink_connection", return_value=conn):
        return s, s.connect(heartbeat_timeout=timeout)


# ---- read_messages

def test_read_messages_survives_socket_error():
    s = MavlinkService()
    s.conn = MagicMock()
    s.conn.recv_match.side_effect = OSError("socket closed")
    assert s.read_messages() == []


def test_read_messages_without_connection_returns_empty():
    assert MavlinkService().read_messages() == []


def test_read_messages_with_timeout_waits_for_first_message():
    s = MavlinkService()
    s.conn = MagicMock()
    s.conn.recv_match.side_effect = ["a", "b", None]
    assert s.read_messages(timeout=0.1) == ["a", "b"]
    first_call = s.conn.recv_match.call_args_list[0]
    assert first_call.kwargs["blocking"] is True
    assert first_call.kwargs["timeout"] == 0.1


def test_read_messages_is_capped():
    s = MavlinkService()
    s.conn = MagicMock()
    s.conn.recv_match.return_value = "m"    # never runs dry
    assert len(s.read_messages()) == mavlink_service.MAX_MESSAGES_PER_READ


# ---- connect

def test_connect_skips_gcs_heartbeat_and_remembers_vehicle():
    s, ok = _connect_with([_hb(255, 190, INVALID), _hb(1, 1)])
    assert ok is True
    assert s.vehicle == (1, 1)


def test_connect_fails_when_only_gcs_heartbeats():
    s, ok = _connect_with([_hb(255, 190, INVALID)] * 1000)
    assert ok is False
    assert s.conn is None and s.vehicle is None


def test_connect_timeout_closes_link():
    s, ok = _connect_with([None])
    assert ok is False
    assert s.conn is None and s.vehicle is None


def test_connect_error_returns_false():
    s = MavlinkService()
    with patch.object(mavlink_service.mavutil, "mavlink_connection",
                      side_effect=OSError("port busy")):
        assert s.connect() is False
    assert s.conn is None


# ---- source filter

def test_messages_from_other_system_are_dropped():
    mine, other = _msg("ATTITUDE", 1, 1), _msg("ATTITUDE", 2, 1)
    assert _service_with_vehicle(other, mine).read_messages() == [mine]


def test_heartbeat_from_other_component_is_dropped():
    mine, companion = _msg("HEARTBEAT", 1, 1), _msg("HEARTBEAT", 1, 191)
    assert _service_with_vehicle(companion, mine).read_messages() == [mine]


def test_other_message_types_from_any_component_of_vehicle_are_kept():
    att = _msg("ATTITUDE", 1, 191)    # same vehicle, other component
    assert _service_with_vehicle(att).read_messages() == [att]


def test_filter_applies_to_first_message_when_waiting():
    s = _service_with_vehicle(_msg("ATTITUDE", 2, 1), _msg("ATTITUDE", 1, 1))
    got = s.read_messages(timeout=0.1)
    assert [m.get_srcSystem() for m in got] == [1]


def test_close_resets_vehicle():
    s = _service_with_vehicle()
    s.close()
    assert s.conn is None and s.vehicle is None