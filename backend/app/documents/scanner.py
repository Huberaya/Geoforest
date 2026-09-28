"""Bounded ClamAV adapter. No network or business credentials in the child.

SCAN_PASSED means only no detection under this scan's limits and signatures;
it is neither a document review nor an authenticity/legality determination.
"""

import hashlib
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from app.documents.storage import MAX_BYTES, Blob, LocalStore, StorageError

APPROVED_VERSION = "1.4.6"
MAX_SIGNATURE_AGE = 72 * 3600  # Operational policy, not an EUDR requirement.


@dataclass(frozen=True)
class ScanResult:
    status: str
    reason: str
    engine_version: str | None = None
    database_versions: dict | None = None
    input_sha256: str | None = None

    def json(self):
        return asdict(self)


class Scanner:
    def __init__(
        self, executable: Path, database: Path, *, library_path: Path | None = None
    ):
        self.executable = Path(executable).absolute()
        self.database = Path(database).absolute()
        self.env = {
            "PATH": "/usr/bin:/bin",
            "LANG": "C",
            "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
        }
        if library_path is not None:
            self.env["LD_LIBRARY_PATH"] = str(Path(library_path).absolute())

    def _databases(self):
        result = {}
        for name in ("daily", "main", "bytecode"):
            candidates = [
                p
                for suffix in ("cvd", "cld")
                if (p := self.database / f"{name}.{suffix}").is_file()
            ]
            if len(candidates) != 1 or candidates[0].is_symlink():
                raise ValueError("SIGNATURES_UNAVAILABLE")
            with candidates[0].open("rb") as f:
                header = f.read(512).decode("ascii").strip().split(":")
            if len(header) != 9 or header[0] != "ClamAV-VDB":
                raise ValueError("SIGNATURE_HEADER_INVALID")
            version, count, epoch = int(header[2]), int(header[3]), int(header[8])
            if min(version, count, epoch) <= 0:
                raise ValueError("SIGNATURE_HEADER_INVALID")
            if name == "daily" and not -300 <= time.time() - epoch <= MAX_SIGNATURE_AGE:
                raise ValueError("SIGNATURES_STALE_OR_FUTURE")
            result[name] = {
                "version": version,
                "signatures": count,
                "build_epoch": epoch,
            }
        return result

    def scan(self, store: LocalStore, blob: Blob, *, timeout=65):
        versions = None
        try:
            versions = self._databases()
            version = subprocess.run(
                [str(self.executable), "--version"],
                env=self.env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=5,
                check=False,
            )
            if version.returncode or not re.fullmatch(
                rb"ClamAV "
                + re.escape(APPROVED_VERSION.encode())
                + rb"(?:/[0-9]+/[^\r\n]{1,100})?",
                version.stdout.strip(),
            ):
                return ScanResult("SCAN_UNAVAILABLE", "ENGINE_NOT_QUALIFIED")
            with store.open_verified(blob) as f:
                data = f.read(MAX_BYTES + 1)
            if (
                len(data) != blob.size
                or hashlib.sha256(data).hexdigest() != blob.sha256
            ):
                return ScanResult("SCAN_UNAVAILABLE", "INPUT_INTEGRITY_FAILED")
            with (
                tempfile.TemporaryDirectory(prefix="gft-scan-") as temporary,
                tempfile.TemporaryFile() as output,
            ):
                proc = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "app.documents.scan_worker",
                        str(self.executable),
                        str(self.database),
                        temporary,
                    ],
                    env=self.env,
                    stdin=subprocess.PIPE,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                try:
                    proc.communicate(data, timeout=timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.communicate()
                    return ScanResult(
                        "SCAN_UNAVAILABLE",
                        "SCAN_TIMEOUT",
                        APPROVED_VERSION,
                        versions,
                        blob.sha256,
                    )
                finally:
                    if proc.poll() is None:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait()
                output.seek(0)
                report = output.read(65537)
            if versions != self._databases():
                return ScanResult(
                    "SCAN_UNAVAILABLE",
                    "SIGNATURES_CHANGED",
                    APPROVED_VERSION,
                    versions,
                    blob.sha256,
                )
            status, reason = "SCAN_UNAVAILABLE", "SCAN_FAILED_OR_LIMIT"
            if (
                len(report) <= 65536
                and proc.returncode == 0
                and report.strip() == b"stdin: OK"
            ):
                status, reason = "SCAN_PASSED", "NO_DETECTION_IN_THIS_SCAN"
            elif proc.returncode == 1:
                status, reason = "SCAN_REJECTED", "DETECTION_OR_POLICY_LIMIT"
            return ScanResult(status, reason, APPROVED_VERSION, versions, blob.sha256)
        except (OSError, ValueError, StorageError, subprocess.SubprocessError):
            return ScanResult(
                "SCAN_UNAVAILABLE",
                "ENGINE_OR_SIGNATURES_UNAVAILABLE",
                database_versions=versions,
            )
