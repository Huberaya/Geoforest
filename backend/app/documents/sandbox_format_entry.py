"""Fixed entrypoint; -I -S and a selected dependency mount, never the app package."""

import runpy
import sys

sys.path.insert(0, "/deps")
runpy.run_path("/format_worker.py", run_name="__main__")
