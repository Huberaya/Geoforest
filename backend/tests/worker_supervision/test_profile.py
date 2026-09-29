"""Offline profile contracts. No systemd, network, credentials or database calls."""

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def load(name):
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), ROOT / "scripts" / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


AUDIT = load("audit-document-worker-profile")
PROBE = load("qualify-worker-systemd")


@pytest.fixture
def profile(tmp_path):
    path = tmp_path / "profile"
    shutil.copytree(ROOT / "infra/document-worker", path)
    return path


def test_profile_success_never_authorizes_production(profile):
    result = AUDIT.audit(profile)
    assert result["candidate_profile_valid"] is True
    assert result["production_authorized"] is False
    assert result["host_isolation_verified"] is False
    assert result["antivirus_qualified"] is False


@pytest.mark.parametrize(
    "before,after",
    [
        ("User=geoforest-worker", "User=root"),
        ("Group=geoforest-worker", "Group=root"),
        ("NoNewPrivileges=yes", "NoNewPrivileges=no"),
        ("KillMode=control-group", "KillMode=process"),
        ("SendSIGKILL=yes", "SendSIGKILL=no"),
        ("TimeoutStartSec=270s", "TimeoutStartSec=infinity"),
        ("Restart=no", "Restart=always"),
        ("MemoryMax=3G", "MemoryMax=infinity"),
        ("TasksMax=32", "TasksMax=infinity"),
        ("IPAddressDeny=any", "IPAddressDeny="),
        ("PrivateTmp=no", "PrivateTmp=yes"),
        ("size=256M", "size=32G"),
        ("ProtectSystem=strict", "ProtectSystem=no"),
        ("ProtectHome=yes", "ProtectHome=no"),
        ("--once", "--unsafe"),
        ("Wants=network-online.target", "Wants=unreviewed.service"),
        ("ConditionPathExists=/etc/geoforest/document-worker.qualified", ""),
    ],
)
def test_weakened_service_refused(profile, before, after):
    path = profile / "geoforest-document-worker.service"
    path.write_text(path.read_text().replace(before, after))
    assert not AUDIT.audit(profile)["candidate_profile_valid"]


@pytest.mark.parametrize(
    "addition",
    [
        "\nExecStartPost=/usr/bin/true\n",
        "\nExecStart=secret-token\n",
        "\n[DEFAULT]\nUser=root\n",
        "\n[Unknown]\nValue=secret-token\n",
    ],
)
def test_extra_directives_duplicate_and_inheritance_refused(profile, addition):
    path = profile / "geoforest-document-worker.service"
    path.write_text(path.read_text() + addition)
    result = AUDIT.audit(profile)
    assert not result["candidate_profile_valid"]
    assert "secret-token" not in json.dumps(result)


@pytest.mark.parametrize(
    "before,after",
    [
        ("OnUnitInactiveSec=30s", "OnUnitInactiveSec=0s"),
        ("Unit=geoforest-document-worker.service", "Unit=other.service"),
        ("Persistent=no", "Persistent=yes"),
    ],
)
def test_timer_changes_require_review(profile, before, after):
    path = profile / "geoforest-document-worker.timer"
    path.write_text(path.read_text().replace(before, after))
    assert not AUDIT.audit(profile)["candidate_profile_valid"]


@pytest.mark.parametrize(
    "addition",
    [
        "\nCLERK_SECRET_KEY=secret-token\n",
        "\nDOCUMENT_S3_SECRET_KEY=secret-token\n",
        "\nDATABASE_URL=secret-token\n",
    ],
)
def test_template_rejects_extra_credentials_and_duplicates(profile, addition):
    path = profile / "worker.env.example"
    path.write_text(path.read_text() + addition)
    result = AUDIT.audit(profile)
    assert not result["candidate_profile_valid"]
    assert "secret-token" not in json.dumps(result)


@pytest.mark.parametrize("kind", ["missing", "symlink", "oversized", "invalid_utf8"])
def test_invalid_files_refused(profile, kind):
    path = profile / "worker.env.example"
    if kind == "missing":
        path.unlink()
    elif kind == "symlink":
        contents = path.read_text()
        path.unlink()
        target = profile / "other"
        target.write_text(contents)
        path.symlink_to(target)
    elif kind == "oversized":
        path.write_text("x" * 16385)
    else:
        path.write_bytes(b"\xff")
    assert not AUDIT.audit(profile)["candidate_profile_valid"]


def test_cli_is_offline(profile, monkeypatch, capsys):
    def forbidden(*a, **kw):
        raise AssertionError("PROCESS_FORBIDDEN")

    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(sys, "argv", ["audit", "--directory", str(profile)])
    assert AUDIT.main() == 0
    assert json.loads(capsys.readouterr().out)["production_authorized"] is False


def test_cleanup_runs_even_if_systemd_client_times_out(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        if "systemd-run" in command:
            raise subprocess.TimeoutExpired("synthetic", 30)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(PROBE.subprocess, "run", fake_run)
    with pytest.raises(subprocess.TimeoutExpired):
        PROBE.probe("synthetic")
    assert len(calls) == 2
    assert "systemctl" in calls[1] and "stop" in calls[1]
    name = next(arg.split("=", 1)[1] for arg in calls[0] if arg.startswith("--unit="))
    assert calls[1][-1] == name + ".service"
    assert name.startswith("geoforest-synthetic-")
    assert not any("EnvironmentFile=" in arg for arg in calls[0])
    mounts = [
        arg for arg in calls[0] if arg.startswith("--property=TemporaryFileSystem=")
    ]
    assert len(mounts) == 2
    assert all(" " not in arg for arg in mounts)
    assert "--property=User=nobody" in calls[0]
    assert "--property=DynamicUser=no" in calls[0]


def test_no_opt_in_no_system_units(monkeypatch):
    def forbidden(*a, **kw):
        raise AssertionError("PROCESS_FORBIDDEN")

    monkeypatch.setattr(PROBE.subprocess, "run", forbidden)
    monkeypatch.setattr(sys, "argv", ["probe"])
    with pytest.raises(SystemExit) as exc:
        PROBE.main()
    assert exc.value.code == 2


def test_lifetime_below_existing_lease_and_no_restart_loop():
    service = AUDIT.SERVICE["Service"]
    assert (
        int(service["TimeoutStartSec"][:-1]) + int(service["TimeoutStopSec"][:-1]) < 300
    )
    assert service["Type"] == "oneshot"
    assert service["Restart"] == "no"
    assert AUDIT.TIMER["Timer"]["OnUnitInactiveSec"] == "30s"
