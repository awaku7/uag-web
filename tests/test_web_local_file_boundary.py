"""Regression coverage for local-file workdir restrictions."""

import pytest
from fastapi.testclient import TestClient

from uag_web.server import app


def test_local_file_accepts_files_inside_workdir(tmp_path, monkeypatch):
    workdir = tmp_path / "work"
    workdir.mkdir()
    inside = workdir / "notes.txt"
    inside.write_text("allowed", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("private", encoding="utf-8")
    monkeypatch.chdir(workdir)

    with TestClient(app) as client:
        relative = client.get("/local-file", params={"path": "notes.txt"})
        assert relative.status_code == 200
        assert relative.text == "allowed"

        absolute = client.get("/local-file", params={"path": str(inside)})
        assert absolute.status_code == 200
        assert absolute.text == "allowed"

        denied = client.get("/local-file", params={"path": str(outside)})
        assert denied.status_code == 403
        assert "private" not in denied.text


def test_local_file_rejects_symlinks_outside_workdir(tmp_path, monkeypatch):
    workdir = tmp_path / "work"
    workdir.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("private", encoding="utf-8")
    (workdir / "public.txt").write_text("allowed", encoding="utf-8")

    try:
        (workdir / "external").symlink_to(outside, target_is_directory=True)
        (workdir / "internal.txt").symlink_to(workdir / "public.txt")
    except (NotImplementedError, OSError):
        pytest.skip("symlinks are unavailable on this platform")

    monkeypatch.chdir(workdir)
    with TestClient(app) as client:
        denied = client.get("/local-file", params={"path": "external/secret.txt"})
        assert denied.status_code == 403
        assert "private" not in denied.text

        allowed = client.get("/local-file", params={"path": "internal.txt"})
        assert allowed.status_code == 200
        assert allowed.text == "allowed"
