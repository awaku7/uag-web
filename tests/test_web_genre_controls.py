from pathlib import Path
from uag_web.app import app


def test_genre_control_api_removed():
    import uag_web.routes_api  # noqa: F401 - register API routes

    assert not any(
        getattr(route, "path", "") == "/api/tool-genres" for route in app.routes
    )


def test_web_clients_no_longer_request_genre_controls():
    root = Path(__file__).resolve().parents[1]
    paths = (
        "frontend/src/App.svelte",
        "frontend/src/lib/components/UnifiedPanel.svelte",
        "frontend/src/lib/stores.svelte.js",
        "src/uag_web/static/assets/index.js",
        "src/uag_web/templates/index.html",
    )
    for path in paths:
        source = (root / path).read_text(encoding="utf-8")
        assert "/api/tool-genres" not in source
        assert "toggleGenre(" not in source


def test_bundled_web_javascript_parses():
    import shutil
    import subprocess

    import pytest

    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable; packaged JS parse check not run")
    bundle = Path(__file__).resolve().parents[1] / "src/uag_web/static/assets/index.js"
    subprocess.run(
        [node, "--check", str(bundle)],
        check=True,
        capture_output=True,
        text=True,
    )


def test_web_startup_genre_mask_is_retired():
    root = Path(__file__).resolve().parents[1]
    assert "--tool-genre-mask" not in (root / "src/uag_web/init.py").read_text(
        encoding="utf-8"
    )
