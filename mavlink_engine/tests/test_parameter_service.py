from types import SimpleNamespace
from unittest.mock import MagicMock
from mavlink_engine import config

if not hasattr(config, "COMMAND_TIMEOUT"):      # parameter_service reads it at import time
    config.COMMAND_TIMEOUT = 3

from mavlink_engine.services import parameter_service as ps
from mavlink_engine.services.parameter_service import ParameterService


def pv(name, value, index, count, ptype=9):
    return SimpleNamespace(param_id=name.encode().ljust(16, b"\x00"), param_value=value,
                           param_index=index, param_count=count, param_type=ptype)


def make(replies):
    """MavlinkService mock whose wait_for returns `replies` in order (then None)."""
    mav = MagicMock()
    master = MagicMock()
    master.target_system = 1
    master.target_component = 1
    mav.master.return_value = master
    seq = list(replies)
    mav.wait_for.side_effect = lambda *a, **k: seq.pop(0) if seq else None
    return ParameterService(mav, timeout=0.1, max_retries=2), mav, master


def fake_clock(monkeypatch, step=5.0):
    """Make time pass quickly so timeout paths do not really wait."""
    t = {"now": 0.0}

    def mono():
        t["now"] += step
        return t["now"]
    monkeypatch.setattr(ps, "time", SimpleNamespace(monotonic=mono))


def test_not_connected():
    svc = ParameterService(MagicMock(**{"master.return_value": None}), timeout=0.1)
    assert svc.download_all_params()["ok"] is False
    assert svc.get_param("X")["ok"] is False
    assert svc.set_param("X", 1)["ok"] is False


def test_download_all_in_order():
    svc, _, master = make([pv("B", 2.0, 1, 3), pv("A", 1.0, 0, 3), pv("C", 3.5, 2, 3)])
    res = svc.download_all_params()
    master.mav.param_request_list_send.assert_called_once_with(1, 1)
    assert res["ok"] is True and res["count"] == 3 and res["total"] == 3
    assert [p["id"] for p in res["parameters"]] == ["A", "B", "C"]
    assert res["parameters"][2] == {"index": 2, "id": "C", "value": 3.5, "type": 9}


def test_download_requests_missing_indexes():
    # Stream gives 0 and 2; index 1 is re-requested and arrives
    svc, _, master = make([pv("A", 1.0, 0, 3), pv("C", 3.0, 2, 3), None, pv("B", 2.0, 1, 3)])
    res = svc.download_all_params()
    assert res["ok"] is True and res["count"] == 3
    master.mav.param_request_read_send.assert_called_once_with(1, 1, b"", 1)


def test_download_returns_partial_after_retries():
    svc, _, master = make([pv("A", 1.0, 0, 3), pv("C", 3.0, 2, 3)])   # index 1 never arrives
    res = svc.download_all_params()
    assert res["ok"] is True and res["count"] == 2 and res["total"] == 3
    assert master.mav.param_request_read_send.call_count == 2          # one per retry


def test_download_ignores_out_of_range_index():
    svc, _, _ = make([pv("A", 1.0, 0, 1), pv("X", 9.0, 7, 1)])
    res = svc.download_all_params()
    assert res["count"] == 1 and res["parameters"][0]["id"] == "A"


def test_download_timeout_without_any_reply(monkeypatch):
    fake_clock(monkeypatch)
    svc, _, _ = make([])
    res = svc.download_all_params()
    assert res["ok"] is False and "Timeout" in res["error"]


def test_download_os_error():
    svc, _, master = make([])
    master.mav.param_request_list_send.side_effect = OSError("boom")
    res = svc.download_all_params()
    assert res["ok"] is False and "boom" in res["error"]


def test_get_param_found_and_normalizes_name():
    svc, _, master = make([pv("ARSPD_RATIO", 2.0, 5, 900, 9)])
    res = svc.get_param(" arspd_ratio ")
    assert res == {"ok": True, "id": "ARSPD_RATIO", "value": 2.0, "type": 9}
    assert master.mav.param_request_read_send.call_args[0][2] == b"ARSPD_RATIO".ljust(16, b"\x00")


def test_get_param_ignores_other_param_then_times_out(monkeypatch):
    fake_clock(monkeypatch, step=0.3)
    svc, _, _ = make([pv("OTHER", 1.0, 0, 1)])
    assert svc.get_param("WANTED")["ok"] is False


def test_get_param_invalid_id():
    svc, _, _ = make([])
    assert svc.get_param("")["ok"] is False
    assert svc.get_param("A" * 17)["ok"] is False


def test_set_param_confirmed_and_uses_known_type():
    svc, _, master = make([pv("X", 5.0, 0, 1, 2), pv("X", 5.0, 0, 1, 2)])
    assert svc.set_param("x", 5)["ok"] is True
    args = master.mav.param_set_send.call_args[0]
    assert args[3] == 5.0 and args[4] == 9      # default REAL32 for an unknown param


def test_set_param_validation():
    svc, _, master = make([])
    assert svc.set_param("X", "abc")["ok"] is False
    assert svc.set_param("X", float("nan"))["ok"] is False
    assert svc.set_param("", 1)["ok"] is False
    master.mav.param_set_send.assert_not_called()


def test_set_param_refused_when_armed_or_unknown():
    for armed in (True, None):
        svc, _, master = make([pv("X", 5.0, 0, 1)])
        svc.armed_fn = lambda armed=armed: armed
        res = svc.set_param("X", 5)
        assert res["ok"] is False and "disarmed" in res["error"]
        master.mav.param_set_send.assert_not_called()


def test_set_param_allowed_when_disarmed():
    svc, _, master = make([pv("X", 5.0, 0, 1)])
    svc.armed_fn = lambda: False
    assert svc.set_param("X", 5)["ok"] is True