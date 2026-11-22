import time
from unittest.mock import MagicMock, patch

import redis

from mavlink_engine import config
from mavlink_engine.services import redis_service
from mavlink_engine.services.redis_service import RedisService


def _service(commands=True):
    """Service with a fake client and fixed names, independent of env/config."""
    s = RedisService()
    s.client = MagicMock()  # stands in for a real Redis connection
    s.channel = "tel"
    s.command_channel = "cmd"
    s.ack_channel = "ack"
    s.commands_enabled = commands
    s.pubsub = MagicMock() if commands else None
    return s


def _msg(data):
    """A pub/sub entry as redis-py hands it over (decode_responses=True)."""
    return {"type": "message", "channel": "cmd", "data": data}


# ---------- telemetry publishing ----------

def test_publish_sends_json():
    s = _service()
    assert s.publish_telemetry({"lat": -7.0}) is True
    s.client.publish.assert_called_once_with("tel", '{"lat": -7.0}')


def test_publish_without_connect_returns_false():
    assert RedisService().publish_telemetry({"lat": 1}) is False


def test_publish_rejects_nan():
    s = _service()
    assert s.publish_telemetry({"roll": float("nan")}) is False
    s.client.publish.assert_not_called()


def test_publish_failure_returns_false():
    s = _service()
    s.client.publish.side_effect = redis.ConnectionError("down")
    assert s.publish_telemetry({"lat": 1}) is False


def test_backoff_skips_redis_then_recovers():
    s = _service()
    s.client.publish.side_effect = redis.ConnectionError("down")
    with patch.object(redis_service.time, "monotonic", return_value=100.0):
        assert s.publish_telemetry({"lat": 1}) is False
        assert s.client.publish.call_count == 1
        # Still inside the backoff window: Redis must not be touched
        assert s.publish_telemetry({"lat": 1}) is False
        assert s.client.publish.call_count == 1
    # Window over and Redis is back
    s.client.publish.side_effect = None
    with patch.object(redis_service.time, "monotonic",
                      return_value=100.0 + redis_service.RETRY_BACKOFF + 0.1):
        assert s.publish_telemetry({"lat": 1}) is True


def test_connect_failure_leaves_no_client():
    s = RedisService()
    s.port = 1    # nothing listens here
    assert s.connect() is False
    assert s.client is None
    assert s.publish_telemetry({"lat": 1}) is False


def test_close_then_publish_returns_false():
    s = _service()
    s.close()
    assert s.client is None
    assert s.publish_telemetry({"lat": 1}) is False


# ---------- ack publishing ----------

def test_ack_uses_ack_channel():
    s = _service()
    assert s.publish_ack({"id": 1, "ok": True}) is True
    s.client.publish.assert_called_once_with("ack", '{"id": 1, "ok": true}')


def test_ack_ignores_telemetry_backoff():
    s = _service()
    s._retry_at = time.monotonic() + 100    # telemetry is backing off
    assert s.publish_telemetry({"lat": 1}) is False
    s.client.publish.assert_not_called()
    # An ack must still go out
    assert s.publish_ack({"ok": True}) is True
    s.client.publish.assert_called_once()


def test_ack_rejects_nan():
    s = _service()
    assert s.publish_ack({"x": float("inf")}) is False
    s.client.publish.assert_not_called()


# ---------- reading commands ----------

def test_read_command_returns_dict():
    s = _service()
    s.pubsub.get_message.return_value = _msg('{"type": "arm"}')
    assert s.read_command() == {"type": "arm"}


def test_read_command_skips_non_message_types():
    s = _service()
    s.pubsub.get_message.side_effect = [
        {"type": "subscribe", "data": 1},    # confirmation, not a command
        _msg('{"type": "arm"}'),
    ]
    assert s.read_command() == {"type": "arm"}


def test_read_command_skips_invalid_json():
    s = _service()
    s.pubsub.get_message.side_effect = [_msg("not json"), _msg('{"type": "arm"}')]
    assert s.read_command() == {"type": "arm"}


def test_read_command_skips_non_object_json():
    s = _service()
    s.pubsub.get_message.side_effect = [
        _msg("[1, 2]"), _msg('"text"'), _msg('{"type": "arm"}'),
    ]
    assert s.read_command() == {"type": "arm"}


