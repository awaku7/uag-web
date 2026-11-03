"""The independent host must own assets and preserve the original route contract."""

from pathlib import Path
import subprocess
import sys


def test_web_import_does_not_load_old_host():
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import uag_web.server; "
            "assert not any(n == 'uagent.web' or n.startswith('uagent.web_impl') "
            "for n in sys.modules)",
        ],
        check=True,
        timeout=30,
    )


def test_assets_belong_to_web_package():
    from uag_web.app import BASE_DIR, STATIC_DIR

    assert Path(BASE_DIR).name == "uag_web"
    assert (Path(STATIC_DIR) / "index.html").is_file()


def test_original_http_and_websocket_routes_are_preserved():
    import json

    from uag_web.server import app

    inventory = json.loads(
        (
            Path(__file__).parents[1] / "docs/UAG_WEB_MIGRATION_INVENTORY.json"
        ).read_text()
    )
    expected = {
        (route["method"], route["path"])
        for module in inventory["modules"].values()
        for route in module["routes"]
    }
    actual = set()
    for route in app.routes:
        if type(route).__name__ == "APIWebSocketRoute":
            actual.add(("WEBSOCKET", route.path))
        for method in getattr(route, "methods", ()):
            actual.add((method, route.path))
    assert expected <= actual
