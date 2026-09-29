"""Explicit synthetic local systemd probes. No app, DB, S3, signatures or paid service."""

import argparse
import importlib.util
import json
import os
import socket
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "profile_audit", ROOT / "scripts/audit-document-worker-profile.py"
)
PROFILE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROFILE)

ISOLATION = r"""
import errno, json, os, pathlib, resource, stat
assert os.getuid() != 0
status = dict(line.split(':', 1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert int(status['CapEff'].strip(), 16) == 0
assert status['NoNewPrivs'].strip() == '1'
assert resource.getrlimit(resource.RLIMIT_NOFILE) == (256, 256)
assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
try:
    os.listdir('/home')
    raise AssertionError('HOME_ACCESSIBLE')
except PermissionError:
    pass
try:
    p = pathlib.Path('/usr/local/geoforest-synthetic-probe')
    p.write_text('synthetic')
    p.unlink()
    raise AssertionError('SYSTEM_WRITABLE')
except OSError as e:
    assert e.errno in (errno.EROFS, errno.EACCES)
f = pathlib.Path('/tmp/synthetic')
f.write_text('synthetic')
assert stat.S_IMODE(f.stat().st_mode) == 0o600
v = os.statvfs('/tmp')
assert v.f_frsize * v.f_blocks == 256 * 1024**2
assert v.f_flag & os.ST_NOEXEC
w = os.statvfs('/var/tmp')
assert w.f_frsize * w.f_blocks == 32 * 1024**2
assert w.f_flag & os.ST_NOEXEC
f.unlink()
cg = next(line.split(':', 2)[2] for line in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
cgdir = pathlib.Path('/sys/fs/cgroup') / cg.lstrip('/')
expected = {'memory.max': '3221225472', 'memory.swap.max': '0', 'pids.max': '32', 'cpu.max': '200000 100000'}
for name, value in expected.items():
    assert (cgdir / name).read_text().strip() == value, name
print(json.dumps({'isolation_checks': 'PASS', 'cgroup_limits': 'PASS'}))
"""
TIMEOUT = r"""
import json, os, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child = subprocess.Popen([sys.executable, '-I', '-c', 'import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)'], start_new_session=True)
print(json.dumps({'child_pid': child.pid}), flush=True)
time.sleep(60)
"""
# Installation paths, service identity, credentials and qualification marker are
# intentionally NOT taken from production. Only hardening/resource properties.
OMIT = {
    "User",
    "Group",
    "WorkingDirectory",
    "EnvironmentFile",
    "Environment",
    "ExecStart",
    "ExecStartPre",
    "ReadOnlyPaths",
    "InaccessiblePaths",
    "SyslogIdentifier",
    "StandardOutput",
    "StandardError",
}


def probe(code, *, timeout_case=False, network_baseline=False):
    prefix = [] if os.geteuid() == 0 else ["sudo", "-n"]
    name = "geoforest-synthetic-" + uuid.uuid4().hex
    props = {k: v for k, v in PROFILE.SERVICE["Service"].items() if k not in OMIT}
    props.update(DynamicUser="no", User="nobody", Group="nogroup", WorkingDirectory="/")
    if network_baseline:
        props.update(IPAddressDeny="", IPAddressAllow="")
    if timeout_case:
        props.update(TimeoutStartSec="2s", TimeoutStopSec="1s")
    command = prefix + [
        "systemd-run",
        "--wait",
        "--pipe",
        "--collect",
        "--unit=" + name,
    ]
    for key, value in props.items():
        # systemd-run's structured mount property takes one mount per argument,
        # unlike the whitespace-separated list in a unit file.
        values = value.split() if key == "TemporaryFileSystem" else [value]
        command += ["--property=" + key + "=" + item for item in values]
    command += ["/usr/bin/python3", "-I", "-c", code]
    env = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}
    start = time.monotonic()
    try:
        p = subprocess.run(
            command, env=env, capture_output=True, text=True, timeout=30, check=False
        )
        elapsed = time.monotonic() - start
        if not timeout_case:
            good = (
                p.returncode == 0
                and json.loads(p.stdout).get("isolation_checks") == "PASS"
            )
        else:
            child = json.loads(p.stdout)["child_pid"]
            # A zombie cannot execute, but report it explicitly if not yet reaped.
            child_path = Path(f"/proc/{child}/stat")
            state = (
                child_path.read_text().rsplit(")", 1)[1].split()[0]
                if child_path.exists()
                else "ABSENT"
            )
            good = (
                p.returncode != 0
                and "result: timeout" in p.stderr
                and state in {"ABSENT", "Z"}
                and elapsed < 20
            )
        result = {
            "passed": good,
            "exit_code": p.returncode,
            "seconds": round(elapsed, 3),
            "stdout": p.stdout,
            "stderr": p.stderr,
        }
        if timeout_case:
            result["child_state_after_service_exit"] = state
        return result
    finally:
        # Even a failed/timeout client must not leave its synthetic system unit alive.
        subprocess.run(
            prefix + ["systemctl", "stop", name + ".service"],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )


def network_probes(checks):
    # UDP connect selects a local route without sending data. TCP probes target
    # this machine only, never a provider or remote business endpoint.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect(("192.0.2.1", 9))
        address = route.getsockname()[0]
    if address.startswith("127."):
        raise ValueError("Non-loopback local peer required")
    with socket.socket() as peer:
        peer.bind((address, 0))
        peer.listen(4)
        target = repr(peer.getsockname())
        baseline = (
            "import socket,json; s=socket.socket(); s.settimeout(2); s.connect("
            + target
            + "); s.close(); print(json.dumps({'isolation_checks':'PASS'}))"
        )
        checks["local_network_control"] = probe(baseline, network_baseline=True)
        if not checks["local_network_control"]["passed"]:
            raise ValueError("Baseline must succeed before interpreting denial")
        peer.settimeout(2)
        connection, _ = peer.accept()
        connection.close()
        denied = """import socket,json,errno
with socket.socket() as s:
    s.settimeout(2)
    try:
        s.connect(TARGET)
        raise AssertionError('NETWORK_FILTER_NOT_ENFORCED')
    except OSError as e:
        assert isinstance(e, TimeoutError) or e.errno in (errno.EPERM, errno.EACCES)
print(json.dumps({'isolation_checks':'PASS'}))
""".replace("TARGET", target)
        checks["local_network_denied"] = probe(denied)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-local-synthetic", action="store_true", required=True)
    parser.parse_args()
    result = {
        "scope": "LOCAL_SYNTHETIC_SYSTEMD",
        "production_authorized": False,
        "antivirus_qualified": False,
        "profile_overrides": sorted(OMIT),
        "synthetic_changes": [
            "User=nobody, Group=nogroup, DynamicUser=no (synthetic identity only)",
            "WorkingDirectory=/",
            "timeout probe only: 2s + 1s",
            "network positive control only: IPAddressDeny and IPAddressAllow empty",
        ],
        "checks": {},
    }
    try:
        if not PROFILE.audit(ROOT / "infra/document-worker")["candidate_profile_valid"]:
            raise ValueError("Profile changed")
        result["checks"]["isolation"] = probe(ISOLATION)
        result["checks"]["process_tree_timeout"] = probe(TIMEOUT, timeout_case=True)
        network_probes(result["checks"])
        result["passed"] = all(x["passed"] for x in result["checks"].values())
    except Exception:
        result.update(passed=False, error="SYNTHETIC_QUALIFICATION_INCOMPLETE")
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
