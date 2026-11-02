from uagent.runtime import mxc_backend
from uagent.runtime.execution_broker import (
    IsolationLevel,
    SandboxCapabilities,
    SandboxCapability,
)


def all_local_capabilities() -> SandboxCapabilities:
    return SandboxCapabilities(
        isolation_level=IsolationLevel.CONTAINER,
        available=frozenset(SandboxCapability),
    )


def test_web_room_release_revokes_scope_before_fresh_binding(monkeypatch, tmp_path):
    from uag_web.rooms import WebManager

    class FakeProcess:
        @staticmethod
        def poll():
            return None

    class FakeSession:
        def __init__(self, *, scope, node, runtime):
            self._scope = scope
            self._closed = False
            self._proc = FakeProcess()

        def run(self, _name, _args):
            return self._scope.scope_id

        def close(self):
            self._closed = True

    monkeypatch.setattr(mxc_backend, "_MxcSession", FakeSession)
    sessions = mxc_backend.MxcSessionManager(
        node=tmp_path / "node.exe",
        runtime=tmp_path,
        capabilities=all_local_capabilities(),
    )
    rooms = WebManager()
    rooms.sandbox_session_manager = sessions
    room = rooms.get_room("room-a")
    scope = mxc_backend.local_web_room_scope(
        principal_id="alice",
        project_id="project-a",
        room_id=room.room_id,
        room_generation=room.sandbox_scope_generation(),
    )
    rooms.bind_sandbox_scope(room, scope)
    assert sessions.run_tool(scope, "file_exists", {"path": "x"}) == scope.scope_id

    assert rooms.release_room_sandbox_scope(room, expected_scope=scope)
    assert "revoked or unbound" in sessions.run_tool(
        scope, "file_exists", {"path": "x"}
    )
    fresh_scope = mxc_backend.local_web_room_scope(
        principal_id="alice",
        project_id="project-a",
        room_id=room.room_id,
        room_generation=room.sandbox_scope_generation(),
    )
    rooms.bind_sandbox_scope(room, fresh_scope)
    assert (
        sessions.run_tool(fresh_scope, "file_exists", {"path": "x"})
        == fresh_scope.scope_id
    )
    sessions.close_all()


def test_web_room_release_fences_scope_before_detaching_lease(monkeypatch, tmp_path):
    from uag_web.rooms import WebManager

    created_scopes = []

    class FakeProcess:
        @staticmethod
        def poll():
            return None

    class FakeSession:
        def __init__(self, *, scope, node, runtime):
            self._scope = scope
            self._closed = False
            self._proc = FakeProcess()
            created_scopes.append(scope)

        def run(self, _name, _args):
            return self._scope.scope_id

        def close(self):
            self._closed = True

    monkeypatch.setattr(mxc_backend, "_MxcSession", FakeSession)
    session_manager = mxc_backend.MxcSessionManager(
        node=tmp_path / "node.exe",
        runtime=tmp_path,
        capabilities=all_local_capabilities(),
    )
    web_manager = WebManager()
    web_manager.sandbox_session_manager = session_manager
    room = web_manager.get_room("room-a")
    scope = mxc_backend.local_web_room_scope(
        principal_id="alice",
        project_id="project-a",
        room_id=room.room_id,
        room_generation=room.sandbox_scope_generation(),
    )
    web_manager.bind_sandbox_scope(room, scope)
    assert session_manager.run_tool(scope, "file_exists", {"path": "x"}) == (
        scope.scope_id
    )

    assert web_manager.release_room_sandbox_scope(room, expected_scope=scope)
    assert room.current_sandbox_scope() is None
    assert room.sandbox_scope_generation() != scope.binding_generation
    assert "revoked or unbound" in session_manager.run_tool(
        scope, "file_exists", {"path": "x"}
    )

    fresh_scope = mxc_backend.local_web_room_scope(
        principal_id="alice",
        project_id="project-a",
        room_id=room.room_id,
        room_generation=room.sandbox_scope_generation(),
    )
    web_manager.bind_sandbox_scope(room, fresh_scope)
    assert session_manager.run_tool(fresh_scope, "file_exists", {"path": "x"}) == (
        fresh_scope.scope_id
    )
    assert created_scopes == [scope, fresh_scope]
    session_manager.close_all()
