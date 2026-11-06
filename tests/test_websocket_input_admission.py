"""Bounded WebSocket input admission without unbounded thread creation."""

import threading

import pytest

from uag_web import routes_ws


def test_input_worker_admission_is_bounded_and_released(monkeypatch):
    workers = []
    calls = []

    class DeferredThread:
        def __init__(self, *, target, args, daemon):
            assert daemon
            self.target = target
            self.args = args

        def start(self):
            workers.append(self)

    monkeypatch.setattr(routes_ws.threading, "Thread", DeferredThread)
    monkeypatch.setattr(routes_ws, "_input_worker_slots", threading.BoundedSemaphore(1))

    assert routes_ws._start_input_worker(calls.append, ("first",), {})
    assert not routes_ws._start_input_worker(calls.append, ("rejected",), {})
    assert len(workers) == 1

    first = workers.pop()
    first.target(*first.args)
    assert routes_ws._start_input_worker(calls.append, ("second",), {})

    second = workers.pop()
    second.target(*second.args)
    assert calls == ["first", "second"]


def test_input_worker_slots_release_after_start_failure(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(routes_ws, "_input_worker_slots", slots)

    class BrokenThread:
        def __init__(self, *, target, args, daemon):
            pass

        def start(self):
            raise RuntimeError("unable to start thread")

    monkeypatch.setattr(routes_ws.threading, "Thread", BrokenThread)
    with pytest.raises(RuntimeError, match="unable to start thread"):
        routes_ws._start_input_worker(lambda: None, (), {})
    assert slots.acquire(blocking=False)
    slots.release()
