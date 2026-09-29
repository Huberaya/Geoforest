"""Isolated format subprocess, shared by local API and independent worker."""

import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from app.documents.storage import Blob


def validate_format_from_store(storage, blob: Blob, declared_mime):
    with storage.open_verified(blob) as f:
        data = f.read()
    if hashlib.sha256(data).hexdigest() != blob.sha256:
        return None
    env = {
        "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "OPENBLAS_NUM_THREADS": "1",
    }
    with tempfile.TemporaryFile() as output_file:
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.documents.format_worker"],
            stdin=subprocess.PIPE,
            stdout=output_file,
            stderr=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
        try:
            proc.communicate(data, timeout=15)
            output_file.seek(0)
            output = output_file.read(4097)
            if proc.returncode or len(output) > 4096:
                return None
            result = json.loads(output)
            return result if result.get("mime") == declared_mime else None
        except (subprocess.TimeoutExpired, ValueError):
            return None
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()
