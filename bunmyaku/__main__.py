"""One-command launcher: ``python3 -m bunmyaku [--content DIR] [--open]``.

Works from any current directory: the repository root is added to ``sys.path`` so that
``serve.py`` and ``packlib.py`` next to this package are found.
"""
import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parent.parent)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import serve  # noqa: E402

if __name__ == '__main__':
    serve.main()
