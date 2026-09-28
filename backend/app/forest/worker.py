"""Resource-limited subprocess entrypoint. No business DB or credentials needed.

This is resource isolation, NOT a production OS/container security sandbox.
"""

import json
import resource
import sys


def main():
    resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024**2, 8 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("WORK_INPUT_LIMIT")
    from app.forest.engine import analyze_geometry

    result = analyze_geometry(json.loads(raw))
    sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No raw exception/geometry/HTTP content on stdout or logs.
        sys.exit(2)
