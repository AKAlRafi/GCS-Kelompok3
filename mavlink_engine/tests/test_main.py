from mavlink_engine.main import clean


def test_clean_replaces_nan_and_inf():
    data = {"a": float("nan"), "b": float("inf"), "c": 1.5, "d": None, "e": 3}
    assert clean(data) == {"a": None, "b": None, "c": 1.5, "d": None, "e": 3}