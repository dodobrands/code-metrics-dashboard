"""Rebuild the fixed pre-OKR Android observations using the original scanners.

Arguments: full Android git clone, mobile_okrs checkout, ds_metrics checkout.
The daily dashboard build reads later observations directly from mobile_okrs.
"""
import csv
from datetime import date
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

android, okrs, catalog = map(Path, sys.argv[1:])
sys.path[:0] = [str(okrs / "scripts"), str(okrs), str(catalog)]
from backfill_ds_usage import android_at
from collectors.ds_components import load_history
from components import ANDROID_DS_BASE, COMPONENTS, NOT_APPLICABLE, android_file_names, android_module_files

dest = Path(__file__).resolve().parents[1] / "dodo-android"
usage = []
inventory = []
applicable = sorted(set(COMPONENTS) - set(NOT_APPLICABLE["android"]))
# First develop revision with the Android DS component source directory.
days = [date(2024, 3, 19)] + [date(year, month, 1) for year in (2024, 2025)
                              for month in range(1, 13) if date(2024, 3, 19) < date(year, month, 1) < date(2025, 10, 1)]
for day in days:
    rev = subprocess.check_output(["git", "-C", android, "rev-list", "--first-parent", "-1",
                                   f"--before={day}T23:59:59+03:00", "origin/develop"], text=True).strip()
    paths = subprocess.check_output(["git", "-C", android, "ls-tree", "-r", "--name-only", rev,
                                     "--", "project/" + ANDROID_DS_BASE], text=True).splitlines()
    files = android_module_files(p.removeprefix("project/") for p in paths)
    if files:
        found = sum(any(f in files for f in android_file_names(c)) for c in applicable)
        inventory.append((str(day), found, len(applicable) - found))
    if day < date(2025, 7, 1):
        with TemporaryDirectory() as work:
            counts = android_at(android, rev, Path(work))
        if counts and sum(counts[k] for k in ("ds", "replaceable", "gaps", "custom")):
            usage.append((str(day), counts["ds"], counts["replaceable"] + counts["custom_ready"],
                          counts["custom"] - counts["custom_ready"], counts["gaps"]))

for snapshot in load_history(catalog / "data"):
    if snapshot["date"] < "2026-04-08":
        row = snapshot["android"]
        inventory.append((snapshot["date"], row["adopted"], row["total"] - row["adopted"]))

for filename, columns, rows in [
    ("ds-usage-history.csv", ("date", "InUse", "Ready", "NeedsChanges", "NoEquivalent"), usage),
    ("ds-catalog-history.csv", ("date", "Available", "Missing"), inventory),
]:
    with (dest / filename).open("w", newline="") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(columns)
        writer.writerows(rows)
    print(filename, len(rows), rows[0], rows[-1])
