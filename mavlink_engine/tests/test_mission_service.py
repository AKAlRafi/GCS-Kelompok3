from unittest.mock import MagicMock
import pytest
from pymavlink import mavutil
from mavlink_engine.services.mission_service import MissionService


def make_msg(msg_type: str, **fields):
    """Create a mock MAVLink message with get_type() and custom attributes."""
    msg = MagicMock()
    msg.get_type.return_value = msg_type
    for key, value in fields.items():
        setattr(msg, key, value)
    return msg


@pytest.fixture
def mock_mavlink():
    service = MagicMock()
    service.master = MagicMock()
    service.master.return_value = service.master
    service.master.target_system = 1
    service.master.target_component = 1
    return service


@pytest.fixture
def mission_service(mock_mavlink):
    service = MissionService(mock_mavlink, timeout=0.05, max_retries=2)
    service.max_waypoints = 5
    service.max_altitude = 120.0
    return service


@pytest.fixture
def sample_waypoints():
    return [
        {"lat": -7.7701234, "lon": 110.3771234, "alt": 20.0},
        {"lat": -7.7711234, "lon": 110.3781234, "alt": 35.0},
    ]


# --- Connection & Validation Tests ---

def test_is_connected(mission_service, mock_mavlink):
    assert mission_service.is_connected() is True

    mock_mavlink.master = None
    assert mission_service.is_connected() is False


def test_validate_waypoints_valid(mission_service, sample_waypoints):
    valid, err = mission_service.validate_waypoints(sample_waypoints)
    assert valid is True
    assert err == ""


def test_validate_waypoints_empty(mission_service):
    valid, err = mission_service.validate_waypoints([])
    assert valid is False
    assert "empty" in err.lower()


def test_validate_waypoints_exceeds_limit(mission_service):
    waypoints = [{"lat": -7.77, "lon": 110.37, "alt": 10.0} for _ in range(6)]
    valid, err = mission_service.validate_waypoints(waypoints)
    assert valid is False
    assert "exceeds limit" in err.lower()


def test_validate_waypoints_missing_fields(mission_service):
    valid, err = mission_service.validate_waypoints([{"lat": -7.77, "lon": 110.37}])
    assert valid is False
    assert "missing required fields" in err.lower()


def test_validate_waypoints_invalid_types(mission_service):
    valid, err = mission_service.validate_waypoints([{"lat": "invalid", "lon": 110.37, "alt": 20.0}])
    assert valid is False
    assert "invalid numeric" in err.lower()


def test_validate_waypoints_out_of_bounds_coordinates(mission_service):
    valid, err = mission_service.validate_waypoints([{"lat": 95.0, "lon": 110.37, "alt": 20.0}])
    assert valid is False
    assert "out of valid range" in err.lower()


def test_validate_waypoints_out_of_bounds_altitude(mission_service):
    valid_low, _ = mission_service.validate_waypoints([{"lat": -7.77, "lon": 110.37, "alt": -5.0}])
    valid_high, err_high = mission_service.validate_waypoints([{"lat": -7.77, "lon": 110.37, "alt": 200.0}])

    assert valid_low is False
    assert valid_high is False
    assert "safe bounds" in err_high.lower()


# --- Upload Mission Tests ---

def test_upload_mission_disconnected(mock_mavlink, sample_waypoints):
    mock_mavlink.master = None
    service = MissionService(mock_mavlink, timeout=0.05, max_retries=2)

    result = service.upload_mission(sample_waypoints)
    assert result["ok"] is False
    assert "not connected" in result["error"].lower()


def test_upload_mission_success(mission_service, mock_mavlink, sample_waypoints):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_REQUEST_INT", seq=0),
        make_msg("MISSION_REQUEST_INT", seq=1),
        make_msg("MISSION_ACK", type=mavutil.mavlink.MAV_MISSION_ACCEPTED),
    ]

    result = mission_service.upload_mission(sample_waypoints)

    assert result == {"ok": True, "count": 2}
    mock_mavlink.master.mav.mission_count_send.assert_called_once_with(1, 1, 2)
    assert mock_mavlink.master.mav.mission_item_int_send.call_count == 2


def test_upload_mission_rejected_by_vehicle(mission_service, mock_mavlink, sample_waypoints):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_REQUEST", seq=0),
        make_msg("MISSION_ACK", type=mavutil.mavlink.MAV_MISSION_NO_SPACE),
    ]

    result = mission_service.upload_mission(sample_waypoints)

    assert result["ok"] is False
    assert "MAV_MISSION_NO_SPACE" in result["error"]


def test_upload_mission_sequence_out_of_range(mission_service, mock_mavlink, sample_waypoints):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_REQUEST_INT", seq=99),
    ]

    result = mission_service.upload_mission(sample_waypoints)

    assert result["ok"] is False
    assert "out of range" in result["error"].lower()


