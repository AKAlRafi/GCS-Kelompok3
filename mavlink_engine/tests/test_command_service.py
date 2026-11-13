from unittest.mock import MagicMock
import pytest
from pymavlink import mavutil
from mavlink_engine import config
from mavlink_engine.services.command_service import CommandService


def make_ack(command: int, result: int):
    """Create a mock COMMAND_ACK message."""
    msg = MagicMock()
    msg.get_type.return_value = "COMMAND_ACK"
    msg.command = command
    msg.result = result
    return msg


@pytest.fixture
def mock_mavlink():
    service = MagicMock()
    service.master = MagicMock()
    service.master.return_value = service.master
    service.master.target_system = 1
    service.master.target_component = 1
    service.master.mode_mapping.return_value = {
        "STABILIZE": 0,
        "AUTO": 3,
        "GUIDED": 4,
        "RTL": 6,
        "LAND": 9,
    }
    return service


@pytest.fixture
def command_service(mock_mavlink, monkeypatch):
    monkeypatch.setattr(config, "ALLOW_FORCE_ARM", True, raising=False)
    service = CommandService(mock_mavlink, timeout=0.05)
    service.enabled = True
    return service


# --- Connection & Config Guard Tests ---

def test_is_connected(command_service, mock_mavlink):
    assert command_service.is_connected() is True

    mock_mavlink.master.return_value = None
    assert command_service.is_connected() is False


def test_execute_command_disabled(command_service, mock_mavlink):
    command_service.enabled = False

    result = command_service.execute_command({"command": "arm"})

    assert result["ok"] is False
    assert "disabled" in result["error"].lower()
    mock_mavlink.master.mav.command_long_send.assert_not_called()


def test_execute_command_disconnected(mock_mavlink):
    mock_mavlink.master.return_value = None
    service = CommandService(mock_mavlink, timeout=0.05)
    service.enabled = True

    result = service.execute_command({"command": "arm"})

    assert result["ok"] is False
    assert "not connected" in result["error"].lower()


# --- Validation Tests ---

def test_validate_command_valid_flat_and_nested(command_service):
    valid1, err1, cmd1, params1 = command_service.validate_command(
        {"command": "set_mode", "mode": "guided"}
    )
    assert valid1 is True
    assert err1 == ""
    assert cmd1 == "set_mode"
    assert params1["mode"] == "GUIDED"

    valid2, err2, cmd2, params2 = command_service.validate_command(
        {"command": "arm", "params": {"force": True}}
    )
    assert valid2 is True
    assert err2 == ""
    assert cmd2 == "arm"
    assert params2["force"] is True


def test_validate_command_invalid_payload_type(command_service):
    valid, err, _, _ = command_service.validate_command(["arm"])
    assert valid is False
    assert "dictionary" in err.lower()


def test_validate_command_missing_or_empty(command_service):
    valid_missing, err_missing, _, _ = command_service.validate_command({})
    valid_empty, err_empty, _, _ = command_service.validate_command({"command": "   "})

    assert valid_missing is False
    assert "command" in err_missing.lower()
    assert valid_empty is False
    assert "command" in err_empty.lower()


def test_validate_command_not_allowed(command_service):
    valid, err, _, _ = command_service.validate_command({"command": "reboot"})
    assert valid is False
    assert "not allowed" in err.lower()


def test_validate_command_invalid_arm_params(command_service):
    valid_force, err_force, _, _ = command_service.validate_command(
        {"command": "arm", "force": "yes"}
    )
    valid_arm, err_arm, _, _ = command_service.validate_command(
        {"command": "arm", "arm": 1}
    )

    assert valid_force is False
    assert "force" in err_force.lower()
    assert valid_arm is False
    assert "arm" in err_arm.lower()


def test_validate_command_invalid_mode_param(command_service):
    valid_missing, err_missing, _, _ = command_service.validate_command(
        {"command": "set_mode"}
    )
    valid_empty, err_empty, _, _ = command_service.validate_command(
        {"command": "set_mode", "mode": ""}
    )

    assert valid_missing is False
    assert "mode" in err_missing.lower()
    assert valid_empty is False
    assert "mode" in err_empty.lower()


# --- Command Execution Tests ---

def test_arm_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    result = command_service.execute_command({"command": "arm"})

    assert result == {
        "ok": True,
        "command": "arm",
        "result": "MAV_RESULT_ACCEPTED",
    }
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1,
        1,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    )


def test_arm_force_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    result = command_service.execute_command({"command": "arm", "force": True})

    assert result["ok"] is True
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1,
        1,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0,
        1.0,
        21196.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    )


def test_disarm_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    result = command_service.execute_command({"command": "disarm"})

    assert result == {
        "ok": True,
        "command": "disarm",
        "result": "MAV_RESULT_ACCEPTED",
    }
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1,
        1,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    )


