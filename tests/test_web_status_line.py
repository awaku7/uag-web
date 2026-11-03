from uag_web import server as webmod


def test_web_room_status_uses_reasoning_label(monkeypatch):
    monkeypatch.setenv("UAGENT_REASONING", "high")
    room = webmod.WebRoom("test-room")

    room.set_status(True, "LLM")

    assert room.status["label"] == "LLM:high"


def test_strip_state_markers_web():
    assert webmod._strip_state_markers("[STATE] BUSY [tool:parallel]") == ""
    assert (
        webmod._strip_state_markers("hello [STATE] BUSY [LLM] world") == "hello  world"
    )
    assert webmod._strip_state_markers("plain text") == "plain text"