def test_upload_mission_timeout(mission_service, mock_mavlink, sample_waypoints):
    mock_mavlink.master.recv_match.return_value = None

    result = mission_service.upload_mission(sample_waypoints)

    assert result["ok"] is False
    assert "timeout" in result["error"].lower()
    assert mock_mavlink.master.mav.mission_count_send.call_count == 2


def test_upload_mission_connection_error(mission_service, mock_mavlink, sample_waypoints):
    mock_mavlink.master.mav.mission_count_send.side_effect = OSError("Serial port disconnected")

    result = mission_service.upload_mission(sample_waypoints)

    assert result["ok"] is False
    assert "connection error" in result["error"].lower()


# --- Download Mission Tests ---

def test_download_mission_disconnected(mock_mavlink):
    mock_mavlink.master = None
    service = MissionService(mock_mavlink, timeout=0.05, max_retries=2)

    result = service.download_mission()
    assert result["ok"] is False
    assert "not connected" in result["error"].lower()


def test_download_mission_empty(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_COUNT", count=0),
    ]

    result = mission_service.download_mission()

    assert result == {"ok": True, "count": 0, "waypoints": []}
    mock_mavlink.master.mav.mission_ack_send.assert_called_once_with(
        1, 1, mavutil.mavlink.MAV_MISSION_ACCEPTED
    )


def test_download_mission_success(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_COUNT", count=2),
        make_msg(
            "MISSION_ITEM_INT",
            seq=0,
            frame=mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            command=mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
            current=1,
            autocontinue=1,
            param1=0.0,
            param2=0.0,
            param3=0.0,
            param4=0.0,
            x=-77701234,
            y=1103771234,
            z=20.0,
        ),
        make_msg(
            "MISSION_ITEM_INT",
            seq=1,
            frame=mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            command=mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
            current=0,
            autocontinue=1,
            param1=0.0,
            param2=0.0,
            param3=0.0,
            param4=0.0,
            x=-77711234,
            y=1103781234,
            z=35.0,
        ),
    ]

    result = mission_service.download_mission()

    assert result["ok"] is True
    assert result["count"] == 2
    assert len(result["waypoints"]) == 2
    assert result["waypoints"][0]["lat"] == pytest.approx(-7.7701234)
    assert result["waypoints"][0]["lon"] == pytest.approx(110.3771234)
    assert result["waypoints"][0]["alt"] == 20.0
    assert result["waypoints"][1]["seq"] == 1
    mock_mavlink.master.mav.mission_ack_send.assert_called_once_with(
        1, 1, mavutil.mavlink.MAV_MISSION_ACCEPTED
    )


def test_download_mission_count_timeout(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.return_value = None

    result = mission_service.download_mission()

    assert result["ok"] is False
    assert "MISSION_COUNT" in result["error"]


def test_download_mission_item_timeout(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.side_effect = (
        lambda *args, **kwargs: make_msg("MISSION_COUNT", count=2)
        if mock_mavlink.master.recv_match.call_count == 1
        else None
    )

    result = mission_service.download_mission()

    assert result["ok"] is False
    assert "waypoint 0" in result["error"].lower()


def test_download_mission_connection_error(mission_service, mock_mavlink):
    mock_mavlink.master.mav.mission_request_list_send.side_effect = OSError("Socket closed")

    result = mission_service.download_mission()

    assert result["ok"] is False
    assert "connection error" in result["error"].lower()


# --- Clear Mission Tests ---

def test_clear_mission_disconnected(mock_mavlink):
    mock_mavlink.master = None
    service = MissionService(mock_mavlink, timeout=0.05, max_retries=2)

    result = service.clear_mission()
    assert result["ok"] is False
    assert "not connected" in result["error"].lower()


def test_clear_mission_success(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_ACK", type=mavutil.mavlink.MAV_MISSION_ACCEPTED),
    ]

    result = mission_service.clear_mission()

    assert result == {"ok": True}
    mock_mavlink.master.mav.mission_clear_all_send.assert_called_once_with(1, 1)


def test_clear_mission_rejected(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.side_effect = [
        make_msg("MISSION_ACK", type=mavutil.mavlink.MAV_MISSION_DENIED),
    ]

    result = mission_service.clear_mission()

    assert result["ok"] is False
    assert "MAV_MISSION_DENIED" in result["error"]


def test_clear_mission_timeout(mission_service, mock_mavlink):
    mock_mavlink.master.recv_match.return_value = None

    result = mission_service.clear_mission()

    assert result["ok"] is False
    assert "timeout" in result["error"].lower()
    assert mock_mavlink.master.mav.mission_clear_all_send.call_count == 2


def test_clear_mission_connection_error(mission_service, mock_mavlink):
    mock_mavlink.master.mav.mission_clear_all_send.side_effect = OSError("Broken pipe")

    result = mission_service.clear_mission()

    assert result["ok"] is False
    assert "connection error" in result["error"].lower()