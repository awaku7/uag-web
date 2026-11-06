"""WebSocket locale normalization and per-turn language isolation."""

import pytest

from uag_web import routes_ws
from uag_web.agent_worker import run_agent_worker
from uag_web.process_workers import RoomWorkerPool
from uag_web.rooms import WebRoom, web_manager


@pytest.mark.parametrize(
    ("tag", "expected"),
    [
        ("ja", "ja"),
        ("en", "en"),
        ("ar", "ar"),
        ("de", "de"),
        ("fr", "fr"),
        ("es", "es"),
        ("zh-CN", "zh_CN"),
        ("zh-TW", "zh_TW"),
        ("pt-BR", "pt_BR"),
        ("xx-unknown", "en"),
        (None, "en"),
    ],
)
def test_websocket_language_uses_uag_catalogs(tag, expected):
    assert routes_ws._normalize_lang_tag(tag) == expected


def _locale_child(connection, payload):
    """Simulate a process worker and observe the language passed to its turn."""
    from uagent.runtime import runtime_plugins
    from uag_web import agent_worker
    from uag_web.process_workers import _child_turn

    runtime_plugins.load_plugins_status_at_startup = lambda **kwargs: ([], "")

    def fake_turn(room, user_input, attachments=None, **kwargs):
        room.add_message(
            {
                "role": "assistant",
                "content": f"locale={kwargs.get('request_lang')};room={room.lang}",
            }
        )

    agent_worker.run_agent_worker = fake_turn
    _child_turn(connection, payload)


def test_process_worker_turn_locale_does_not_leak_into_shared_room(
    monkeypatch, tmp_path
):
    from uagent import core
    from uagent.tools import _genre_control_util

    monkeypatch.setattr(core, "session_store", None, raising=False)
    monkeypatch.setattr(core, "auto_pilot_active", False, raising=False)
    monkeypatch.setattr(_genre_control_util, "get_enabled_tool_names", lambda: [])

    room = WebRoom("room-locale")
    room.lang = "ar"
    room.private_session = True
    room.base_dir = str(tmp_path)
    room.history_initialized = True
    pool = RoomWorkerPool(1, target=_locale_child)
    try:
        pool.run(room, "bonjour", request_lang="fr")
        assert room.lang == "ar"
        assert any(
            message.get("content") == "locale=fr;room=ar" for message in room.messages
        )
        pool.run(room, "hallo", request_lang="de")
        assert room.lang == "ar"
        assert any(
            message.get("content") == "locale=de;room=ar" for message in room.messages
        )
    finally:
        pool.shutdown()


def test_parent_worker_forwards_request_locale_to_process_pool(monkeypatch):
    captured = {}

    class StubPool:
        def run(self, room, user_input, attachments, **kwargs):
            captured.update(kwargs)
            return "accepted"

    monkeypatch.setattr(web_manager, "room_worker_pool", StubPool())
    room = WebRoom("room-a")
    room.lang = "ar"

    assert run_agent_worker(room, "hello", request_lang="fr") == "accepted"
    assert captured["request_lang"] == "fr"
    assert room.lang == "ar"
