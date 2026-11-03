"""Verify uagav install/uninstall without changing UAG's existing commands."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib
import venv

web_wheel = next(Path("dist").glob("uag_web-*.whl")).resolve()
project = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))["project"]
core_dependency = next(
    value for value in project["dependencies"] if value.startswith("uag[")
)
core_commit = core_dependency.rsplit("@", 1)[1]

with tempfile.TemporaryDirectory(prefix="uagav-install-") as temporary:
    root = Path(temporary)
    environment = root / "venv"
    venv.EnvBuilder(with_pip=True).create(environment)
    binaries = environment / ("Scripts" if os.name == "nt" else "bin")
    python = binaries / ("python.exe" if os.name == "nt" else "python")
    pip = [str(python), "-m", "pip", "--disable-pip-version-check"]
    subprocess.run([*pip, "install", "uag==0.7.41"], check=True)
    subprocess.run([*pip, "install", "--force-reinstall", str(web_wheel)], check=True)
    subprocess.run([*pip, "check"], check=True)
    launchers = {
        name: hashlib.sha256(
            (binaries / (name + (".exe" if os.name == "nt" else ""))).read_bytes()
        ).hexdigest()
        for name in ("uagw", "uaga")
    }
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.update(
        UAGENT_IDENTITY_MODE="local",
        UAGENT_STATE_DIR=str(root / "state"),
        UAGENT_AUTO_INSTALL="off",
        EXPECTED_CORE_COMMIT=core_commit,
        CORE_LAUNCHERS_SHA=json.dumps(launchers),
    )
    subprocess.run(
        [
            str(python),
            "-c",
            """
import importlib.metadata as metadata
import importlib.util
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch
from fastapi.testclient import TestClient
from uag_web.server import app

core_dist = metadata.distribution('uag')
origin = json.loads(core_dist.read_text('direct_url.json'))
assert origin['vcs_info']['commit_id'] == os.environ['EXPECTED_CORE_COMMIT']
assert importlib.util.find_spec('uagent.web') is not None
assert importlib.util.find_spec('uagent.web_impl') is not None
core = {ep.name: ep.value for ep in core_dist.entry_points}
assert core['uagw'] == 'uagent.web:main'
assert core['uaga'] == 'uagent.a2a.server:main'
assert 'uaga2a' not in core
scripts = [ep for ep in metadata.distribution('uag-web').entry_points if ep.group == 'console_scripts']
assert [(ep.name, ep.value) for ep in scripts] == [('uagav', 'uag_web.server:main')]
assert (Path(sys.executable).parent / ('uagav.exe' if os.name == 'nt' else 'uagav')).is_file()
with patch('uag_web.server.main') as independent:
    scripts[0].load()()
    independent.assert_called_once_with()
assert 'uagent.web' not in sys.modules
with TestClient(app) as client:
    assert client.get('/').status_code == 200
    assert client.get('/static/assets/index.js').status_code == 200
    assert client.get('/api/auth/status').json()['authenticated']
os.write(1, b'Installed uagav: launcher and HTTP/static/auth passed\\n')
""",
        ],
        cwd=root,
        env=env,
        check=True,
    )
    a2a = subprocess.run(
        [str(binaries / ("uaga.exe" if os.name == "nt" else "uaga")), "--help"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert a2a.returncode == 0, a2a.stderr
    assert "uaga" in a2a.stdout and "--port" in a2a.stdout
    subprocess.run([*pip, "uninstall", "--yes", "uag-web"], check=True)
    subprocess.run(
        [
            str(python),
            "-c",
            """
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from fastapi.testclient import TestClient
from uagent.web import app

assert importlib.util.find_spec('uag_web') is None
binaries = Path(sys.executable).parent
assert not (binaries / ('uagav.exe' if os.name == 'nt' else 'uagav')).exists()
for name, expected in json.loads(os.environ['CORE_LAUNCHERS_SHA']).items():
    executable = binaries / (name + ('.exe' if os.name == 'nt' else ''))
    assert hashlib.sha256(executable.read_bytes()).hexdigest() == expected
with TestClient(app) as client:
    assert client.get('/').status_code == 200
    assert client.get('/static/assets/index.js').status_code == 200
    assert client.get('/api/auth/status').json()['authenticated']
os.write(1, b'Uninstalled uagav: bundled Web, uagw and uaga preserved\\n')
""",
        ],
        cwd=root,
        env=env,
        check=True,
    )
