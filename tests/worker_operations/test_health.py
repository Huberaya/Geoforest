"""No app import, cloud, DB, privileged command or business fixture."""

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/evaluate-worker-health.py"
SPEC = importlib.util.spec_from_file_location("health", SCRIPT)
HEALTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HEALTH)


@pytest.fixture
def sample():
    return dict.fromkeys(HEALTH.COUNTERS, 0) | {
        "schema_version": 1,
        "collected_at_epoch": 1000000,
        "window_seconds": 300,
        "timer_active": True,
        "service_state": "inactive",
        "engine_version": "1.4.6",
        "signature_set_verified": True,
        "sandbox_probe_ok": True,
    }


def report(sample):
    return HEALTH.evaluate(sample, now=1000000)


def test_inactive_oneshot_is_normal_but_never_production(sample):
    result = report(sample)
    assert result["status"] == "HEALTHY_SAMPLE"
    assert result["production_authorized"] is False
    assert result["notification_sent"] is False


@pytest.mark.parametrize(
    "key,value,code",
    [
        ("timer_active", False, "TIMER_NOT_ACTIVE"),
        ("last_activation_age_seconds", 331, "ACTIVATION_OVERDUE"),
        ("service_state", "failed", "SERVICE_FAILED"),
        ("engine_version", "unapproved", "ENGINE_NOT_APPROVED"),
        ("signature_set_verified", False, "SIGNATURE_SET_UNVERIFIED"),
        ("daily_signature_age_seconds", 259201, "SIGNATURES_EXPIRED"),
        ("expired_leases", 1, "LEASES_EXPIRED"),
        ("failed_jobs", 1, "ATTEMPTS_EXHAUSTED"),
        ("scan_unavailable_last_300s", 1, "SCAN_UNAVAILABLE"),
        ("completion_refused_last_300s", 1, "COMPLETION_REFUSED"),
        ("sandbox_probe_ok", False, "SANDBOX_PROBE_REQUIRED"),
        ("last_sandbox_probe_age_seconds", 86401, "SANDBOX_PROBE_REQUIRED"),
        ("last_notification_ack_age_seconds", 86401, "ALERT_CHANNEL_UNCONFIRMED"),
    ],
)
def test_critical(sample, key, value, code):
    sample[key] = value
    assert report(sample)["status"] == "CRITICAL"
    assert code in report(sample)["codes"]


def test_running_budget(sample):
    sample.update(service_state="activating", active_age_seconds=281)
    assert "RUN_EXCEEDS_BUDGET" in report(sample)["codes"]


@pytest.mark.parametrize(
    "age,expected",
    [
        (172799, "HEALTHY_SAMPLE"),
        (172800, "WARNING"),
        (259200, "WARNING"),
        (259201, "CRITICAL"),
    ],
)
def test_signature_boundaries(sample, age, expected):
    sample["daily_signature_age_seconds"] = age
    assert report(sample)["status"] == expected


def test_queue_delay_and_priority(sample):
    sample.update(queued_jobs=1, oldest_queued_age_seconds=901)
    assert report(sample)["status"] == "WARNING"
    sample["failed_jobs"] = 1
    assert report(sample)["codes"] == ["ATTEMPTS_EXHAUSTED", "QUEUE_DELAY"]


@pytest.mark.parametrize(
    "change",
    [
        {"queued_jobs": True},
        {"failed_jobs": -1},
        {"expired_leases": 1.5},
        {"queued_jobs": None},
        {"timer_active": 1},
        {"window_seconds": 60},
        {"schema_version": 2},
        {"engine_version": []},
        {"service_state": "unknown"},
        {"oldest_queued_age_seconds": 1},
        {"active_age_seconds": 1},
        {"secret": "DO_NOT_LOG"},
        {"queued_jobs": 2**54},
    ],
)
def test_malformed_and_inconsistent_unknown(sample, change):
    sample.update(change)
    assert report(sample)["status"] == "UNKNOWN"
    assert "DO_NOT_LOG" not in json.dumps(report(sample))


@pytest.mark.parametrize(
    "delta,expected",
    [(0, "HEALTHY_SAMPLE"), (90, "HEALTHY_SAMPLE"), (91, "UNKNOWN"), (-1, "UNKNOWN")],
)
def test_freshness(sample, delta, expected):
    sample["collected_at_epoch"] -= delta
    assert report(sample)["status"] == expected


def test_missing_fields_unknown(sample):
    for key in list(sample):
        altered = sample.copy()
        del altered[key]
        assert report(altered)["status"] == "UNKNOWN"


@pytest.mark.parametrize(
    "kind",
    ["invalid", "duplicate", "oversize", "symlink", "fifo", "missing", "directory"],
)
def test_cli_input_refused_without_secret_leak(tmp_path, kind):
    path = tmp_path / "SECRET_PATH"
    if kind == "invalid":
        path.write_text("SECRET_CONTENT")
    elif kind == "duplicate":
        path.write_text('{"secret":1,"secret":2}')
    elif kind == "oversize":
        path.write_text("x" * (HEALTH.MAX_BYTES + 1))
    elif kind == "symlink":
        path.symlink_to(tmp_path / "missing")
    elif kind == "fifo":
        os.mkfifo(path)
    elif kind == "directory":
        path.mkdir()
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 2 and result.stderr == ""
    assert json.loads(result.stdout)["status"] == "UNKNOWN"
    assert "SECRET" not in result.stdout


@pytest.mark.parametrize(
    "change,expected",
    [
        ({}, 0),
        ({"scan_unavailable_last_300s": 1}, 1),
        ({"daily_signature_age_seconds": 172800}, 1),
    ],
)
def test_cli_exit_codes(tmp_path, sample, change, expected):
    sample.update(change, collected_at_epoch=int(time.time()))
    path = tmp_path / "sample.json"
    path.write_text(json.dumps(sample))
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == expected and result.stderr == ""


def test_antivirus_policy_matches_runtime():
    # AST constants only; no import of runtime/dependencies or database fixtures.
    import ast

    module = ast.parse((ROOT / "backend/app/documents/scanner.py").read_text())
    assignments = {
        node.targets[0].id: node.value
        for node in module.body
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
    }
    assert ast.literal_eval(assignments["APPROVED_VERSION"]) == HEALTH.APPROVED_ENGINE
    age = assignments["MAX_SIGNATURE_AGE"]
    assert isinstance(age, ast.BinOp) and isinstance(age.op, ast.Mult)
    assert (
        ast.literal_eval(age.left) * ast.literal_eval(age.right)
        == HEALTH.MAX_SIGNATURE_AGE
    )
