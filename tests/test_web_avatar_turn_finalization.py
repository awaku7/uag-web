"""Final audio turn notifications must retain the authenticated turn context."""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import pytest

from uagent.runtime.identity_context import (
    IdentityContext,
    TurnContext,
    get_current_turn_context,
)
from uag_web import agent_worker
from uag_web.rooms import WebRoom


@pytest.mark.parametrize("access_revoked", [False, True])
def test_authenticated_avatar_turn_completion_keeps_identity_context(
    monkeypatch, tmp_path, access_revoked
):
    monkeypatch.setenv("UAGENT_PROVIDER", "offline-test")
    monkeypatch.setattr(agent_worker.web_manager, "room_worker_pool", None)
    monkeypatch.setattr(
        agent_worker.web_manager, "execution_profile", "remote", raising=False
    )
    monkeypatch.setattr(
        agent_worker.web_manager, "sandbox_enabled", False, raising=False
    )
    monkeypatch.setattr(
        agent_worker, "_web_turn_authorization_valid", lambda *args: True
    )

    core = SimpleNamespace(
        log_message=lambda _message: None,
        auto_pilot_active=False,
        interrupt_lock=threading.Lock(),
        interrupt_requested=False,
        status_busy=False,
        status_label="IDLE",
        _last_round_outcome={},
        memory_projection_snapshot=None,
    )
    monkeypatch.setattr(agent_worker, "core", core)
    monkeypatch.setattr(
        agent_worker.providers,
        "make_client",
        lambda _core: ("offline-test", object(), "test-model"),
    )

    room = WebRoom("avatar-authenticated-final")
    room.base_dir = str(tmp_path)
    room.private_session = True
    room.history_initialized = True
    room.loop = object()
    events = []

    async def capture_broadcast(event, *, _connections=None):
        events.append(dict(event))

    monkeypatch.setattr(room, "broadcast", capture_broadcast)
    monkeypatch.setattr(
        agent_worker.asyncio,
        "run_coroutine_threadsafe",
        lambda coroutine, _loop: asyncio.run(coroutine),
    )

    identity = IdentityContext(
        principal_id="test-user", authenticated=True, authn_kind="oidc"
    )
    turn = TurnContext.from_identity(
        identity,
        room_id=room.room_id,
        project_id="test-project",
        session_id="test-private-session",
        entry_point="web",
        private_session=True,
        server_bound_project=True,
    )

    def is_projection_current(snapshot, _core):
        if snapshot is None:
            return True
        active = get_current_turn_context()
        return (
            active is not None
            and active.principal_id == snapshot.principal_id
            and active.room_id == snapshot.room_id
            and not access_revoked
        )

    monkeypatch.setattr(
        agent_worker, "memory_projection_access_is_current", is_projection_current
    )

    def fake_rounds(_provider, _client, _model, history, *, core, **_kwargs):
        assert get_current_turn_context() == turn
        core.memory_projection_snapshot = SimpleNamespace(
            principal_id=turn.principal_id, room_id=turn.room_id
        )
        answer = {"role": "assistant", "content": "正常な最終回答です。"}
        history.append(answer)
        core.log_message(answer)

    monkeypatch.setattr(agent_worker.llm_util, "run_llm_rounds", fake_rounds)

    agent_worker.run_agent_worker(
        room,
        "質問です。",
        turn_context=turn,
        identity_context=identity,
        project_path=str(tmp_path),
    )

    terminal_events = [
        event["type"]
        for event in events
        if event.get("type") in ("assistant_turn_complete", "assistant_turn_cancelled")
    ]
    assert terminal_events == [
        "assistant_turn_cancelled" if access_revoked else "assistant_turn_complete"
    ]
    assert get_current_turn_context() is None


def test_early_worker_setup_failure_does_not_strand_room_or_global_lock(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("UAGENT_PROVIDER", "offline-test")
    monkeypatch.setattr(agent_worker, "resolve_identity_mode", lambda: "local")
    monkeypatch.setattr(agent_worker.web_manager, "room_worker_pool", None)
    monkeypatch.setattr(
        agent_worker.web_manager, "execution_profile", "local_trusted", raising=False
    )
    monkeypatch.setattr(
        agent_worker.web_manager, "sandbox_enabled", False, raising=False
    )
    global_lock = threading.Lock()
    monkeypatch.setattr(agent_worker.web_manager, "global_worker_lock", global_lock)
    core = SimpleNamespace(
        log_message=lambda _message: None,
        status_busy=False,
        status_label="IDLE",
        interrupt_lock=threading.Lock(),
        interrupt_requested=False,
    )
    monkeypatch.setattr(agent_worker, "core", core)
    monkeypatch.setattr(
        agent_worker,
        "bind_room_session_runtime",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("simulated setup failure")),
    )
    room = WebRoom("setup-failure")
    room.base_dir = str(tmp_path)
    room.history_initialized = True
    room.session_id = "existing-session"

    agent_worker.run_agent_worker(room, "質問です。")

    assert room.worker_lock.acquire(blocking=False)
    room.worker_lock.release()
    assert global_lock.acquire(blocking=False)
    global_lock.release()
    assert room.status["busy"] is False
