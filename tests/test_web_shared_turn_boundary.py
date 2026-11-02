from pathlib import Path


def test_web_turn_prefers_bound_room_session_over_process_default() -> None:
    root = Path(__file__).resolve().parents[1]
    source = (root / "src/uag_web/agent_worker.py").read_text(encoding="utf-8")
    assert (
        'session_id=str(room.session_id or getattr(core, "session_id", "") or ""),'
        in source
    )
    assert "_ensure_public_room_session(" in source
    assert "_room_session_runtime = bind_room_session_runtime(core, room)" in source


def test_web_uses_shared_llm_and_turn_context():
    root = Path(__file__).resolve().parents[1]
    source = (root / "src/uag_web/agent_worker.py").read_text(encoding="utf-8")
    assert "call_with_resolved_turn_context" in source
    assert "llm_util.run_llm_rounds" in source
    assert 'entry_point="web"' in source
