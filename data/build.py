#!/usr/bin/env python3
"""Build per-chart data files + meta from an `mcm get` dump.

Input : raw GET response (arg or stdin) + ../charts.json (chart specs).
Output (written under data/):
  meta.json          {repo, updated, bounds:{min,max}, years, hero:{...}}
  charts/<id>.json   {"series":[{name, kind, points}]}  # only that chart's series

Each chart file holds ONLY the series it draws; meta.json carries the shared
x-axis bounds and the headline stats — all computed here, never hardcoded.
"""
import json
import os
import sys
from collections import Counter
from datetime import datetime

DAY_MS = 86_400_000


def to_ms(s):
    s = s.strip().replace(" ", "T")
    if len(s) >= 3 and s[-3] in "+-" and s[-6] not in "+-":
        s = s[:-3] + s[-3:] + ":00"  # "+00" -> "+00:00"
    return int(datetime.fromisoformat(s).timestamp() * 1000)


def scalar(value):
    if isinstance(value, bool):
        return int(value), "count"
    if isinstance(value, (int, float)):
        return value, "count"
    if isinstance(value, dict):
        return sum(1 for v in value.values() if v is not None), "adoption"
    return None, None


def metric_points(m):
    """(kind, points) for one metric; SWIFT_VERSION -> per-commit version histogram."""
    if m["name"] == "SWIFT_VERSION":
        points = []
        for c in m["commits"]:
            if not isinstance(c["value"], dict):
                continue
            hist = Counter(str(v).split(".")[0] for v in c["value"].values() if v is not None)
            if hist:
                points.append([to_ms(c["timestamp"]), dict(hist)])
        points.sort(key=lambda p: p[0])
        return "versions", points
    kind, points = "count", []
    for c in m["commits"]:
        v, k = scalar(c["value"])
        if v is None:
            continue
        kind = k
        points.append([to_ms(c["timestamp"]), v])
    points.sort()
    return kind, points


def last(points):
    return points[-1][1] if points else None


def resolve_series(chart, metrics):
    """(metric name, label) for a chart — explicit `series`, or every metric
    matching `seriesPrefix` (prefix stripped for the label)."""
    prefix = chart.get("seriesPrefix")
    if prefix:
        return [(n, n[len(prefix):]) for n in sorted(metrics) if n.startswith(prefix)]
    return [(n, n) for n in chart.get("series", [])]


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "charts.json")) as f:
        charts = json.load(f)
    src = sys.stdin if len(sys.argv) < 2 else open(sys.argv[1])
    doc = json.load(src)

    metrics = {}
    for m in doc.get("metrics", []):
        kind, points = metric_points(m)
        if points:
            metrics[m["name"]] = {"name": m["name"], "kind": kind, "points": points}

    # Shared x-axis bounds across every series any chart draws.
    used = {n for c in charts for n, _ in resolve_series(c, metrics) if n in metrics}
    ts = [p[0] for n in used for p in metrics[n]["points"]]
    bounds = {"min": min(ts), "max": max(ts)}

    # Headline stats — recomputed every build, never hardcoded.
    hero = {}
    sv = metrics.get("SWIFT_VERSION")
    if sv:
        h = sv["points"][-1][1]
        total = sum(h.values())
        hero["swift6Pct"] = round((h.get("6", 0) / total) * 100) if total else 0
        hero["swift6Total"] = total
    su = last(metrics.get("SwiftUI", {}).get("points", []))
    uk = last(metrics.get("UIKit", {}).get("points", []))
    if su is not None and uk is not None and su + uk > 0:
        hero["swiftUIShare"] = round(su / (su + uk) * 100)

    charts_dir = os.path.join(root, "data", "charts")
    os.makedirs(charts_dir, exist_ok=True)
    for c in charts:
        series = [
            {"name": label, "kind": metrics[n]["kind"], "points": metrics[n]["points"]}
            for n, label in resolve_series(c, metrics)
            if n in metrics
        ]
        with open(os.path.join(charts_dir, c["id"] + ".json"), "w") as f:
            json.dump({"series": series}, f, separators=(",", ":"))

    meta = {
        "repo": doc.get("repo"),
        "updated": bounds["max"],
        "bounds": bounds,
        "years": max(1, round((bounds["max"] - bounds["min"]) / (365.25 * DAY_MS))),
        "hero": hero,
    }
    with open(os.path.join(root, "data", "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
