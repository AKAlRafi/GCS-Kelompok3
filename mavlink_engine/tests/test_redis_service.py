from unittest.mock import MagicMock, patch
import redis
from mavlink_engine import config
from mavlink_engine.services import redis_service
from mavlink_engine.services.redis_service import RedisService


def _service_with_fake_client():
    s = RedisService()
    s.client = MagicMock()  # stands in for a real Redis connection
    return s


def test_publish_sends_json():
    s = _service_with_fake_client()
    assert s.publish_telemetry({"lat": -7.0}) is True
    # config.REDIS_CHANNEL (not a literal) so the test survives env overrides
    s.client.publish.assert_called_once_with(config.REDIS_CHANNEL, '{"lat": -7.0}')


def test_publish_without_connect_returns_false():
    assert RedisService().publish_telemetry({"lat": 1}) is False


def test_publish_rejects_nan():
    s = _service_with_fake_client()
    assert s.publish_telemetry({"roll": float("nan")}) is False
    s.client.publish.assert_not_called()

def test_publish_failure_returns_false():
    s = _service_with_fake_client()
    s.client.publish.side_effect = redis.ConnectionError("down")
    assert s.publish_telemetry({"lat": 1}) is False


def test_backoff_skips_redis_then_recovers():
    s = _service_with_fake_client()
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
    s = _service_with_fake_client()
    s.close()
    assert s.client is None
    assert s.publish_telemetry({"lat": 1}) is False