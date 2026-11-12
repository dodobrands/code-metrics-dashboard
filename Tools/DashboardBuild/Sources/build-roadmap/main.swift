import Foundation

// Port of data/build_roadmap.py. Renders the roadmap board + one <dialog> per
// task from roadmap/index.json + roadmap/<id>.json, then injects them into
// index.html between the paired markers. Idempotent: replaces whatever sits
// between the markers, so re-running is safe.

let root = FileManager.default.currentDirectoryPath

/// html.escape(text, quote=False): & < > only, ampersand first.
func esc(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
}

func loadJSON(_ path: String) -> Any {
    let data = (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data()
    return (try? JSONSerialization.jsonObject(with: data)) ?? [:]
}

/// Replace the span between paired markers with start+replacement+end.
func between(_ marker: String, _ replacement: String, _ doc: String) -> String {
    let start = "<!--\(marker):start-->"
    let end = "<!--\(marker):end-->"
    guard let sRange = doc.range(of: start),
          let eRange = doc.range(of: end, range: sRange.upperBound ..< doc.endIndex)
    else { return doc }
    var result = doc
    result.replaceSubrange(sRange.lowerBound ..< eRange.upperBound, with: start + replacement + end)
    return result
}

// An app with roadmap/kaiten.json takes its roadmap from Kaiten only: the cards
// scripts/kaiten-roadmap.mjs pulled into roadmap/kaiten/ at deploy, same shape as
// the hand-written roadmap/. When that pull failed or found nothing, the folder is
// empty and the roadmap is hidden below.
let dir = FileManager.default.fileExists(atPath: "\(root)/roadmap/kaiten.json") ? "roadmap/kaiten" : "roadmap"
let index = loadJSON("\(root)/\(dir)/index.json") as? [String: Any] ?? [:]
let columns = index["columns"] as? [[String: Any]] ?? []

var tasks: [String: [String: Any]] = [:]
for col in columns {
    for tid in (col["items"] as? [String] ?? []) {
        tasks[tid] = loadJSON("\(root)/\(dir)/\(tid).json") as? [String: Any] ?? [:]
    }
}

var cols: [String] = []
var dialogs: [String] = []
for col in columns {
    let key = col["key"] as? String ?? ""
    let title = col["title"] as? String ?? ""
    let items = col["items"] as? [String] ?? []
    // A card's optional `progress` (0...1) shows only in the In Progress column: a
    // percentage on a backlog or finished item says nothing.
    func percent(_ tid: String) -> Int? {
        guard key == "progress", let p = tasks[tid]?["progress"] as? Double else { return nil }
        // Clamped: a hand-typed 1.2 must not trap the pips' repeat count and fail the deploy.
        return min(max(Int((p * 100).rounded()), 0), 100)
    }
    // Progress is ten mono blocks under the title, the number after them. The blocks
    // are decoration, hidden from screen readers; the number is what gets read.
    func pips(_ pct: Int) -> String {
        let on = pct / 10 // floor: ten lit blocks only at 100%, the first one at 10%
        return "<span class=\"pips\"><span aria-hidden=\"true\">\(String(repeating: "■", count: on))"
            + "<span class=\"pips-rest\">\(String(repeating: "■", count: 10 - on))</span></span>"
            + "<em>\(pct)%</em></span>"
    }
    let cards = items.map { tid in
        "<li><button type=\"button\" class=\"card-item\" data-dialog=\"rm-\(tid)\">"
            // The space keeps title and percent apart in copied text and without CSS.
            + "\(esc(tasks[tid]?["title"] as? String ?? ""))\(percent(tid).map { " " + pips($0) } ?? "")</button></li>"
    }.joined()
    cols.append(
        "<div class=\"col\"><div class=\"col-head\">"
            + "<span class=\"tag \(key)\">\(esc(title))</span>"
            + "<span class=\"count\">\(items.count)</span></div>"
            + "<ul>\(cards)</ul></div>"
    )
    for tid in items {
        let task = tasks[tid] ?? [:]
        dialogs.append(
            "<dialog id=\"rm-\(tid)\" class=\"detail\">"
                + "<form method=\"dialog\" class=\"dlg-x\">"
                + "<button type=\"submit\" aria-label=\"Close\">✕</button></form>"
                + "<h3>\(esc(task["title"] as? String ?? ""))</h3>"
                + "<div class=\"dlg-body\">\(percent(tid).map { "<p>Progress: \($0)%</p>" } ?? "")"
                + "\(task["description"] as? String ?? "")</div></dialog>"
        )
    }
}

let indexPath = "\(root)/index.html"
var doc = (try? String(contentsOfFile: indexPath, encoding: .utf8)) ?? ""
let total = columns.reduce(0) { $0 + ($1["items"] as? [String] ?? []).count }
if total == 0 {
    // No cards — the whole section goes, heading included, rather than an empty board.
    if let start = doc.range(of: "<section id=\"roadmap\">"),
       let end = doc.range(of: "</section>", range: start.upperBound ..< doc.endIndex)
    {
        // Take the line's indent too, or the page is left with trailing whitespace.
        var from = start.lowerBound
        while from > doc.startIndex, doc[doc.index(before: from)] == " " { from = doc.index(before: from) }
        doc.removeSubrange(from ..< end.upperBound)
    }
    try? doc.write(toFile: indexPath, atomically: true, encoding: .utf8)
    print("roadmap: no tasks in \(dir)/ -> roadmap hidden")
    exit(0)
}
doc = between("roadmap:board", "\n        " + cols.joined(separator: "\n        ") + "\n      ", doc)
doc = between("roadmap:dialogs", "\n  " + dialogs.joined(separator: "\n  ") + "\n  ", doc)
try? doc.write(toFile: indexPath, atomically: true, encoding: .utf8)

print("roadmap: \(total) tasks -> board + dialogs injected into index.html")
