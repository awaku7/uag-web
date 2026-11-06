"""WebSocket locale normalization and per-turn language isolation."""

from types import SimpleNamespace

import pytest

from uag_web import routes_ws
from uag_web.agent_worker import run_agent_worker
from uag_web.process_workers import room_turn_state
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


def test_process_worker_uses_request_locale_without_mutating_shared_room():
    room = SimpleNamespace(room_id="room-a", lang="ar")
    french = room_turn_state(room, "fr")
    german = room_turn_state(room, "de")

    assert french["lang"] == "fr"
    assert german["lang"] == "de"
    assert room.lang == "ar"


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
