#!/usr/bin/env python3
"""Minify `mcm get` output into a compact per-metric time series for the page.

Input  (stdin or arg): full GET response
  {repo, metrics:[{name, commits:[{hash, timestamp, value}]}]}
Output (stdout):
  {"repo":..., "metrics":[{"name", "kind", "points":[[epochMs, number], ...]}]}

- scalar value  -> the number itself (kind "count")
- object value  -> count of non-null entries (kind "adoption"; e.g. SWIFT_VERSION
  modules, SWIFT_STRICT_CONCURRENCY modules with a value) — a scalar we can plot
- hashes dropped; timestamps -> epoch ms
"""
import json
import sys
from collections import Counter
from datetime import datetime


def to_ms(s):
    s = s.strip().replace(" ", "T")
    if len(s) >= 3 and s[-3] in "+-" and s[-6] not in "+-":
        s = s[:-3] + s[-3:] + ":00"  # "+00" -> "+00:00"
    return int(datetime.fromisoformat(s).timestamp() * 1000)


def scalar(value):
    if isinstance(value, bool):
        return (int(value), "count")
    if isinstance(value, (int, float)):
        return (value, "count")
    if isinstance(value, dict):
        return (sum(1 for v in value.values() if v is not None), "adoption")
    return (None, None)


def main():
    src = sys.stdin if len(sys.argv) < 2 else open(sys.argv[1])
    doc = json.load(src)
    out = {"repo": doc.get("repo"), "metrics": []}
    for m in doc.get("metrics", []):
        # SWIFT_VERSION is a {module: version} map — keep the per-commit
        # histogram of major versions so the dashboard can show version share.
        if m["name"] == "SWIFT_VERSION":
            points = []
            for c in m["commits"]:
                if not isinstance(c["value"], dict):
                    continue
                hist = Counter(str(v).split(".")[0] for v in c["value"].values() if v is not None)
                if hist:
                    points.append([to_ms(c["timestamp"]), dict(hist)])
            points.sort(key=lambda p: p[0])
            if points:
                out["metrics"].append({"name": m["name"], "kind": "versions", "points": points})
            continue
        points, kind = [], "count"
        for c in m["commits"]:
            v, k = scalar(c["value"])
            if v is None:
                continue
            kind = k
            points.append([to_ms(c["timestamp"]), v])
        points.sort()
        if points:
            out["metrics"].append({"name": m["name"], "kind": kind, "points": points})
    out["metrics"].sort(key=lambda x: x["name"].lower())
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