def test_set_mode_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_DO_SET_MODE,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    result = command_service.execute_command({"command": "set_mode", "mode": "guided"})

    assert result == {
        "ok": True,
        "command": "set_mode:GUIDED",
        "result": "MAV_RESULT_ACCEPTED",
    }
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1, 1, mavutil.mavlink.MAV_CMD_DO_SET_MODE, 0,
        float(mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED), 4.0,
        0.0, 0.0, 0.0, 0.0, 0.0,
    )


def test_set_mode_unsupported(command_service, mock_mavlink):
    result = command_service.execute_command({"command": "mode", "mode": "ACRO"})

    assert result["ok"] is False
    assert "unsupported flight mode" in result["error"].lower()
    mock_mavlink.master.mav.command_long_send.assert_not_called()


def test_rtl_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    result = command_service.execute_command({"command": "rtl"})

    assert result == {
        "ok": True,
        "command": "rtl",
        "result": "MAV_RESULT_ACCEPTED",
    }
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1,
        1,
        mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
        0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    )


def test_land_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_NAV_LAND,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    result = command_service.execute_command({"command": "land"})

    assert result == {
        "ok": True,
        "command": "land",
        "result": "MAV_RESULT_ACCEPTED",
    }
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1,
        1,
        mavutil.mavlink.MAV_CMD_NAV_LAND,
        0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    )


# --- ACK Handling & Error Cases ---

def test_command_rejected_by_vehicle(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        mavutil.mavlink.MAV_RESULT_DENIED,
    )

    result = command_service.execute_command({"command": "arm"})

    assert result["ok"] is False
    assert "MAV_RESULT_DENIED" in result["error"]


def test_command_ack_in_progress_then_accepted(command_service, mock_mavlink):
    mock_mavlink.wait_for.side_effect = [
        make_ack(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            mavutil.mavlink.MAV_RESULT_IN_PROGRESS,
        ),
        make_ack(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            mavutil.mavlink.MAV_RESULT_ACCEPTED,
        ),
    ]

    result = command_service.execute_command({"command": "arm"})

    assert result["ok"] is True
    assert mock_mavlink.wait_for.call_count == 2


def test_command_ack_match_filters_other_commands(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        mavutil.mavlink.MAV_RESULT_ACCEPTED,
    )

    command_service.execute_command({"command": "arm"})

    match = mock_mavlink.wait_for.call_args.kwargs["match"]
    assert match(make_ack(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0)) is True
    assert match(make_ack(mavutil.mavlink.MAV_CMD_NAV_LAND, 0)) is False


def test_force_arm_denied_without_flag(command_service, mock_mavlink, monkeypatch):
    monkeypatch.setattr(config, "ALLOW_FORCE_ARM", False, raising=False)

    result = command_service.execute_command({"command": "arm", "force": True})

    assert result["ok"] is False
    assert "force" in result["error"].lower()
    mock_mavlink.master.mav.command_long_send.assert_not_called()


def test_takeoff_success(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, mavutil.mavlink.MAV_RESULT_ACCEPTED
    )

    result = command_service.execute_command({"command": "takeoff", "altitude_m": 10})

    assert result["ok"] is True
    mock_mavlink.master.mav.command_long_send.assert_called_once_with(
        1, 1, mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0,
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 10.0,
    )


def test_takeoff_invalid_altitude(command_service, mock_mavlink):
    result = command_service.execute_command({"command": "takeoff", "altitude_m": 0})

    assert result["ok"] is False
    mock_mavlink.master.mav.command_long_send.assert_not_called()


def test_guided_goto_sends_position_target(command_service, mock_mavlink):
    result = command_service.execute_command(
        {"command": "guided_goto", "lat": -7.5, "lon": 110.5, "alt": 20}
    )

    assert result["ok"] is True
    args = mock_mavlink.master.mav.set_position_target_global_int_send.call_args.args
    assert args[5] == -75000000 and args[6] == 1105000000 and args[7] == 20.0


def test_change_speed_and_yaw(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED, mavutil.mavlink.MAV_RESULT_ACCEPTED
    )
    assert command_service.execute_command({"command": "change_speed", "speed_mps": 5})["ok"] is True

    mock_mavlink.wait_for.return_value = make_ack(
        mavutil.mavlink.MAV_CMD_CONDITION_YAW, mavutil.mavlink.MAV_RESULT_ACCEPTED
    )
    result = command_service.execute_command({
        "command": "condition_yaw", "angle_deg": 90, "speed_deg_s": 30,
        "direction": 1, "relative": False,
    })
    assert result["ok"] is True


def test_change_speed_out_of_range(command_service):
    result = command_service.execute_command({"command": "change_speed", "speed_mps": 100})
    assert result["ok"] is False


def test_command_ack_timeout(command_service, mock_mavlink):
    mock_mavlink.wait_for.return_value = None

    result = command_service.execute_command({"command": "rtl"})

    assert result["ok"] is False
    assert "timeout" in result["error"].lower()


def test_command_connection_error(command_service, mock_mavlink):
    mock_mavlink.master.mav.command_long_send.side_effect = OSError("Port disconnected")

    result = command_service.execute_command({"command": "land"})

    assert result["ok"] is False
    assert "connection error" in result["error"].lower()