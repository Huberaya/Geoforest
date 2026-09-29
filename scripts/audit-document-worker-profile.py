"""Offline audit of the candidate profile, NOT host or production qualification."""

import argparse
import configparser
import json
from pathlib import Path

SERVICE = {
    "Unit": {
        "Description": "GeoForest document worker (qualification required)",
        "After": "network-online.target",
        "Wants": "network-online.target",
        "ConditionPathExists": "/etc/geoforest/document-worker.qualified",
    },
    "Service": {
        "Environment": "PATH=/usr/bin:/bin LANG=C PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1",
        "SyslogIdentifier": "geoforest-document-worker",
        "Type": "oneshot",
        "User": "geoforest-worker",
        "Group": "geoforest-worker",
        "WorkingDirectory": "/opt/geoforest/backend",
        "EnvironmentFile": "/etc/geoforest/document-worker.env",
        "ExecStartPre": "/usr/bin/test -x /opt/geoforest/.venv/bin/python",
        "ExecStart": "/usr/bin/env -- /opt/geoforest/.venv/bin/python -m app.documents.worker --once",
        "TimeoutStartSec": "270s",
        "TimeoutStopSec": "10s",
        "KillMode": "control-group",
        "KillSignal": "SIGTERM",
        "SendSIGKILL": "yes",
        "Restart": "no",
        "UMask": "0077",
        "NoNewPrivileges": "yes",
        "CapabilityBoundingSet": "",
        "AmbientCapabilities": "",
        "ProtectSystem": "strict",
        "ProtectHome": "yes",
        "PrivateTmp": "no",
        "PrivateDevices": "yes",
        "TemporaryFileSystem": "/tmp:rw,nosuid,nodev,noexec,size=256M,mode=1777 /var/tmp:rw,nosuid,nodev,noexec,size=32M,mode=1777",
        "ReadOnlyPaths": "/var/lib/clamav /opt/clamav",
        "InaccessiblePaths": "-/etc/geoforest/document-worker.env -/opt/geoforest/.env",
        "ProtectKernelTunables": "no",
        "ProtectKernelModules": "yes",
        "ProtectKernelLogs": "no",
        "ProtectControlGroups": "yes",
        "ProtectClock": "yes",
        "ProtectHostname": "no",
        "ProtectProc": "invisible",
        "RestrictSUIDSGID": "no",
        "RestrictRealtime": "yes",
        "RestrictNamespaces": "user mnt pid net ipc uts cgroup",
        "LockPersonality": "yes",
        "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6 AF_NETLINK",
        "IPAddressDeny": "any",
        "IPAddressAllow": "localhost",
        "MemoryMax": "3G",
        "MemorySwapMax": "0",
        "CPUQuota": "200%",
        "TasksMax": "32",
        "LimitNOFILE": "256",
        "LimitCORE": "0",
        "StandardOutput": "journal",
        "StandardError": "journal",
    },
}
TIMER = {
    "Unit": {
        "Description": "GeoForest document worker polling (not enabled by default)"
    },
    "Install": {"WantedBy": "timers.target"},
    "Timer": {
        "OnBootSec": "60s",
        "OnUnitInactiveSec": "30s",
        "RandomizedDelaySec": "5s",
        "AccuracySec": "1s",
        "Unit": "geoforest-document-worker.service",
        "Persistent": "no",
    },
}
ENV = {
    "APP_ENV": "production",
    "DOCUMENT_STORAGE_BACKEND": "s3",
    "DOCUMENT_S3_LOCAL_TEST": "false",
    "DOCUMENT_WORKER_DATABASE_URL": "postgresql+psycopg://REPLACE_USER:REPLACE_PASSWORD@REPLACE_HOST/REPLACE_DB?sslmode=verify-full",
    "DOCUMENT_S3_ENDPOINT": "https://REPLACE_S3_ENDPOINT",
    "DOCUMENT_S3_REGION": "REPLACE_REGION",
    "DOCUMENT_S3_BUCKET": "REPLACE_BUCKET",
    "DOCUMENT_S3_ACCESS_KEY": "REPLACE_ACCESS_KEY",
    "DOCUMENT_S3_SECRET_KEY": "REPLACE_SECRET_KEY",
    "CLAMAV_EXECUTABLE": "/opt/clamav/bin/clamscan",
    "CLAMAV_DATABASE": "/var/lib/clamav",
    "CLAMAV_LIBRARY_PATH": "/opt/clamav/lib",
}


def read_small(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        raise ValueError("Invalid profile file")
    return path.read_text()


def unit_values(content, required):
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    parser.optionxform = str
    parser.read_string(content)
    # No inheritance/extra executable hooks, reset directives or unreviewed overrides.
    if parser.defaults():
        return False
    if set(parser.sections()) != set(required):
        return False
    for section, options in required.items():
        if dict(parser[section]) != options:
            return False
    return True


def environment_template(content):
    values = {}
    for line in content.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        if key in values:
            return False
        values[key] = value
    return values == ENV


def audit(directory):
    result = {
        "scope": "OFFLINE_CANDIDATE_PROFILE_ONLY",
        "production_authorized": False,
        "host_isolation_verified": False,
        "antivirus_qualified": False,
    }
    try:
        checks = {
            "service": unit_values(
                read_small(directory / "geoforest-document-worker.service"), SERVICE
            ),
            "timer": unit_values(
                read_small(directory / "geoforest-document-worker.timer"), TIMER
            ),
            "synthetic_environment": environment_template(
                read_small(directory / "worker.env.example")
            ),
        }
        result.update(checks=checks, candidate_profile_valid=all(checks.values()))
    except Exception:
        result.update(candidate_profile_valid=False, error="PROFILE_UNVERIFIED")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--directory",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "infra/document-worker",
    )
    args = parser.parse_args()
    result = audit(args.directory)
    print(json.dumps(result))
    return 0 if result["candidate_profile_valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
