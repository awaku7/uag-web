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
