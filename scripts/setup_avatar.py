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
    "sdk": ("zen-lipsync", "v1.1.0", "ebecdf09261ac137487d9b08d42e8aaeddb2ae98"),
    "tts": ("zen-tts", "v1.2.0", "34fc2288e682bc87a6fccaf8d158c5c0647adccc"),
    "avatars": (
        "zen-lipsync-avatars",
        "v1.1.0",
        "577fb04aba6e3bf006b39670cf4fd6884ae62266",
    ),
}
PREVIOUS_TTS_COMMIT = "eda96c40f7d811406e1ff908120fa19b787dc53d"
MODELS = {
    "marine": "c5f5ff04d43c3a742790856f4639f6d801e5c9a951a4f11ae800775fa0ed11d5",
    "hashiro": "6b85821342690767c0156a3f2c390f05589ae91291c24cca545880f8d2c5b348",
    "kai": "c6f741f7269736de3abb063215f1f9a032aa5fc06a4e576f38accb407b04fdc4",
    "kikka": "277cbd80a4fbff93988ff3b382fc29c8de98749a2c1cb1a8d6e0cc9e2fc869c8",
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
        "Installing ZEN-LipSync 1.1.0 / ZEN-TTS 1.2.0 for local use only; no redistribution or modification.",
        flush=True,
    )
    print(
        "Terms: https://github.com/zenryokukikai/zen-lipsync/blob/v1.1.0/LICENSE.md",
        flush=True,
    )
    print(
        "Terms: https://github.com/zenryokukikai/zen-tts/blob/v1.2.0/LICENSE.md",
        flush=True,
    )
    root.mkdir(parents=True, exist_ok=True)
    for name, (repo, tag, commit) in SOURCES.items():
        target = root / name
        if not target.exists():
            subprocess.run(
                [
                    "git",
                    "clone",
                    "--depth",
                    "1",
                    "--branch",
                    tag,
                    f"https://github.com/zenryokukikai/{repo}.git",
                    str(target),
                ],
                check=True,
            )
        actual = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=target, text=True
        ).strip()
        dirty = subprocess.check_output(
            ["git", "diff", "HEAD", "--"], cwd=target, text=True
        )
        if dirty:
            raise RuntimeError(
                f"Modified upstream resources in {target}; use a fresh directory."
            )
        if actual != commit:
            # Upgrade only the known, unmodified official TTS v1.1.0 checkout.
            if name != "tts" or actual != PREVIOUS_TTS_COMMIT:
                raise RuntimeError(
                    f"Unexpected revision in {target}; use a fresh directory."
                )
            subprocess.run(
                ["git", "fetch", "--depth", "1", "origin", f"refs/tags/{tag}"],
                cwd=target,
                check=True,
            )
            fetched = subprocess.check_output(
                ["git", "rev-parse", "FETCH_HEAD^{commit}"], cwd=target, text=True
            ).strip()
            if fetched != commit:
                raise RuntimeError(f"Unexpected upstream revision in {target}.")
            subprocess.run(
                ["git", "checkout", "--detach", commit], cwd=target, check=True
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
                        f"https://tts-models.zenryoku.work/v1.2.0/{voice}.ztm",
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
