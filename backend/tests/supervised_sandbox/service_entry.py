"""Fixture entrypoints only. Production starts the real worker module directly."""

import json
import os
import signal
import socket
import tempfile
import time
from pathlib import Path

from app.documents import worker
from app.documents.sandbox import DocumentSandbox

mode = os.environ["SYNTHETIC_SERVICE_MODE"]
if mode == "probe":
    with tempfile.TemporaryDirectory() as tmp, socket.socket() as listener:
        sentinel = Path(tmp) / "synthetic-secret"
        sentinel.write_text("SYNTHETIC_PARENT_SECRET")
        os.environ["WORKER_SECRET_SENTINEL"] = "SYNTHETIC_PARENT_SECRET"
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        with socket.create_connection(listener.getsockname()):
            connection, _ = listener.accept()
            connection.close()
        payload = {
            "sentinel_path": str(sentinel),
            "sentinel_value": "SYNTHETIC_PARENT_SECRET",
            "parent_pid_namespace": os.readlink("/proc/self/ns/pid"),
            "parent_net_namespace": os.readlink("/proc/self/ns/net"),
            "port": listener.getsockname()[1],
        }
        # Non-root and NNP/capability barriers compensate the parent /proc and
        # openat2-compatible settings; this does not claim identical defenses.
        status = dict(
            line.split(":", 1)
            for line in Path("/proc/self/status").read_text().splitlines()
            if ":" in line
        )
        assert (
            os.getuid() != 0
            and int(status["CapEff"].strip(), 16) == 0
            and status["NoNewPrivs"].strip() == "1"
        )
        for target in ("/proc/sys/kernel/hostname",):
            try:
                fd = os.open(target, os.O_WRONLY)
            except PermissionError:
                pass
            else:
                os.close(fd)
                raise AssertionError("KERNEL_WRITE_ACCESSIBLE")
        try:
            fd = os.open("/proc/kmsg", os.O_RDONLY | os.O_NONBLOCK)
        except PermissionError:
            pass
        else:
            os.close(fd)
            raise AssertionError("KERNEL_LOG_ACCESSIBLE")
        assert os.statvfs("/tmp").f_flag & os.ST_NOSUID
        assert os.statvfs("/tmp").f_flag & os.ST_NOEXEC
        result = DocumentSandbox().run("probe", json.dumps(payload).encode())
        print(
            json.dumps(
                {
                    "error": result.error,
                    "returncode": result.returncode,
                    "output": result.output.decode(),
                }
            )
        )
        raise SystemExit(0 if result.returncode == 0 and not result.error else 1)
elif mode == "crash-after-object":

    def crash(*a, **k):
        os.kill(os.getpid(), signal.SIGKILL)

    worker.SandboxScanner.scan = crash
elif mode == "hang-after-object":

    def hang(*a, **k):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        time.sleep(120)

    worker.SandboxScanner.scan = hang
else:
    raise SystemExit("Invalid synthetic fixture mode")
raise SystemExit(worker.main())
