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

let index = loadJSON("\(root)/roadmap/index.json") as? [String: Any] ?? [:]
let columns = index["columns"] as? [[String: Any]] ?? []

var tasks: [String: [String: Any]] = [:]
for col in columns {
    for tid in (col["items"] as? [String] ?? []) {
        tasks[tid] = loadJSON("\(root)/roadmap/\(tid).json") as? [String: Any] ?? [:]
    }
}

var cols: [String] = []
var dialogs: [String] = []
for col in columns {
    let key = col["key"] as? String ?? ""
    let title = col["title"] as? String ?? ""
    let items = col["items"] as? [String] ?? []
    let cards = items.map { tid in
        "<li><button type=\"button\" class=\"card-item\" data-dialog=\"rm-\(tid)\">"
            + "\(esc(tasks[tid]?["title"] as? String ?? ""))</button></li>"
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
                + "<div class=\"dlg-body\">\(task["description"] as? String ?? "")</div></dialog>"
        )
    }
}

let indexPath = "\(root)/index.html"
var doc = (try? String(contentsOfFile: indexPath, encoding: .utf8)) ?? ""
doc = between("roadmap:board", "\n        " + cols.joined(separator: "\n        ") + "\n      ", doc)
doc = between("roadmap:dialogs", "\n  " + dialogs.joined(separator: "\n  ") + "\n  ", doc)
try? doc.write(toFile: indexPath, atomically: true, encoding: .utf8)

let total = columns.reduce(0) { $0 + ($1["items"] as? [String] ?? []).count }
print("roadmap: \(total) tasks -> board + dialogs injected into index.html")
