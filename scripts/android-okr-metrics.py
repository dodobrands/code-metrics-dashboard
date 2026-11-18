"""Project the existing mobile_okrs main-branch archive to public numeric series."""
from collections import defaultdict
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
        emit("MVP:Remaining", day, migration.get("total_presenters"))
        inventory = (entry.get("ds_components") or {}).get("android") or {}
        done, total = inventory.get("adopted"), inventory.get("total")
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
    required = {"OKR:MVP:Remaining", "OKR:DS:Available", "OKR:DS:Missing", "OKR:DS:InUse",
                "OKR:DS:NoEquivalent", "OKR:DS:NeedsChanges", "OKR:DS:Ready"}
    if {row["name"] for row in feed["metrics"]} != required:
        raise ValueError("mobile_okrs archive lacks required Android metric series")
    raw = json.loads(raw_path.read_text())
    if required.intersection(row["name"] for row in raw["metrics"]):
        raise ValueError("Duplicate OKR metrics in the base payload")
    raw["metrics"].extend(feed["metrics"])
    staged = raw_path.with_suffix(".merged.tmp")
    staged.write_text(json.dumps(raw, separators=(",", ":")))
    staged.replace(raw_path)


if __name__ == "__main__":
    main()
