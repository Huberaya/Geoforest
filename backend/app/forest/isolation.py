"""Parent-side worker control; no detached/background jobs or secret inheritance."""

import json
import os
import signal
import subprocess
import sys
import tempfile
from contextlib import suppress
from pathlib import Path

from app.forest.download import SourceReadError

MAX_OUTPUT = 8 * 1024**2


def isolated_analysis(geometry, *, timeout=100):
    data = json.dumps(geometry, allow_nan=False, separators=(",", ":")).encode()
    if len(data) > 1024 * 1024:
        raise ValueError("WORK_INPUT_LIMIT")
    backend = Path(__file__).resolve().parents[2]
    env = {
        "PYTHONPATH": str(backend),
        "PYTHONUTF8": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "PROJ_NETWORK": "OFF",
    }
    # A regular temporary file is bounded by child RLIMIT_FSIZE. A PIPE could
    # otherwise accumulate unbounded output in parent communicate(). No on-disk
    # named geometry input, no command-line coordinates and no secret env vars.
    with tempfile.TemporaryFile() as output:
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.forest.worker"],
            stdin=subprocess.PIPE,
            stdout=output,
            stderr=subprocess.DEVNULL,
            cwd=backend,
            env=env,
            start_new_session=True,
        )
        try:
            proc.communicate(data, timeout=timeout)
        except subprocess.TimeoutExpired:
            with suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise SourceReadError("WORKER_TIMEOUT") from None
        finally:
            if proc.poll() is None:
                with suppress(ProcessLookupError):
                    os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        if proc.returncode:
            raise SourceReadError("WORKER_FAILED_OR_RESOURCE_LIMIT")
        output.seek(0)
        raw = output.read(MAX_OUTPUT + 1)
        if len(raw) > MAX_OUTPUT:
            raise SourceReadError("WORK_OUTPUT_LIMIT")
    try:
        result = json.loads(raw)
        if (
            not isinstance(result, dict)
            or result.get("regulatory_status") != "NOT_ASSESSED"
            or result.get("human_review_required") is not True
        ):
            raise ValueError
        return result
    except (ValueError, UnicodeError):
        raise SourceReadError("INVALID_WORKER_RESULT") from None
