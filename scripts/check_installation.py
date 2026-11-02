"""Install the Web wheel over the last bundled UAG release in a clean venv."""

from pathlib import Path
import os
import subprocess
import sys
import tempfile
import venv

web_wheel = next(Path("dist").glob("uag_web-*.whl")).resolve()
core_wheel = next(Path("dist/core").glob("uag-*.whl")).resolve()
core_version = core_wheel.name.split("-")[1]

with tempfile.TemporaryDirectory(prefix="uag-web-install-") as temporary:
    root = Path(temporary)
    environment = root / "venv"
    venv.EnvBuilder(with_pip=True).create(environment)
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    pip = [str(python), "-m", "pip", "--disable-pip-version-check"]
    # Exercise the migration most users need: an installed core that owned uagw.
    subprocess.run([*pip, "install", "uag==0.7.41"], check=True)
    constraints = root / "constraints.txt"
    constraints.write_text(f"uag=={core_version}\n", encoding="utf-8")
    subprocess.run(
        [
            *pip,
            "install",
            "--find-links",
            str(core_wheel.parent),
            "--constraint",
            str(constraints),
            str(web_wheel),
        ],
        check=True,
    )
    subprocess.run([*pip, "check"], check=True)
    env = os.environ.copy()
    env.update(
        UAGENT_IDENTITY_MODE="local",
        UAGENT_STATE_DIR=str(root / "state"),
        UAGENT_AUTO_INSTALL="off",
        EXPECTED_CORE_VERSION=core_version,
    )
    subprocess.run(
        [
            str(python),
            "-c",
            """
import importlib.metadata as metadata
import importlib.util
import os
from pathlib import Path
import sys
from fastapi.testclient import TestClient
from uag_web.server import app

assert metadata.version('uag') == os.environ['EXPECTED_CORE_VERSION']
assert importlib.util.find_spec('uagent.web') is None
assert importlib.util.find_spec('uagent.web_impl') is None
assert not any(ep.name == 'uagw' for ep in metadata.distribution('uag').entry_points)
assert any(ep.name == 'uagw' for ep in metadata.distribution('uag-web').entry_points)
assert (Path(sys.executable).parent / ('uagw.exe' if os.name == 'nt' else 'uagw')).is_file()
with TestClient(app) as client:
    assert client.get('/').status_code == 200
    assert client.get('/static/assets/index.js').status_code == 200
    assert client.get('/api/auth/status').json()['authenticated']
os.write(1, b'Installed wheels: core upgrade, Web entry point, HTTP/static/auth passed\\n')
""",
        ],
        cwd=root,
        env=env,
        check=True,
    )
