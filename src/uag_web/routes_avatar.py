"""Serve operator-installed ZEN runtimes; never vendor SDKs or model weights."""

from pathlib import Path
import os

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse

from .app import app
from .routes_api import _request_identity

PRESETS = (
    ("marine", "全力 マリン"),
    ("hashiro", "全力 ハシロウ"),
    ("kikka", "全力 キッカ"),
)


def _authorize(request: Request):
    try:
        return _request_identity(request)
    except Exception as exc:
        raise HTTPException(401, "authentication required") from exc


def _root():
    value = os.environ.get("UAGAV_ZEN_DIR", str(Path.home() / ".uagav" / "zen")).strip()
    return Path(value).expanduser().resolve() if value else None


def _ready(root, voice):
    return bool(
        root
        and all(
            (root / path).is_file()
            for path in (
                "sdk/dist/index.js",
                "tts/dist/index.js",
                "tts/models/g2p/g2p.json",
                "tts/models/g2p/g2p.bin",
                "tts/cpu/tts-cpu.wasm",
                f"models/{voice}.ztm",
                f"avatars/avatars/{voice}/avatar.json",
            )
        )
    )


@app.get("/api/avatar/config")
async def avatar_config(request: Request):
    _authorize(request)
    root = _root()
    return {
        "presets": [
            {"id": voice, "name": name, "ready": _ready(root, voice)}
            for voice, name in PRESETS
        ]
    }


@app.get("/api/avatar/files/{area}/{asset:path}")
async def avatar_file(request: Request, area: str, asset: str):
    _authorize(request)
    root = _root()
    parts = Path(asset).parts
    allowed = (
        area == "sdk"
        and parts
        and parts[0] in {"dist", "cpu"}
        or area == "tts"
        and parts
        and parts[0] in {"dist", "cpu", "models"}
        or area == "models"
        and asset in {f"{voice}.ztm" for voice, _ in PRESETS}
        or area == "avatars"
        and len(parts) > 2
        and parts[0] == "avatars"
        and parts[1] in {voice for voice, _ in PRESETS}
    )
    if (
        not root
        or not allowed
        or ".." in parts
        or "\\" in asset
        or any(part.startswith(".") for part in parts)
    ):
        raise HTTPException(404, "avatar asset unavailable")
    base = root / area
    path = (base / asset).resolve()
    # resolve() rejects symlink escapes as well as traversal.
    if (
        not path.is_relative_to(base.resolve())
        or not path.is_relative_to(root)
        or not path.is_file()
    ):
        raise HTTPException(404, "avatar asset unavailable")
    if path.suffix not in {
        ".js",
        ".mjs",
        ".wasm",
        ".json",
        ".bin",
        ".ztm",
        ".wgw",
        ".mp4",
        ".webm",
        ".webp",
        ".pack",
        ".wav",
        ".f32",
        ".f16",
        ".lip8",
        ".u8",
    }:
        raise HTTPException(404, "avatar asset unavailable")
    media_type = "text/javascript" if path.suffix in {".js", ".mjs"} else None
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
