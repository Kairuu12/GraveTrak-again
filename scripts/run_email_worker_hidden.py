"""Windows Task Scheduler entry point; run with pythonw.exe to avoid a console."""
import os
from pathlib import Path
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parent.parent
    python = Path(sys.executable).with_name('python.exe')
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    try:
        result = subprocess.run(
            [str(powershell), '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
             '-File', str(root / 'scripts/run-email-worker.ps1'),
             '-PythonExecutable', str(python)],
            cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return result.returncode
    except OSError:
        (root / '.tmp').mkdir(exist_ok=True)
        (root / '.tmp/email-worker.log').write_text(
            'Email worker launcher failed. Check Python and PowerShell installation.\n',
            encoding='utf-8',
        )
        return 1


if __name__ == '__main__':
    sys.exit(main())
