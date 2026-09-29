"""Offline aggregate health evaluator; no collection, notification or activation.

Input is operator-supplied evidence, NOT trusted attestation. Never reads SQL,
credentials, documents or systemd. A healthy sample cannot authorize production.
"""

import argparse
import json
import math
import os
import stat
import time

MAX_BYTES = 8192
APPROVED_ENGINE = "1.4.6"
MAX_SIGNATURE_AGE = 72 * 3600
COUNTERS = {
    "last_activation_age_seconds",
    "active_age_seconds",
    "daily_signature_age_seconds",
    "oldest_queued_age_seconds",
    "queued_jobs",
    "expired_leases",
    "failed_jobs",
    "scan_unavailable_last_300s",
    "completion_refused_last_300s",
    "last_notification_ack_age_seconds",
    "last_sandbox_probe_age_seconds",
}
KEYS = COUNTERS | {
    "schema_version",
    "collected_at_epoch",
    "window_seconds",
    "timer_active",
    "service_state",
    "engine_version",
    "signature_set_verified",
    "sandbox_probe_ok",
}


def evaluate(sample, *, now):
    def result(status, codes):
        return {
            "schema_version": 1,
            "status": status,
            "codes": codes,
            "production_authorized": False,
            "notification_sent": False,
            "scope": "supplied_aggregate_snapshot_only",
        }

    # Strict types, including rejection of bool-as-int and unknown fields.
    if not isinstance(sample, dict) or set(sample) != KEYS:
        return result("UNKNOWN", ["INVALID_SNAPSHOT"])
    integers = COUNTERS | {"schema_version", "collected_at_epoch", "window_seconds"}
    if any(
        type(sample[k]) is not int or not 0 <= sample[k] <= 2**53 - 1 for k in integers
    ):
        return result("UNKNOWN", ["INVALID_SNAPSHOT"])
    if (
        type(now) not in (int, float)
        or not math.isfinite(now)
        or sample["schema_version"] != 1
        or sample["window_seconds"] != 300
        or any(
            type(sample[k]) is not bool
            for k in ("timer_active", "signature_set_verified", "sandbox_probe_ok")
        )
        or sample["service_state"] not in ("inactive", "activating", "failed")
        or type(sample["engine_version"]) is not str
    ):
        return result("UNKNOWN", ["INVALID_SNAPSHOT"])
    if not 0 <= now - sample["collected_at_epoch"] <= 90:
        return result("UNKNOWN", ["STALE_OR_FUTURE_SNAPSHOT"])
    if (sample["queued_jobs"] == 0 and sample["oldest_queued_age_seconds"] != 0) or (
        sample["service_state"] != "activating" and sample["active_age_seconds"] != 0
    ):
        return result("UNKNOWN", ["INCONSISTENT_SNAPSHOT"])

    critical, warnings = [], []
    checks = [
        (not sample["timer_active"], "TIMER_NOT_ACTIVE"),
        (sample["last_activation_age_seconds"] > 330, "ACTIVATION_OVERDUE"),
        (sample["service_state"] == "failed", "SERVICE_FAILED"),
        (sample["active_age_seconds"] > 280, "RUN_EXCEEDS_BUDGET"),
        (sample["engine_version"] != APPROVED_ENGINE, "ENGINE_NOT_APPROVED"),
        (not sample["signature_set_verified"], "SIGNATURE_SET_UNVERIFIED"),
        (
            sample["daily_signature_age_seconds"] > MAX_SIGNATURE_AGE,
            "SIGNATURES_EXPIRED",
        ),
        (sample["expired_leases"] > 0, "LEASES_EXPIRED"),
        (sample["failed_jobs"] > 0, "ATTEMPTS_EXHAUSTED"),
        (sample["scan_unavailable_last_300s"] > 0, "SCAN_UNAVAILABLE"),
        (sample["completion_refused_last_300s"] > 0, "COMPLETION_REFUSED"),
        (
            not sample["sandbox_probe_ok"]
            or sample["last_sandbox_probe_age_seconds"] > 86400,
            "SANDBOX_PROBE_REQUIRED",
        ),
        (
            sample["last_notification_ack_age_seconds"] > 86400,
            "ALERT_CHANNEL_UNCONFIRMED",
        ),
    ]
    critical.extend(code for failed, code in checks if failed)
    if 48 * 3600 <= sample["daily_signature_age_seconds"] <= MAX_SIGNATURE_AGE:
        warnings.append("SIGNATURES_AGING")
    if sample["oldest_queued_age_seconds"] > 900:
        warnings.append("QUEUE_DELAY")
    return result(
        "CRITICAL" if critical else "WARNING" if warnings else "HEALTHY_SAMPLE",
        critical + warnings,
    )


def unique_object(pairs):
    output = {}
    for key, value in pairs:
        if key in output:
            raise ValueError("duplicate")
        output[key] = value
    return output


def read_snapshot(path):
    # No symlinks, devices or FIFO blocking; bound memory before decoding.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("regular file required")
        data = source.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("oversize")
    return json.loads(data, object_pairs_hook=unique_object)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "snapshot", help="Local aggregate JSON; never a credentials file"
    )
    args = parser.parse_args()
    try:
        report = evaluate(read_snapshot(args.snapshot), now=time.time())
    except (OSError, ValueError, TypeError, RecursionError):
        report = evaluate(None, now=time.time())
    # Never emit input values, paths, exception text, IDs or engine output.
    print(json.dumps(report, sort_keys=True))
    return {"HEALTHY_SAMPLE": 0, "WARNING": 1, "CRITICAL": 1, "UNKNOWN": 2}[
        report["status"]
    ]


if __name__ == "__main__":
    raise SystemExit(main())
