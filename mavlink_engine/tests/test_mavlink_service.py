from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from pymavlink import mavutil
from mavlink_engine.services import mavlink_service
from mavlink_engine.services.mavlink_service import MavlinkService
import pytest

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

# ---- wait_for / backlog / send / target

def _ack(command, sysid=1):
    return SimpleNamespace(
        get_type=lambda: "COMMAND_ACK", command=command,
        get_srcSystem=lambda: sysid, get_srcComponent=lambda: 1,
    )


def _feeding(*msgs):
    """Service whose recv_match yields msgs in order, then None forever.
    Append to s.feed to simulate messages arriving later."""
    s = MavlinkService()
    s.conn = MagicMock()
    s.vehicle = (1, 1)
    s.feed = list(msgs)
    s.conn.recv_match.side_effect = lambda **kw: s.feed.pop(0) if s.feed else None
    return s


def test_wait_for_returns_match_and_keeps_others_in_order():
    a1, ack, a2 = _msg("ATTITUDE"), _ack(400), _msg("ATTITUDE")
    s = _feeding(a1, ack, a2)
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.5) is ack
    assert s.read_messages() == [a1, a2]


def test_wait_for_match_skips_ack_of_other_command():
    other, mine = _ack(21), _ack(400)
    s = _feeding(other, mine)
    got = s.wait_for({"COMMAND_ACK"}, timeout=0.5, match=lambda m: m.command == 400)
    assert got is mine
    assert s.read_messages() == [other]


def test_wait_for_timeout_returns_none_and_keeps_messages():
    att = _msg("ATTITUDE")
    s = _feeding(att)
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.05) is None
    assert s.read_messages() == [att]


def test_wait_for_ignores_ack_from_other_system():
    s = _feeding(_ack(400, sysid=2))
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.05) is None
    assert s.read_messages() == []


def test_wait_for_never_matches_messages_set_aside_earlier():
    old = _ack(1)
    s = _feeding(old)
    # First wait: the ack does not match, so it is set aside
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.05, match=lambda m: m.command == 400) is None
    # Second wait: it predates this request, so it must not count as the reply
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.05) is None
    assert s.read_messages() == [old]


def test_read_messages_returns_set_aside_first_then_new():
    a1, a2 = _msg("ATTITUDE"), _msg("ATTITUDE")
    s = _feeding(a1)
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.05) is None
    s.feed.append(a2)
    assert s.read_messages(timeout=0.1) == [a1, a2]


def test_backlog_keeps_only_newest():
    n = mavlink_service.MAX_BACKLOG + 200
    msgs = [_msg("ATTITUDE") for _ in range(n)]
    s = _feeding(*msgs)
    assert s.wait_for({"COMMAND_ACK"}, timeout=0.05) is None
    got = s.read_messages()
    assert len(got) == mavlink_service.MAX_BACKLOG
    assert got[0] is msgs[-mavlink_service.MAX_BACKLOG]
    assert got[-1] is msgs[-1]


def test_close_clears_backlog():
    s = _feeding(_msg("ATTITUDE"))
    s.wait_for({"COMMAND_ACK"}, timeout=0.05)
    s.close()
    assert s.read_messages() == []


# ---- send

def test_send_calls_pymavlink_helper():
    s = MavlinkService()
    s.conn = MagicMock()
    assert s.send("command_long", 1, 1, 400) is True
    s.conn.mav.command_long_send.assert_called_once_with(1, 1, 400)


def test_send_without_connection_returns_false():
    assert MavlinkService().send("command_long", 1, 1, 400) is False


def test_send_unknown_message_raises():
    s = MavlinkService()
    s.conn = MagicMock()
    s.conn.mav = SimpleNamespace()    # no *_send helpers at all
    with pytest.raises(ValueError):
        s.send("not_a_message")


def test_send_socket_error_returns_false():
    s = MavlinkService()
    s.conn = MagicMock()
    s.conn.mav.command_long_send.side_effect = OSError("socket closed")
    assert s.send("command_long", 1, 1, 400) is False


# ---- target

def test_target_comes_from_vehicle_heartbeat_not_conn():
    s = MavlinkService()
    s.conn = MagicMock()
    s.conn.target_system = 1
    s.conn.target_component = 0    # the compid=0 case seen on the first heartbeat
    s.vehicle = (1, 1)
    assert (s.target_system(), s.target_component()) == (1, 1)


def test_target_is_zero_when_not_connected():
    s = MavlinkService()
    assert (s.target_system(), s.target_component()) == (0, 0)

def test_open_link_parses_serial_url(monkeypatch):
    from mavlink_engine.services import mavlink_service as ms
    calls = []
    monkeypatch.setattr(ms.mavutil, "mavlink_connection", lambda *a, **k: calls.append((a, k)))

    ms.open_link("serial:/dev/ttyUSB0:57600")
    ms.open_link("serial:COM5")
    ms.open_link("udpin:0.0.0.0:14551")

    assert calls == [
        (("/dev/ttyUSB0",), {"baud": 57600}),
        (("COM5",), {"baud": 115200}),
        (("udpin:0.0.0.0:14551",), {}),
    ]