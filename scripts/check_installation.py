"""Verify separate Web launchers through installation and uninstallation."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import venv

web_wheel = next(Path("dist").glob("uag_web-*.whl")).resolve()
core_wheel = next(Path("dist/core").glob("uag-*.whl")).resolve()
core_version = core_wheel.name.split("-")[1]

with tempfile.TemporaryDirectory(prefix="uag-web-install-") as temporary:
    root = Path(temporary)
    environment = root / "venv"
    venv.EnvBuilder(with_pip=True).create(environment)
    binaries = environment / ("Scripts" if os.name == "nt" else "bin")
    python = binaries / ("python.exe" if os.name == "nt" else "python")
    pip = [str(python), "-m", "pip", "--disable-pip-version-check"]
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
    launchers = {
        name: hashlib.sha256(
            (binaries / (name + (".exe" if os.name == "nt" else ""))).read_bytes()
        ).hexdigest()
        for name in ("uagw", "uaga2a")
    }
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.update(
        UAGENT_IDENTITY_MODE="local",
        UAGENT_STATE_DIR=str(root / "state"),
        UAGENT_AUTO_INSTALL="off",
        EXPECTED_CORE_VERSION=core_version,
        CORE_LAUNCHERS_SHA=json.dumps(launchers),
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
from unittest.mock import patch
from fastapi.testclient import TestClient
from uag_web.server import app

assert metadata.version('uag') == os.environ['EXPECTED_CORE_VERSION']
assert importlib.util.find_spec('uagent.web') is not None
assert importlib.util.find_spec('uagent.web_impl') is not None
core = {ep.name: ep.value for ep in metadata.distribution('uag').entry_points}
assert core['uagw'] == 'uagent.web:main'
assert core['uaga2a'] == 'uagent.a2a.server:main'
assert 'uaga' not in core
scripts = [ep for ep in metadata.distribution('uag-web').entry_points if ep.group == 'console_scripts']
assert [(ep.name, ep.value) for ep in scripts] == [('uaga', 'uag_web.server:main')]
assert (Path(sys.executable).parent / ('uaga.exe' if os.name == 'nt' else 'uaga')).is_file()
with patch('uag_web.server.main') as independent:
    scripts[0].load()()
    independent.assert_called_once_with()
assert 'uagent.web' not in sys.modules
with TestClient(app) as client:
    assert client.get('/').status_code == 200
    assert client.get('/static/assets/index.js').status_code == 200
    assert client.get('/api/auth/status').json()['authenticated']
os.write(1, b'Installed uag-web: separate launcher and HTTP/static/auth passed\\n')
""",
        ],
        cwd=root,
        env=env,
        check=True,
    )
    subprocess.run(
        [
            str(python),
            "-c",
            """
import importlib.metadata as metadata
from unittest.mock import patch
with patch('uagent.web.main') as bundled:
    next(ep for ep in metadata.distribution('uag').entry_points if ep.name == 'uagw').load()()
    bundled.assert_called_once_with()
""",
        ],
        cwd=root,
        env=env,
        check=True,
    )
    a2a = subprocess.run(
        [str(binaries / ("uaga2a.exe" if os.name == "nt" else "uaga2a")), "--help"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert a2a.returncode == 0, a2a.stderr
    assert "uaga2a" in a2a.stdout and "--port" in a2a.stdout
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
assert not (binaries / ('uaga.exe' if os.name == 'nt' else 'uaga')).exists()
for name, expected in json.loads(os.environ['CORE_LAUNCHERS_SHA']).items():
    executable = binaries / (name + ('.exe' if os.name == 'nt' else ''))
    assert hashlib.sha256(executable.read_bytes()).hexdigest() == expected
with TestClient(app) as client:
    assert client.get('/').status_code == 200
    assert client.get('/static/assets/index.js').status_code == 200
    assert client.get('/api/auth/status').json()['authenticated']
os.write(1, b'Uninstalled uag-web: bundled Web, uagw and uaga2a preserved\\n')
""",
        ],
        cwd=root,
        env=env,
        check=True,
    )
