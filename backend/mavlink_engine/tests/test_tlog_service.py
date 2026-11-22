import os
import struct
from pymavlink import mavutil
from mavlink_engine.services.tlog_service import TlogService


def make_msgs():
    mav = mavutil.mavlink.MAVLink(None, 1, 1)
    msgs = [
        mav.heartbeat_encode(1, 3, 0, 0, 4, 3),
        mav.attitude_encode(100, 0.1, 0.2, 0.3, 0, 0, 0),
    ]
    for msg in msgs:
        msg.pack(mav)
    return msgs


def test_not_recording_before_start(tmp_path):
    assert TlogService(log_dir=str(tmp_path)).is_recording() is False


def test_start_registers_tlog_in_database(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    name = svc.start()
    assert name.endswith(".tlog")
    assert svc.is_recording() is True
    assert svc.list_tlogs()[0]["file_name"] == name
    svc.stop()
    assert svc.is_recording() is False


def test_write_ignored_when_not_recording_or_none(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    svc.write_msg(make_msgs()[0])
    svc.write_msg(None)
    assert os.listdir(tmp_path) == []


def test_start_adds_row_to_database(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    path = svc.start()
    rows = svc.list_tlogs()
    svc.stop()
    assert len(rows) == 1
    assert rows[0]["file_path"] == path
    assert rows[0]["message_count"] == 0


def test_file_holds_timestamp_and_raw_bytes(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    name = svc.start()
    msgs = make_msgs()
    for msg in msgs:
        svc.write_msg(msg)
    svc.stop()
    data = (tmp_path / name).read_bytes()
    expected_len = sum(8 + len(m.get_msgbuf()) for m in msgs)
    assert len(data) == expected_len
    assert data[8:8 + len(msgs[0].get_msgbuf())] == msgs[0].get_msgbuf()
    assert struct.unpack(">Q", data[:8])[0] > 0


def test_file_is_readable_by_pymavlink(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    name = svc.start()
    for msg in make_msgs():
        svc.write_msg(msg)
    svc.stop()
    reader = mavutil.mavlink_connection(str(tmp_path / name), dialect="common")
    types = []
    while (msg := reader.recv_match()) is not None:
        types.append(msg.get_type())
    assert types == ["HEARTBEAT", "ATTITUDE"]


def test_row_counts_messages_and_size(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    svc.start()
    msgs = make_msgs()
    for msg in msgs:
        svc.write_msg(msg)
    svc.stop()
    row = svc.list_tlogs()[0]
    assert row["message_count"] == 2
    assert row["size_bytes"] == sum(8 + len(m.get_msgbuf()) for m in msgs)


def test_row_is_current_even_if_never_stopped(tmp_path):
    # Simulates an engine that dies without stop(): another reader still sees the data
    svc = TlogService(log_dir=str(tmp_path))
    svc.db_interval = 0
    svc.start()
    for msg in make_msgs():
        svc.write_msg(msg)
    other = TlogService(log_dir=str(tmp_path))
    assert other.list_tlogs()[0]["message_count"] == 2
    svc.stop()


def test_each_start_adds_a_new_row(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    svc.start()
    svc.start()
    svc.stop()
    assert len(svc.list_tlogs()) == 2


def test_recording_continues_when_database_fails(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("a file, so a database cannot be created below it")
    svc = TlogService(log_dir=str(tmp_path), db_path=str(blocker / "tlogs.db"))
    name = svc.start()
    assert svc.is_recording() is True
    for msg in make_msgs():
        svc.write_msg(msg)    # must not raise
    svc.stop()
    assert (tmp_path / name).stat().st_size > 0
    assert svc.list_tlogs() == []