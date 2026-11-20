"""Project the existing mobile_okrs main-branch archive to public numeric series."""
from collections import defaultdict
import csv
import json
from pathlib import Path
import re
import sys
import tarfile


def read_archive(stream):
    series = defaultdict(list)

    def emit(name, day, value):
        if type(value) is int and value >= 0:
            series["OKR:" + name].append({"timestamp": day + "T00:00:00Z", "value": value})

    def inventory_and_migration(entry):
        day = entry["date"]
        migration = (entry.get("android") or {}).get("mvvm_migration") or {}
        # The scanner switched to BaseViewModel subclasses on May 4 (mobile_okrs PR #1).
        # The three June 30–July 2 snapshots repeat the May 4 module counts.
        if day >= "2026-05-04" and not "2026-06-30" <= day <= "2026-07-02":
            emit("MVP:Remaining", day, migration.get("total_presenters"))
            emit("MVVM:Screens", day, migration.get("total_viewmodels"))
        inventory = (entry.get("ds_components") or {}).get("android") or {}
        done, total = inventory.get("adopted"), inventory.get("total")
        # ds_metrics rescanned the Android Git trees after code search returned empty results.
        # mobile_okrs retained the original counts on these two days.
        # https://github.com/dodobrands/ds_metrics/commit/3071c5761a3ca6500240c228291f04c68c0d6264
        if day in ("2026-08-29", "2026-08-30") and (done, total) == (3, 34):
            done = 31
        if type(done) is int and type(total) is int and 0 <= done <= total and total > 0:
            emit("DS:Available", day, done)
            emit("DS:Missing", day, total - done)

    def design_system_usage(entry):
        usage = entry.get("android") or {}
        day = entry["date"]
        emit("DS:InUse", day, usage.get("ds"))
        emit("DS:NoEquivalent", day, usage.get("gaps"))
        ready, custom = usage.get("custom_ready"), usage.get("custom")
        replaceable = usage.get("replaceable")
        if type(ready) is int and type(custom) is int and 0 <= ready <= custom:
            emit("DS:NeedsChanges", day, custom - ready)
            if type(replaceable) is int and replaceable >= 0:
                emit("DS:Ready", day, replaceable + ready)

    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            path = member.name.partition("/")[2]
            if path == "data/ds-usage.json":
                for day in json.load(archive.extractfile(member))["history"]:
                    design_system_usage(day)
            elif re.fullmatch(r"data/\d{4}-\d{2}-\d{2}\.json", path):
                inventory_and_migration(json.load(archive.extractfile(member)))
    return {"metrics": [
        {"name": name, "commits": sorted(points, key=lambda point: point["timestamp"])}
        for name, points in sorted(series.items())
    ]}


def main():
    raw_path = Path(sys.argv[1])
    feed = read_archive(sys.stdin.buffer)
    required = {"OKR:MVP:Remaining", "OKR:MVVM:Screens", "OKR:DS:Available", "OKR:DS:Missing", "OKR:DS:InUse",
                "OKR:DS:NoEquivalent", "OKR:DS:NeedsChanges", "OKR:DS:Ready"}
    if {row["name"] for row in feed["metrics"]} != required:
        raise ValueError("mobile_okrs archive lacks required Android metric series")
    history = Path(__file__).resolve().parents[1] / "dodo-android/mvvm-history.csv"
    with history.open(newline="") as source:
        rows = list(csv.DictReader(source))
    by_name = {row["name"]: row["commits"] for row in feed["metrics"]}
    for name, column in [("OKR:MVVM:Screens", "viewmodels"), ("OKR:MVP:Remaining", "presenters")]:
        commits = by_name[name]
        before_okr = [{"timestamp": row["date"] + "T00:00:00Z", "value": int(row[column])}
                      for row in rows]
        if before_okr[-1]["timestamp"] >= commits[0]["timestamp"]:
            raise ValueError(f"Android Git history overlaps daily OKR observations for {name}")
        commits[:0] = before_okr
    raw = json.loads(raw_path.read_text())
    if required.intersection(row["name"] for row in raw["metrics"]):
        raise ValueError("Duplicate OKR metrics in the base payload")
    raw["metrics"].extend(feed["metrics"])
    staged = raw_path.with_suffix(".merged.tmp")
    staged.write_text(json.dumps(raw, separators=(",", ":")))
    staged.replace(raw_path)


if __name__ == "__main__":
    main()