def test_read_command_keeps_order():
    s = _service()
    s.pubsub.get_message.side_effect = [_msg('{"n": 1}'), _msg('{"n": 2}'), None]
    assert s.read_command() == {"n": 1}
    assert s.read_command() == {"n": 2}
    assert s.read_command() is None


def test_read_command_none_when_nothing_pending():
    s = _service()
    s.pubsub.get_message.return_value = None
    assert s.read_command() is None


def test_read_command_disabled_returns_none():
    s = _service(commands=False)
    assert s.read_command() is None
    s.client.pubsub.assert_not_called()    # must not even subscribe


def test_read_command_without_client_returns_none():
    s = _service()
    s.client = None
    assert s.read_command() is None


def test_read_command_scan_limit_does_not_lose_command():
    s = _service()
    s.pubsub.get_message.side_effect = (
        [{"type": "pong", "data": "x"}] * redis_service.MAX_COMMAND_SCAN
        + [_msg('{"type": "arm"}')]
    )
    assert s.read_command() is None              # budget spent on noise
    assert s.read_command() == {"type": "arm"}   # next call still gets it


def test_read_error_drops_subscription_then_resubscribes():
    s = _service()
    old = s.pubsub
    old.get_message.side_effect = redis.ConnectionError("down")
    new = s.client.pubsub.return_value
    new.get_message.return_value = None

    with patch.object(redis_service.time, "monotonic", return_value=100.0):
        assert s.read_command() is None
    old.close.assert_called_once()
    assert s.pubsub is None

    # Inside the delay window: must not resubscribe yet
    with patch.object(redis_service.time, "monotonic", return_value=101.0):
        assert s.read_command() is None
    s.client.pubsub.assert_not_called()

    # Window over: resubscribes
    with patch.object(redis_service.time, "monotonic",
                      return_value=100.0 + redis_service.RESUBSCRIBE_DELAY + 0.1):
        assert s.read_command() is None
    s.client.pubsub.assert_called_once()
    new.subscribe.assert_called_once_with("cmd")
    assert s.pubsub is new


# ---------- connect / close with commands ----------

def test_connect_subscribes_when_commands_enabled():
    s = RedisService()
    s.commands_enabled = True
    s.command_channel = "cmd"
    with patch.object(redis_service.redis, "Redis") as fake_cls:
        assert s.connect() is True
    client = fake_cls.return_value
    client.pubsub.return_value.subscribe.assert_called_once_with("cmd")
    assert s.pubsub is client.pubsub.return_value


def test_connect_does_not_subscribe_when_disabled():
    s = RedisService()
    s.commands_enabled = False
    with patch.object(redis_service.redis, "Redis") as fake_cls:
        assert s.connect() is True
    fake_cls.return_value.pubsub.assert_not_called()
    assert s.pubsub is None


def test_connect_survives_subscribe_failure():
    s = RedisService()
    s.commands_enabled = True
    s.command_channel = "cmd"
    with patch.object(redis_service.redis, "Redis") as fake_cls:
        sub = fake_cls.return_value.pubsub.return_value.subscribe
        sub.side_effect = redis.ConnectionError("x")
        assert s.connect() is True    # telemetry must still work
    assert s.client is not None
    assert s.pubsub is None
    assert s._resubscribe_at > 0      # retry is scheduled


def test_close_drops_pubsub_and_client():
    s = _service()
    ps = s.pubsub
    s.close()
    ps.close.assert_called_once()
    assert s.pubsub is None
    assert s.client is None


def test_drop_pubsub_swallows_close_error():
    s = _service()
    s.pubsub.close.side_effect = RuntimeError("boom")
    s.drop_pubsub()    # must not raise
    assert s.pubsub is None


# ---------- config ----------

def test_config_channels_are_distinct():
    # Acks or commands on the telemetry channel would reach Node as "telemetry"
    names = [config.REDIS_CHANNEL, config.REDIS_COMMAND_CHANNEL, config.REDIS_ACK_CHANNEL]
    assert len(set(names)) == len(names)