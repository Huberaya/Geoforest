"""Internal resource wrapper, not an OS sandbox or a public command endpoint."""

import os
import resource
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 4:
        raise ValueError("INVALID_SCAN_ARGUMENTS")
    executable, database, temporary = sys.argv[1:]
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    resource.setrlimit(resource.RLIMIT_FSIZE, (80 * 1024**2,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Do not load arbitrary local allowlists or extra signature files from the
    # directory. Only the three qualified vendor databases are passed to ClamAV.
    database_args = []
    for name in ("daily", "main", "bytecode"):
        candidates = [
            p
            for suffix in ("cvd", "cld")
            if (p := Path(database) / f"{name}.{suffix}").is_file()
        ]
        if len(candidates) != 1 or candidates[0].is_symlink():
            raise ValueError("UNAVAILABLE_DATABASE")
        database_args.append(f"--database={candidates[0]}")
    os.execv(
        executable,
        [
            executable,
            *database_args,
            f"--tempdir={temporary}",
            "--no-summary",
            "--stdout",
            "--max-filesize=20M",
            "--max-scansize=80M",
            "--max-files=1000",
            "--max-recursion=8",
            "--max-scantime=0",
            "--alert-exceeds-max=yes",
            "--alert-encrypted=yes",
            "--alert-macros=yes",
            "--alert-broken=yes",
            "--alert-broken-media=yes",
            "-",
        ],
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(2)
