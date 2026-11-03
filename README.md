# UAG Web

Svelte + FastAPI Web host for [Universal AI Gateway](https://github.com/awaku7/agentcli).
Agent execution, providers, tools, memory, authorization, Sandbox and telemetry
are supplied by the `uag` Python package in the same server process.

This checkout is a migration candidate, not a published release. UAG 0.7.42
is required for the shared trace ownership API and must be released first.
The bundled UAG Web remains available.

After release:

```sh
pip install uag-web
uaga
```

The launchers remain separate:

| Command | Application |
| --- | --- |
| `uaga` or `python -m uag_web` | Independent Web application |
| `uagw` or `python -m uagent.web` | Existing bundled UAG Web |
| `uaga2a` | A2A server (previous command: `uaga`) |

Both Web applications use port 8000. Stop one before starting the other;
concurrent operation is not supported. Installing or uninstalling `uag-web`
keeps the bundled Web and `uagw` intact. The core A2A command changes from
`uaga` to `uaga2a` to free `uaga` for this application; update existing A2A scripts.
`python -m uagent.a2a.server` remains available. This naming change is a draft
proposal and has not been merged or published.

Development (Python 3.11+, Node.js):

```sh
python -m pip install -e '../agentcli[core,web,quality]' -e '.[test,quality]' build
cd frontend
npm ci
npm run build
npm test
cd ..
python -m pytest -q tests
python -m black --check src tests
python -m ruff check src tests
python -m build
```

The frontend builds into `src/uag_web/static`; Node.js is unnecessary for an
installed wheel. The server retains the existing UAG Web options, environment
settings and routes. Use the Vite `/api`, `/auth`, `/ws`, `/upload`, `/local-file`
and `/static` proxies for same-origin development. Configure the existing UAG
Origin policy and OIDC redirect URI for that origin; do not disable validation.

The existing UI still uses Tailwind CDN and Google Fonts. Offline UI support has
not been verified. See the [migration plan](docs/UAG_WEB_MIGRATION.ja.md) for the
protocol, security boundaries, pending acceptance checks and release order.

ZEN-LipSync is not included. Any avatar integration will require a separate
license review and PR. Windows, Linux and macOS remain supported targets;
platform CI and real Sandbox/OIDC/provider acceptance are required before release.
