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


def read_back(path):
    conn = mavutil.mavlink_connection(path, dialect="ardupilotmega")
    types = []
    while True:
        msg = conn.recv_match(blocking=False)
        if msg is None:
            return types
        types.append(msg.get_type())


def test_not_recording_before_start(tmp_path):
    assert TlogService(log_dir=str(tmp_path)).is_recording() is False


def test_start_creates_tlog_file(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    path = svc.start()
    assert path.endswith(".tlog") and os.path.exists(path)
    assert svc.is_recording() is True
    svc.stop()
    assert svc.is_recording() is False


def test_records_readable_tlog(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    path = svc.start()
    for msg in make_msgs():
        svc.write_msg(msg)
    svc.stop()
    assert read_back(path) == ["HEARTBEAT", "ATTITUDE"]


def test_each_record_has_8_byte_big_endian_timestamp(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    path = svc.start()
    msg = make_msgs()[0]
    svc.write_msg(msg)
    svc.stop()
    data = open(path, "rb").read()
    assert len(data) == 8 + len(msg.get_msgbuf())
    assert struct.unpack(">Q", data[:8])[0] > 1_600_000_000_000_000


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


def test_row_counts_messages_and_size(tmp_path):
    svc = TlogService(log_dir=str(tmp_path))
    path = svc.start()
    for msg in make_msgs():
        svc.write_msg(msg)
    svc.stop()
    row = svc.list_tlogs()[0]
    assert row["message_count"] == 2
    assert row["size_bytes"] == os.path.getsize(path)


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
    path = svc.start()
    for msg in make_msgs():
        svc.write_msg(msg)
    svc.stop()
    assert read_back(path) == ["HEARTBEAT", "ATTITUDE"]