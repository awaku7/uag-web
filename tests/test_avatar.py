from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from uag_web.server import app
from uag_web import routes_avatar


def test_config_does_not_expose_operator_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("UAGAV_ZEN_DIR", str(tmp_path))
    with TestClient(app) as client:
        response = client.get("/api/avatar/config")
    assert response.status_code == 200
    assert str(tmp_path) not in response.text
    assert [p["id"] for p in response.json()["presets"]] == [
        "marine",
        "hashiro",
        "kikka",
    ]
    assert not any(p["ready"] for p in response.json()["presets"])
    assert [v["id"] for v in response.json()["voices"]] == [
        "marine",
        "hashiro",
        "kai",
        "kikka",
    ]
    assert not any(v["ready"] for v in response.json()["voices"])


@pytest.mark.parametrize(
    "url", ["/api/avatar/config", "/api/avatar/files/sdk/dist/index.js"]
)
def test_avatar_requires_existing_server_identity(url):
    with patch.object(
        routes_avatar, "_request_identity", side_effect=ValueError("no session")
    ):
        with TestClient(app) as client:
            assert client.get(url).status_code == 401


def test_assets_are_scoped_and_javascript_has_correct_type(monkeypatch, tmp_path):
    monkeypatch.setenv("UAGAV_ZEN_DIR", str(tmp_path))
    entry = tmp_path / "sdk/dist/index.js"
    entry.parent.mkdir(parents=True)
    entry.write_text("export const VERSION = '1.1.0';")
    (tmp_path / "sdk/private.env").write_text("secret")
    with TestClient(app) as client:
        response = client.get("/api/avatar/files/sdk/dist/index.js")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/javascript")
        assert response.headers["cache-control"] == "private, no-store"
        for asset in (
            "sdk/private.env",
            "sdk/.git/config",
            "sdk/dist/%2e%2e/%2e%2e/private.env",
            "models/unknown.ztm",
            "tts/node_modules/private.js",
            "avatars/avatars/custom/avatar.json",
        ):
            assert client.get(f"/api/avatar/files/{asset}").status_code == 404


def test_asset_symlink_cannot_escape(monkeypatch, tmp_path):
    monkeypatch.setenv("UAGAV_ZEN_DIR", str(tmp_path / "runtime"))
    outside = tmp_path / "secret.js"
    outside.write_text("secret")
    entry = tmp_path / "runtime/sdk/dist/index.js"
    entry.parent.mkdir(parents=True)
    try:
        entry.symlink_to(outside)
    except OSError:
        pytest.skip("symlinks require additional Windows permissions")
    with TestClient(app) as client:
        assert client.get("/api/avatar/files/sdk/dist/index.js").status_code == 404


def test_reconnect_marks_stream_snapshots_without_changing_live_events(monkeypatch):
    import asyncio
    from uag_web import rooms

    room = rooms.WebRoom("avatar-reconnect")
    room.welcome_shown = True
    room._partial_streams = {"finished": "already spoken", "active": "partial"}
    room._ended_streams = {"finished"}
    monkeypatch.setattr(rooms, "_load_input_history", lambda: [])
    events = []

    class Socket:
        async def accept(self):
            pass

        async def send_json(self, event):
            events.append(event)

    async def exercise():
        await room.connect(Socket())
        await room.broadcast({"type": "assistant_stream_start", "id": "new"})

    asyncio.run(exercise())
    retained = [event for event in events if event.get("id") in {"finished", "active"}]
    assert len(retained) == 5
    assert all(event["snapshot"] is True for event in retained)
    assert events[-1] == {"type": "assistant_stream_start", "id": "new"}


def test_kai_voice_model_is_allowed_without_inventing_kai_avatar(monkeypatch, tmp_path):
    monkeypatch.setenv("UAGAV_ZEN_DIR", str(tmp_path))
    for filename in (
        "tts/dist/index.js",
        "tts/models/g2p/g2p.json",
        "tts/models/g2p/g2p.bin",
        "tts/cpu/tts-cpu.wasm",
        "models/kai.ztm",
    ):
        target = tmp_path / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"fixture")
    # The fourth TTS voice works with any supported avatar once its pack exists.
    # It does not imply that a Kai lip-sync avatar has been published.
    with TestClient(app) as client:
        config = client.get("/api/avatar/config").json()
        voices = {item["id"]: item["ready"] for item in config["voices"]}
        avatars = {item["id"]: item["ready"] for item in config["presets"]}
        assert voices == {
            "marine": False,
            "hashiro": False,
            "kai": True,
            "kikka": False,
        }
        assert avatars == {"marine": False, "hashiro": False, "kikka": False}
        assert client.get("/api/avatar/files/models/kai.ztm").status_code == 200
        assert (
            client.get("/api/avatar/files/avatars/avatars/kai/avatar.json").status_code
            == 404
        )
