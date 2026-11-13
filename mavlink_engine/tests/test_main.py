from unittest.mock import MagicMock, patch
from mavlink_engine import config, main
from mavlink_engine.main import clean, dispatch_command, process_commands, run


def test_clean_replaces_nan_and_inf():
    data = {"a": float("nan"), "b": float("inf"), "c": 1.5, "d": None, "e": 3}
    assert clean(data) == {"a": None, "b": None, "c": 1.5, "d": None, "e": 3}


# --- Command Dispatch Tests ---

def test_dispatch_vehicle_command_unwraps_backend_message():
    cmd_svc = MagicMock()
    mission_svc = MagicMock()
    cmd_svc.execute_command.return_value = {
        "ok": True,
        "command": "arm",
        "result": "MAV_RESULT_ACCEPTED",
    }

    res = dispatch_command({"id": 10, "type": "arm", "payload": {}}, cmd_svc, mission_svc)

    cmd_svc.execute_command.assert_called_once_with({"command": "arm"})
    assert res == {
        "id": 10,
        "ok": True,
        "command": "arm",
        "result": "MAV_RESULT_ACCEPTED",
    }


def test_dispatch_set_mode_passes_inner_payload_only():
    cmd_svc = MagicMock()
    cmd_svc.execute_command.return_value = {"ok": True}

    res = dispatch_command(
        {"id": "u1", "type": "set_mode", "payload": {"mode": "GUIDED"}},
        cmd_svc, MagicMock(),
    )

    cmd_svc.execute_command.assert_called_once_with({"mode": "GUIDED", "command": "set_mode"})
    assert res == {"id": "u1", "ok": True}


def test_dispatch_upload_mission_backend_and_params(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True)
    cmd_svc = MagicMock()
    mission_svc = MagicMock()
    mission_svc.upload_mission.return_value = {"ok": True, "count": 2}
    waypoints = [
        {"lat": -7.77, "lon": 110.37, "alt": 20.0},
        {"lat": -7.78, "lon": 110.38, "alt": 30.0},
    ]

    res1 = dispatch_command(
        {"id": 1, "type": "upload_mission", "payload": {"waypoints": waypoints}},
        cmd_svc,
        mission_svc,
    )
    assert res1 == {"id": 1, "ok": True, "count": 2}
    mission_svc.upload_mission.assert_called_with(waypoints)

    res2 = dispatch_command(
        {"command": "upload_mission", "params": {"waypoints": waypoints}},
        cmd_svc,
        mission_svc,
    )
    assert res2 == {"ok": True, "count": 2}


def test_process_commands_survives_dispatch_exception():
    redis_svc = MagicMock()
    redis_svc.read_command.side_effect = [{"id": "x", "type": "arm", "payload": {}}, None]
    cmd_svc = MagicMock()
    cmd_svc.execute_command.side_effect = RuntimeError("boom")

    n = process_commands(redis_svc, cmd_svc, MagicMock())

    assert n == 1
    ack = redis_svc.publish_ack.call_args.args[0]
    assert ack["ok"] is False and ack["id"] == "x"


def test_dispatch_download_and_clear_mission(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True)
    cmd_svc = MagicMock()
    mission_svc = MagicMock()
    mission_svc.download_mission.return_value = {"ok": True, "count": 0, "waypoints": []}
    mission_svc.clear_mission.return_value = {"ok": True}

    res_dl = dispatch_command({"id": 2, "command": "download_mission"}, cmd_svc, mission_svc)
    res_clr = dispatch_command({"id": 3, "type": "clear_mission"}, cmd_svc, mission_svc)

    assert res_dl == {"id": 2, "ok": True, "count": 0, "waypoints": []}
    assert res_clr == {"id": 3, "ok": True}
    mission_svc.download_mission.assert_called_once()
    mission_svc.clear_mission.assert_called_once()


def test_dispatch_mission_blocked_when_commands_disabled(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", False)
    cmd_svc = MagicMock()
    mission_svc = MagicMock()

    res = dispatch_command({"id": 4, "command": "clear_mission"}, cmd_svc, mission_svc)

    assert res["id"] == 4
    assert res["ok"] is False
    assert "disabled" in res["error"].lower()
    mission_svc.clear_mission.assert_not_called()


def test_dispatch_missing_command_name():
    cmd_svc = MagicMock()
    mission_svc = MagicMock()

    res = dispatch_command({"id": 5}, cmd_svc, mission_svc)

    assert res == {"id": 5, "ok": False, "error": "Missing or invalid command name"}


# --- Loop Processing & Run Tests ---

def test_process_commands_drains_queue_and_publishes_acks():
    redis_svc = MagicMock()
    cmd_svc = MagicMock()
    mission_svc = MagicMock()

    redis_svc.read_command.side_effect = [
        {"id": 11, "command": "arm"},
        {"id": 12, "command": "rtl"},
        None,
    ]
    cmd_svc.execute_command.side_effect = [
        {"ok": True, "command": "arm"},
        {"ok": True, "command": "rtl"},
    ]

    count = process_commands(redis_svc, cmd_svc, mission_svc)

    assert count == 2
    assert redis_svc.publish_ack.call_count == 2
    redis_svc.publish_ack.assert_any_call({"id": 11, "ok": True, "command": "arm"})
    redis_svc.publish_ack.assert_any_call({"id": 12, "ok": True, "command": "rtl"})


def test_run_publishes_telemetry_and_dispatches_commands():
    fake_msg = MagicMock()
    fake_msg.get_type.return_value = "ATTITUDE"
    full_telemetry = {k: 1.0 for k in main.REQUIRED_KEYS}

    with (
        patch.object(main, "MavlinkService") as mock_mav_cls,
        patch.object(main, "RedisService") as mock_redis_cls,
        patch.object(main, "CommandService") as mock_cmd_cls,
        patch.object(main, "MissionService"),
        patch.object(main, "parse_message", return_value=full_telemetry),
    ):
        mav = mock_mav_cls.return_value
        mav.connect.return_value = True
        mav.read_messages.side_effect = [[fake_msg], KeyboardInterrupt()]

        redis_svc = mock_redis_cls.return_value
        redis_svc.connect.return_value = True
        redis_svc.publish_telemetry.return_value = True
        redis_svc.read_command.side_effect = [{"id": 99, "command": "arm"}, None]

        cmd_svc = mock_cmd_cls.return_value
        cmd_svc.execute_command.return_value = {"ok": True, "command": "arm"}

        run()

        redis_svc.publish_telemetry.assert_called_once()
        redis_svc.publish_ack.assert_called_once_with(
            {"id": 99, "ok": True, "command": "arm"}
        )
        mav.close.assert_called_once()
        redis_svc.close.assert_called_once()