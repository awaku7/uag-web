"""Install official, unmodified ZEN resources outside this repository for local use."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.request import Request, urlopen

SOURCES = {
    "sdk": ("zen-lipsync", "ebecdf09261ac137487d9b08d42e8aaeddb2ae98"),
    "tts": ("zen-tts", "eda96c40f7d811406e1ff908120fa19b787dc53d"),
    "avatars": ("zen-lipsync-avatars", "577fb04aba6e3bf006b39670cf4fd6884ae62266"),
}
MODELS = {
    "marine": "3fce81efbbb598b546429c6e53955a6d18fdbc9bca72afd029baf2eac06678a0",
    "hashiro": "ad6557b1d5e427c3466203a6b450530b70480b4a825129c734322de39d269230",
    "kikka": "1875058d12bf15815638542e8b1178af56f63ca29120b5c7f5b97d38e4cc5c17",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "directory",
        nargs="?",
        default=os.environ.get("UAGAV_ZEN_DIR", str(Path.home() / ".uagav" / "zen")),
    )
    args = parser.parse_args()
    root = Path(args.directory).expanduser().resolve()
    repository = Path(__file__).resolve().parents[1]
    if root.is_relative_to(repository):
        parser.error(
            "Install resources outside the repository to prevent redistribution."
        )
    npm = shutil.which("npm")
    if not npm or not shutil.which("git"):
        parser.error(
            "Git and Node.js/npm are required (upstream recommends Node 26.12.1+)."
        )
    print(
        "Installing ZEN-LipSync / ZEN-TTS 1.1.0 for local use only; no redistribution or modification.",
        flush=True,
    )
    print(
        "Terms: https://github.com/zenryokukikai/zen-lipsync/blob/v1.1.0/LICENSE.md",
        flush=True,
    )
    print(
        "Terms: https://github.com/zenryokukikai/zen-tts/blob/v1.1.0/LICENSE.md",
        flush=True,
    )
    root.mkdir(parents=True, exist_ok=True)
    for name, (repo, commit) in SOURCES.items():
        target = root / name
        if not target.exists():
            subprocess.run(
                [
                    "git",
                    "clone",
                    "--depth",
                    "1",
                    "--branch",
                    "v1.1.0",
                    f"https://github.com/zenryokukikai/{repo}.git",
                    str(target),
                ],
                check=True,
            )
        actual = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=target, text=True
        ).strip()
        if actual != commit:
            raise RuntimeError(
                f"Unexpected revision in {target}; use a fresh directory."
            )
        dirty = subprocess.check_output(
            ["git", "diff", "HEAD", "--"], cwd=target, text=True
        )
        if dirty:
            raise RuntimeError(
                f"Modified upstream resources in {target}; use a fresh directory."
            )
        if name != "avatars":
            subprocess.run(
                [
                    npm,
                    "install",
                    "--ignore-scripts",
                    "--legacy-peer-deps",
                    "--no-package-lock",
                ],
                cwd=target,
                check=True,
            )
            subprocess.run([npm, "run", "build"], cwd=target, check=True)
    models = root / "models"
    models.mkdir(exist_ok=True)
    for voice, expected in MODELS.items():
        target = models / f"{voice}.ztm"
        if (
            target.exists()
            and hashlib.sha256(target.read_bytes()).hexdigest() == expected
        ):
            continue
        # Publish only verified complete downloads; do not leave partial models ready.
        with tempfile.NamedTemporaryFile(dir=models, delete=False) as output:
            temporary = Path(output.name)
            try:
                with urlopen(
                    Request(
                        f"https://tts-models.zenryoku.work/v1.1.0/{voice}.ztm",
                        headers={"User-Agent": "uagav/0.1"},
                    ),
                    timeout=60,
                ) as source:
                    shutil.copyfileobj(source, output)
                output.close()
                if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
                    raise RuntimeError(f"Model checksum mismatch: {voice}")
                temporary.replace(target)
            finally:
                output.close()  # Windows cannot unlink an open temporary file.
                temporary.unlink(missing_ok=True)
    print(f"Ready: {root}. Start uagav and open Voice & avatar.")


if __name__ == "__main__":
    main()
