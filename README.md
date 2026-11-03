# UAG Web

Svelte + FastAPI Web host for [Universal AI Gateway](https://github.com/awaku7/agentcli).
The independent launch command is **`uagav` (UAG Avatar)**. Standard ZEN-LipSync avatars and matching ZEN-TTS voices can be installed locally.
See [voice/avatar setup](docs/AVATAR.ja.md); SDKs, weights and materials are not bundled.

UAG's existing Web, UI assets and launchers remain unchanged:

| Command | Application |
| --- | --- |
| `uagav` / `python -m uag_web` | Independent Web application |
| `uagw` / `python -m uagent.web` | Existing UAG Web |
| `uaga` / `python -m uagent.a2a.server` | Existing A2A server |

Both Web applications use port 8000. Stop one before starting the other;
concurrent operation is not supported. Installing or uninstalling this package
must not overwrite or remove the existing `uagw` or `uaga` commands.

This is an unpublished development candidate. It uses the unchanged UAG main
commit `71c5cd7`, which contains the accepted host callback API from PR #330.
No core source, command, version or package configuration is modified.
The current PyPI release predates those callbacks, so the development dependency
is pinned to that Git commit and is installed automatically (Git is required).
When an older UAG of the same version is already installed, pip may keep it;
use `--force-reinstall` for this development candidate as shown below.
Before PyPI publication, replace this VCS dependency with a released UAG version
that already contains #330. No core changes are proposed to enable publication.

Development (Python 3.11+, Git, Node.js):

```sh
python -m venv .venv
# Activate .venv using the command for your platform.
python -m pip install --force-reinstall -e '.[test,quality]' build
cd frontend
npm ci
npm run build
npm test
cd ..
python -m pytest -q tests
python -m black --check src tests
python -m ruff check src tests
python -m build
uagav
```

After release, installation will be `pip install uag-web` followed by `uagav`.
The Python package/module names remain `uag-web` and `uag_web`.

The frontend builds into `src/uag_web/static`; Node.js is unnecessary for a wheel
installation. The host retains the existing routes and configuration, uses UAG
as a library in the same process, and adds no network service or port. Development
uses the Vite `/api`, `/auth`, `/ws`, `/upload`, `/local-file` and `/static` proxies;
keep the configured Origin policy and OIDC redirect URI aligned with that origin.

The existing UI still uses Tailwind CDN and Google Fonts. Offline UI, real OIDC,
provider conversation, Web-mediated Sandbox, mobile/audio acceptance and inherited
dependency audit findings remain release checks. See [coexistence](docs/COEXISTENCE.ja.md).
Windows, Linux and macOS remain supported targets. ZEN-LipSync source/SDK/assets
are not included in the repository or distributions. See the setup guide for usage terms.
