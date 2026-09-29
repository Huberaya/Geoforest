"""Linux namespace candidate. No application activation or unsandboxed fallback.

Host runtime/code/artifacts are trusted and must be immutable to the worker.
Only selected executable/package/signature paths are mounted; stdin carries bytes.
"""

import importlib.util
import os
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.documents.storage import MAX_BYTES

HERE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class SandboxResult:
    returncode: int | None
    output: bytes
    error: str | None = None


class DocumentSandbox:
    def __init__(self, *, launcher=Path("/usr/bin/bwrap")):
        self.launcher = Path(launcher)

    def command(self, operation, *, engine=None, database_files=(), library_path=None):
        if operation not in {"format", "scan", "version", "probe", "timeout-probe"}:
            raise ValueError("Unsupported sandbox operation")
        launcher = self.launcher.resolve(strict=True)
        if launcher.stat().st_mode & 0o6000:
            raise ValueError("Unprivileged bubblewrap required")
        python = Path(sys.executable).resolve(strict=True)
        if not python.is_relative_to("/usr"):
            raise ValueError("Trusted system Python below /usr required")
        args = [
            "/usr/bin/prlimit",
            "--as=2147483648",
            "--cpu=50",
            "--fsize=83886080",
            "--nofile=64",
            "--nproc=64",
            "--core=0",
            "--",
            str(launcher),
            "--unshare-all",
            "--unshare-user",
            "--uid",
            "65534",
            "--gid",
            "65534",
            "--disable-userns",
            "--assert-userns-disabled",
            "--cap-drop",
            "ALL",
            "--die-with-parent",
            "--new-session",
            "--clearenv",
            "--setenv",
            "PATH",
            "/usr/bin:/bin",
            "--setenv",
            "LANG",
            "C",
            "--setenv",
            "OPENBLAS_NUM_THREADS",
            "1",
            "--ro-bind",
            "/usr",
            "/usr",
            "--symlink",
            "usr/bin",
            "/bin",
            "--symlink",
            "usr/lib",
            "/lib",
            "--symlink",
            "usr/lib64",
            "/lib64",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--size",
            str(128 * 1024**2),
            "--tmpfs",
            "/tmp",
            "--chdir",
            "/tmp",
        ]
        if operation == "format":
            args += ["--dir", "/deps"]
            for module in ("PIL", "pypdf"):
                spec = importlib.util.find_spec(module)
                source = Path(spec.origin).parent.resolve(strict=True)
                args += ["--ro-bind", str(source), f"/deps/{module}"]
                if module == "PIL":
                    libs = source.parent / "pillow.libs"
                    if libs.exists():
                        args += ["--ro-bind", str(libs), "/deps/pillow.libs"]
            args += [
                "--ro-bind",
                str(HERE / "format_worker.py"),
                "/format_worker.py",
                "--ro-bind",
                str(HERE / "sandbox_format_entry.py"),
                "/entry.py",
            ]
            child = [str(python), "-I", "-S", "/entry.py"]
        elif operation in {"scan", "version"}:
            executable = Path(engine)
            if executable.is_symlink() or not executable.is_file():
                raise ValueError("Invalid engine")
            args += [
                "--dir",
                "/engine",
                "--ro-bind",
                str(executable.resolve()),
                "/engine/clamscan",
            ]
            if library_path is not None:
                libs = Path(library_path).resolve(strict=True)
                if not libs.is_dir():
                    raise ValueError("Invalid libraries")
                args += [
                    "--ro-bind",
                    str(libs),
                    "/engine/lib",
                    "--setenv",
                    "LD_LIBRARY_PATH",
                    "/engine/lib",
                ]
            if operation == "version":
                child = ["/engine/clamscan", "--version"]
            else:
                files = tuple(Path(p) for p in database_files)
                if len(files) != 3 or {p.stem for p in files} != {
                    "daily",
                    "main",
                    "bytecode",
                }:
                    raise ValueError("Three vendor databases required")
                args += ["--dir", "/database"]
                for path in files:
                    if (
                        path.is_symlink()
                        or not path.is_file()
                        or path.suffix not in {".cvd", ".cld"}
                    ):
                        raise ValueError("Invalid signature file")
                    args += ["--ro-bind", str(path.resolve()), "/database/" + path.name]
                args += ["--ro-bind", str(HERE / "scan_worker.py"), "/entry.py"]
                child = [
                    str(python),
                    "-I",
                    "-S",
                    "/entry.py",
                    "/engine/clamscan",
                    "/database",
                    "/tmp",
                ]
        else:
            args += ["--ro-bind", str(HERE / "sandbox_probe.py"), "/entry.py"]
            child = [str(python), "-I", "-S", "/entry.py", operation]
        args += [
            "--remount-ro",
            "/",
            "--remount-ro",
            "/dev",
            "--remount-ro",
            "/proc",
            "--",
            *child,
        ]
        return args

    def run(self, operation, data=b"", *, timeout=15, **artifacts):
        if (
            type(data) is not bytes
            or len(data) > MAX_BYTES
            or type(timeout) not in {int, float}
            or not 0 < timeout <= 90
        ):
            return SandboxResult(None, b"", "SANDBOX_INPUT_REFUSED")
        proc = None
        try:
            command = self.command(operation, **artifacts)
            with tempfile.TemporaryFile() as output:
                proc = subprocess.Popen(
                    command,
                    stdin=subprocess.PIPE,
                    stdout=output,
                    stderr=subprocess.DEVNULL,
                    env={"PATH": "/usr/bin:/bin", "LANG": "C"},
                    close_fds=True,
                    umask=0o077,
                    start_new_session=True,
                )
                try:
                    proc.communicate(data, timeout=timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=5)
                    output.seek(0)
                    return SandboxResult(None, output.read(65537), "SANDBOX_TIMEOUT")
                output.seek(0)
                result = output.read(65537)
                if len(result) > 65536:
                    return SandboxResult(proc.returncode, b"", "SANDBOX_OUTPUT_LIMIT")
                return SandboxResult(proc.returncode, result)
        except (
            OSError,
            ValueError,
            TypeError,
            AttributeError,
            subprocess.SubprocessError,
        ):
            return SandboxResult(None, b"", "SANDBOX_UNAVAILABLE")
        finally:
            if proc is not None and proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
