"""Synthetic boundary probes. No business documents or host credentials."""

import errno
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

if sys.argv[1] == "timeout-probe":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    subprocess.Popen(
        [
            sys.executable,
            "-I",
            "-S",
            "-c",
            "import os,signal,time;os.setsid();signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)",
        ],
        close_fds=True,
    )
    print(json.dumps({"pid_namespace": os.readlink("/proc/self/ns/pid")}), flush=True)
    time.sleep(60)
else:
    request = json.loads(sys.stdin.buffer.read(4096))
    assert os.getuid() == 65534
    status = dict(
        line.split(":", 1)
        for line in Path("/proc/self/status").read_text().splitlines()
        if ":" in line
    )
    assert int(status["CapEff"].strip(), 16) == 0
    assert status["NoNewPrivs"].strip() == "1"
    for descriptor in Path("/proc/self/fd").iterdir():
        try:
            assert request["sentinel_path"] not in os.readlink(descriptor)
        except FileNotFoundError:
            pass
    assert not any(
        "SECRET" in key or "DATABASE" in key or "TOKEN" in key for key in os.environ
    )
    assert not Path(request["sentinel_path"]).exists()
    assert (
        not Path("/home").exists()
        and not Path("/run").exists()
        and not Path("/etc").exists()
    )
    assert os.readlink("/proc/self/ns/pid") != request["parent_pid_namespace"]
    assert os.readlink("/proc/self/ns/net") != request["parent_net_namespace"]
    parent_env = request["sentinel_value"].encode()
    for p in Path("/proc").glob("[0-9]*/environ"):
        try:
            assert parent_env not in p.read_bytes()
        except PermissionError:
            pass
    for directory in ("/", "/usr"):
        try:
            Path(directory, "sandbox-synthetic-write").write_text("synthetic")
            raise AssertionError("WRITABLE_RUNTIME")
        except OSError as exc:
            assert exc.errno in {errno.EROFS, errno.EACCES}
    temp = Path("/tmp/synthetic")
    temp.write_text("synthetic")
    assert temp.stat().st_mode & 0o777 == 0o600
    temp.unlink()
    stat = os.statvfs("/tmp")
    assert stat.f_frsize * stat.f_blocks == 128 * 1024**2
    with socket.socket() as connection:
        connection.settimeout(1)
        try:
            connection.connect(("127.0.0.1", request["port"]))
            raise AssertionError("HOST_NETWORK_REACHABLE")
        except OSError:
            pass
    nested = subprocess.run(
        ["/usr/bin/unshare", "--user", "--", "/usr/bin/true"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=2,
        check=False,
    )
    assert nested.returncode != 0
    # The host listener was verified by the parent immediately before this probe.
    print(
        json.dumps(
            {
                "boundary": "PASS",
                "private_pid": True,
                "private_network": True,
                "parent_secret_absent": True,
                "temporary_bytes": stat.f_frsize * stat.f_blocks,
            }
        )
    )
