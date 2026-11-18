"""Rebuild the fixed pre-OKR portion of the MVVM chart from a full Android clone."""
import csv
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import subprocess
import sys


# Last develop commit before the comparable daily OKR observations begin.
REVISION = "1c1dc986a40d2635c78508b8894b44eab45647a4"
START = date(2025, 3, 1)
STOP = date(2026, 5, 4)
OUTPUT = Path(__file__).resolve().parents[1] / "dodo-android/mvvm-history.csv"


def generate(repo):
    git = ["git", "-C", repo]
    log = subprocess.check_output(
        git + ["log", "--first-parent", "--format=%ct %H", REVISION], text=True
    )
    revisions = [(int(ts), sha) for ts, sha in (line.split() for line in log.splitlines())]
    counts = {}
    rows = []
    day = START
    while day < STOP:
        next_day = day + timedelta(days=1)
        cutoff = datetime.combine(next_day, time.min, tzinfo=timezone.utc).timestamp()
        sha = next(sha for ts, sha in revisions if ts < cutoff)
        if sha not in counts:
            # The app and feature modules lived under project/ throughout this period.
            # Match the OKR scanner's literal and count matching Kotlin files once.
            result = subprocess.run(
                git + ["grep", "-lzF", ") : BaseViewModel", sha, "--",
                       ":(glob)project/app/**/*.kt", ":(glob)project/context/*/**/*.kt"],
                stdout=subprocess.PIPE,
            )
            if result.returncode not in (0, 1):
                result.check_returncode()
            counts[sha] = result.stdout.count(b"\0")
        rows.append((day.isoformat(), counts[sha]))
        day = next_day

    with OUTPUT.open("w", newline="") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["date", "viewmodels"])
        writer.writerows(rows)


if __name__ == "__main__":
    generate(sys.argv[1])
