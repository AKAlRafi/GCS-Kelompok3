from types import SimpleNamespace
from unittest.mock import MagicMock
from pymavlink import mavutil
from mavlink_engine import config
from mavlink_engine.services.calibration_service import CalibrationService

M = mavutil.mavlink


def make(armed=False, ack_result=0):
    mav = MagicMock()
    mav.master.return_value = object()
    mav.target_system.return_value = 1
    mav.target_component.return_value = 1
    mav.send.return_value = True
    mav.wait_for.return_value = SimpleNamespace(result=ack_result, command=0) if ack_result is not None else None
    events = []
    svc = CalibrationService(mav, publish=events.append, armed_fn=lambda: armed)
    return svc, mav, events


def msg(t, **kw):
    return SimpleNamespace(get_type=lambda: t, **kw)


def test_rejects_when_commands_disabled(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", False, raising=False)
    svc, mav, _ = make()
    assert svc.start("gyro")["ok"] is False
    mav.send.assert_not_called()


def test_rejects_armed_and_unknown_armed(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    for armed in (True, None):
        svc, mav, _ = make(armed=armed)
        assert svc.start("gyro")["ok"] is False
        mav.send.assert_not_called()


def test_rejects_unknown_sensor(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, _ = make()
    assert svc.start("lidar")["ok"] is False
    assert svc.start(None)["ok"] is False


def test_gyro_sends_param1_and_finishes(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, mav, events = make()
    res = svc.start("gyro")
    args = mav.send.call_args[0]
    assert args[0] == "command_long" and args[3] == M.MAV_CMD_PREFLIGHT_CALIBRATION
    assert args[5] == 1 and args[7] == 0
    assert res["ok"] is True
    assert [e["status"] for e in events] == ["started", "done"]
    assert svc.sensor is None


def test_baro_uses_param3_and_level_uses_param5(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, mav, _ = make()
    svc.start("baro")
    a = mav.send.call_args[0]
    assert a[7] == 1 and a[5] == 0
    svc.start("level")
    a = mav.send.call_args[0]
    assert a[9] == 2


def test_rejected_ack_resets_state(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, events = make(ack_result=4)
    res = svc.start("gyro")
    assert res["ok"] is False and "FAILED" in res["error"]
    assert svc.sensor is None and events[-1]["status"] == "failed"


def test_no_ack(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, _ = make(ack_result=None)
    assert svc.start("gyro")["ok"] is False


def test_accel_flow(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, mav, events = make()
    assert svc.start("accel")["ok"] is True
    assert svc.sensor == "accel"
    assert svc.start("gyro")["ok"] is False      # already running
    svc.on_message(msg("COMMAND_LONG", command=M.MAV_CMD_ACCELCAL_VEHICLE_POS, param1=2.0))
    assert events[-1]["status"] == "position_needed" and events[-1]["name"] == "LEFT"
    assert svc.confirm_position(2)["ok"] is True
    a = mav.send.call_args[0]
    assert a[3] == M.MAV_CMD_ACCELCAL_VEHICLE_POS and a[5] == 2
    svc.on_message(msg("COMMAND_LONG", command=M.MAV_CMD_ACCELCAL_VEHICLE_POS, param1=16777215.0))
    assert events[-1]["status"] == "done" and svc.sensor is None


def test_accel_failure_message(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, events = make()
    svc.start("accel")
    svc.on_message(msg("COMMAND_LONG", command=M.MAV_CMD_ACCELCAL_VEHICLE_POS, param1=16777216.0))
    assert events[-1]["status"] == "failed" and svc.sensor is None


def test_confirm_validation(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, _ = make()
    assert svc.confirm_position(1)["ok"] is False   # nothing running
    svc.start("accel")
    assert svc.confirm_position(9)["ok"] is False
    assert svc.confirm_position("x")["ok"] is False


def test_mag_progress_report_and_accept(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, mav, events = make()
    svc.start("mag")
    assert mav.send.call_args_list[0][0][3] == M.MAV_CMD_DO_START_MAG_CAL
    svc.on_message(msg("MAG_CAL_PROGRESS", completion_pct=40, compass_id=0))
    assert events[-1] == {**events[-1], "status": "progress", "percent": 40}
    assert svc.accept()["ok"] is True
    svc.on_message(msg("MAG_CAL_REPORT", cal_status=4, compass_id=0, fitness=5.123, autosaved=1))
    assert events[-1]["status"] == "done" and events[-1]["autosaved"] is True
    assert svc.sensor is None


def test_mag_failure(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, events = make()
    svc.start("mag")
    svc.on_message(msg("MAG_CAL_REPORT", cal_status=5, compass_id=0, fitness=0.0, autosaved=0))
    assert events[-1]["status"] == "failed" and svc.sensor is None


def test_cancel_mag_sends_cancel(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, mav, events = make()
    assert svc.cancel()["ok"] is False
    svc.start("mag")
    assert svc.cancel()["ok"] is True
    assert mav.send.call_args_list[-1][0][3] == M.MAV_CMD_DO_CANCEL_MAG_CAL
    assert events[-1]["status"] == "cancelled" and svc.sensor is None


def test_statustext_forwarded_only_while_running(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, events = make()
    svc.on_message(msg("STATUSTEXT", text="hello", severity=6))
    assert events == []
    svc.start("accel")
    svc.on_message(msg("STATUSTEXT", text="Place vehicle level", severity=6))
    assert events[-1]["message"] == "Place vehicle level"


def test_execute_routes(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_COMMANDS", True, raising=False)
    svc, _, _ = make()
    assert svc.execute("calibrate", {"sensor": "gyro"})["ok"] is True
    assert svc.execute("nope", {})["ok"] is False