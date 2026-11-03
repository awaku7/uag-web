"""Regression tests for terminal avatar events after web worker crashes."""

import asyncio

from uag_web.rooms import WebRoom


def test_crashed_worker_discards_pending_avatar_speech(monkeypatch):
    room = WebRoom("avatar-recovery")
    room._partial_streams = {"stream-1": "unfinished answer"}
    room._pending_replays[123] = []
    room.loop = object()
    broadcasts = []

    async def capture_broadcast(event, *, _connections=None):
        broadcasts.append(event)

    def run_in_test_loop(coroutine, _loop):
        asyncio.run(coroutine)

    monkeypatch.setattr(room, "broadcast", capture_broadcast)
    monkeypatch.setattr(asyncio, "run_coroutine_threadsafe", run_in_test_loop)

    recovered = room.recover_partial_streams("[FATAL] Worker crashed.")

    assert recovered == ["unfinished answer"]
    assert [event["type"] for event in broadcasts] == [
        "assistant_stream_end",
        "message",
        "message",
        "assistant_turn_cancelled",
    ]
    assert [event["type"] for event in room._pending_replays[123]] == [
        "assistant_stream_end",
        "message",
        "assistant_turn_cancelled",
    ]
    assert room._partial_streams == {}
