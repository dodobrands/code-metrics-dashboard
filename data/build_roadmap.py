#!/usr/bin/env python3
"""Build the roadmap board + detail dialogs into index.html from roadmap/*.json.

Source of truth: roadmap/index.json (columns + order) and roadmap/<id>.json
(title, description). This renders the board cards and one <dialog> per task,
then injects them into index.html between the roadmap markers. Runs at deploy
(and locally, before serving). Injection is idempotent: it replaces whatever
sits between the paired markers, so re-running is safe.
"""
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def esc(text):
    return html.escape(text, quote=False)


def between(marker, replacement, doc):
    pattern = f"<!--{marker}:start-->.*?<!--{marker}:end-->"
    body = f"<!--{marker}:start-->{replacement}<!--{marker}:end-->"
    return re.sub(pattern, lambda _m: body, doc, flags=re.DOTALL)


def main():
    with open(os.path.join(ROOT, "roadmap", "index.json")) as f:
        index = json.load(f)

    tasks = {}
    for col in index["columns"]:
        for tid in col["items"]:
            with open(os.path.join(ROOT, "roadmap", f"{tid}.json")) as f:
                tasks[tid] = json.load(f)

    cols, dialogs = [], []
    for col in index["columns"]:
        cards = "".join(
            f'<li><button type="button" class="card-item" data-dialog="rm-{tid}">'
            f'{esc(tasks[tid]["title"])}</button></li>'
            for tid in col["items"]
        )
        cols.append(
            f'<div class="col"><div class="col-head">'
            f'<span class="tag {col["key"]}">{esc(col["title"])}</span>'
            f'<span class="count">{len(col["items"])}</span></div>'
            f"<ul>{cards}</ul></div>"
        )
        for tid in col["items"]:
            task = tasks[tid]
            dialogs.append(
                f'<dialog id="rm-{tid}" class="detail">'
                f'<form method="dialog" class="dlg-x">'
                f'<button type="submit" aria-label="Close">✕</button></form>'
                f'<h3>{esc(task["title"])}</h3>'
                f'<div class="dlg-body">{task["description"]}</div></dialog>'
            )

    path = os.path.join(ROOT, "index.html")
    with open(path) as f:
        doc = f.read()
    doc = between("roadmap:board", "\n        " + "\n        ".join(cols) + "\n      ", doc)
    doc = between("roadmap:dialogs", "\n  " + "\n  ".join(dialogs) + "\n  ", doc)
    with open(path, "w") as f:
        f.write(doc)

    total = sum(len(c["items"]) for c in index["columns"])
    print(f"roadmap: {total} tasks -> board + dialogs injected into index.html")


if __name__ == "__main__":
    main()
