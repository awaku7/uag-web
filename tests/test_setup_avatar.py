"""Regression tests for pinned ZEN SDK checkouts and safe TTS upgrades."""

from unittest.mock import Mock, call

import pytest

from scripts import setup_avatar


def test_version_pins_match_published_upstream_tags():
    assert setup_avatar.SOURCES["sdk"][1] == "v1.1.0"
    assert setup_avatar.SOURCES["tts"] == (
        "zen-tts",
        "v1.2.0",
        "34fc2288e682bc87a6fccaf8d158c5c0647adccc",
    )
    assert setup_avatar.SOURCES["avatars"][1] == "v1.1.0"
    assert len(setup_avatar.MODELS) == 4


def test_existing_clean_tts_1_1_is_upgraded_to_pinned_1_2(monkeypatch, tmp_path):
    target = tmp_path / "tts"
    target.mkdir()
    repo, tag, commit = setup_avatar.SOURCES["tts"]
    run = Mock()
    read = Mock(
        side_effect=[f"{setup_avatar.PREVIOUS_TTS_COMMIT}\n", "", f"{commit}\n"]
    )
    monkeypatch.setattr(setup_avatar.subprocess, "run", run)
    monkeypatch.setattr(setup_avatar.subprocess, "check_output", read)

    setup_avatar.ensure_source("tts", repo, tag, commit, target)

    assert run.call_args_list == [
        call(
            ["git", "fetch", "--depth", "1", "origin", "refs/tags/v1.2.0"],
            cwd=target,
            check=True,
        ),
        call(["git", "checkout", "--detach", commit], cwd=target, check=True),
    ]


def test_existing_current_revision_needs_no_git_changes(monkeypatch, tmp_path):
    target = tmp_path / "tts"
    target.mkdir()
    repo, tag, commit = setup_avatar.SOURCES["tts"]
    run = Mock()
    read = Mock(side_effect=[f"{commit}\n", ""])
    monkeypatch.setattr(setup_avatar.subprocess, "run", run)
    monkeypatch.setattr(setup_avatar.subprocess, "check_output", read)

    setup_avatar.ensure_source("tts", repo, tag, commit, target)

    run.assert_not_called()


@pytest.mark.parametrize(
    ("name", "revision", "dirty"),
    [
        ("tts", setup_avatar.PREVIOUS_TTS_COMMIT, "modified files"),
        ("tts", "unknown-commit", ""),
        ("sdk", setup_avatar.PREVIOUS_TTS_COMMIT, ""),
    ],
)
def test_untrusted_or_modified_checkouts_are_not_overwritten(
    monkeypatch, tmp_path, name, revision, dirty
):
    target = tmp_path / name
    target.mkdir()
    repo, tag, commit = setup_avatar.SOURCES[name]
    run = Mock()
    read = Mock(side_effect=[f"{revision}\n", dirty])
    monkeypatch.setattr(setup_avatar.subprocess, "run", run)
    monkeypatch.setattr(setup_avatar.subprocess, "check_output", read)

    with pytest.raises(RuntimeError, match="Modified|Unexpected"):
        setup_avatar.ensure_source(name, repo, tag, commit, target)

    run.assert_not_called()


def test_new_checkout_uses_upstream_tag_and_verifies_commit(monkeypatch, tmp_path):
    target = tmp_path / "tts"
    repo, tag, commit = setup_avatar.SOURCES["tts"]
    run = Mock()
    read = Mock(side_effect=[f"{commit}\n", ""])
    monkeypatch.setattr(setup_avatar.subprocess, "run", run)
    monkeypatch.setattr(setup_avatar.subprocess, "check_output", read)

    setup_avatar.ensure_source("tts", repo, tag, commit, target)

    run.assert_called_once_with(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            "v1.2.0",
            "https://github.com/zenryokukikai/zen-tts.git",
            str(target),
        ],
        check=True,
    )
