import Foundation

// Port of data/build.py. Reads an `mcm get` JSON dump (arg or stdin) plus
// charts.json, writes data/meta.json and data/charts/<id>.json (each chart file
// holds only the series it draws), and inlines the "updated" date into
// index.html. Every number in the output is an integer, so values serialize as
// integers; see README § Data pipeline ("deploy only what's drawn").

let DAY_MS: Double = 86_400_000

// MARK: - JSON output helpers (match Python json.dump: compact, ensure_ascii)

/// JSON string literal matching CPython's ensure_ascii encoder: escape ",\ and
/// control chars, and every non-ASCII scalar as \uXXXX (surrogate pair >0xFFFF).
func jsonString(_ s: String) -> String {
    var out = "\""
    for scalar in s.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        default:
            let v = scalar.value
            if v < 0x20 || v > 0x7E {
                if v > 0xFFFF {
                    let vv = v - 0x10000
                    out += String(format: "\\u%04x\\u%04x", 0xD800 + (vv >> 10), 0xDC00 + (vv & 0x3FF))
                } else {
                    out += String(format: "\\u%04x", v)
                }
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    return out + "\""
}

/// A metric point value: a scalar count/adoption, or a SWIFT_VERSION histogram.
enum PointValue {
    case int(Int64)
    case double(Double)
    case histogram([(String, Int)]) // sorted by key; order is insignificant to consumers

    func json() -> String {
        switch self {
        case let .int(v): return String(v)
        case let .double(v): return numberRepr(v)
        case let .histogram(pairs):
            return "{" + pairs.map { "\(jsonString($0.0)):\($0.1)" }.joined(separator: ",") + "}"
        }
    }
}

/// Python repr for a float (shortest round-trip; integral floats keep ".0").
func numberRepr(_ v: Double) -> String {
    if v == v.rounded() && abs(v) < 1e16 {
        return String(format: "%.1f", v)
    }
    return String(v)
}

struct Point {
    let ts: Int64
    let value: PointValue
    func json() -> String { "[\(ts),\(value.json())]" }
}

struct Metric {
    let name: String
    let kind: String
    let points: [Point]
}

// MARK: - Timestamp parsing (port of build.py to_ms)

func toMs(_ raw: String) -> Int64 {
    var s = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "T")
    let chars = Array(s.unicodeScalars)
    let n = chars.count
    // "+00" -> "+00:00": a 2-digit trailing offset whose sign sits at s[-3].
    if n >= 6, chars[n - 3] == "+" || chars[n - 3] == "-", chars[n - 6] != "+", chars[n - 6] != "-" {
        s += ":00"
    }
    return parseISO(s)
}

/// Parse `YYYY-MM-DD[(T| )HH:MM[:SS[.frac]]][±HH:MM|Z]` to epoch milliseconds
/// (UTC), matching datetime.fromisoformat().timestamp() * 1000 truncated.
func parseISO(_ s: String) -> Int64 {
    let scalars = Array(s.unicodeScalars)
    var i = 0
    func readInt(_ count: Int) -> Int {
        var v = 0
        for _ in 0 ..< count { v = v * 10 + Int(scalars[i].value) - 48; i += 1 }
        return v
    }
    let year = readInt(4); i += 1 // '-'
    let month = readInt(2); i += 1 // '-'
    let day = readInt(2)
    var hour = 0, minute = 0, second = 0, fracMs = 0, offsetSec = 0
    if i < scalars.count {
        i += 1 // 'T' or ' '
        hour = readInt(2); i += 1 // ':'
        minute = readInt(2)
        if i < scalars.count, scalars[i] == ":" {
            i += 1
            second = readInt(2)
        }
        if i < scalars.count, scalars[i] == "." {
            i += 1
            var digits = ""
            while i < scalars.count, scalars[i].value >= 48, scalars[i].value <= 57 {
                digits.unicodeScalars.append(scalars[i]); i += 1
            }
            // Milliseconds = fractional seconds truncated to 3 places.
            let padded = (digits + "000").prefix(3)
            fracMs = Int(padded) ?? 0
        }
        if i < scalars.count {
            let sign = scalars[i]
            if sign == "Z" {
                offsetSec = 0
            } else if sign == "+" || sign == "-" {
                i += 1
                let oh = readInt(2)
                var om = 0
                if i < scalars.count, scalars[i] == ":" { i += 1; om = readInt(2) }
                offsetSec = (oh * 3600 + om * 60) * (sign == "-" ? -1 : 1)
            }
        }
    }
    let days = daysFromCivil(year, month, day)
    let totalSeconds = days * 86400 + Int64(hour * 3600 + minute * 60 + second) - Int64(offsetSec)
    return totalSeconds * 1000 + Int64(fracMs)
}

/// Days since 1970-01-01 (Howard Hinnant's civil algorithm).
func daysFromCivil(_ y: Int, _ m: Int, _ d: Int) -> Int64 {
    let y2 = m <= 2 ? y - 1 : y
    let era = (y2 >= 0 ? y2 : y2 - 399) / 400
    let yoe = y2 - era * 400
    let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return Int64(era) * 146097 + Int64(doe) - 719468
}

/// (year, month, day) from days since 1970-01-01.
func civilFromDays(_ z0: Int64) -> (Int, Int, Int) {
    let z = z0 + 719468
    let era = (z >= 0 ? z : z - 146096) / 146097
    let doe = z - era * 146097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return (Int(m <= 2 ? y + 1 : y), Int(m), Int(d))
}

// MARK: - scalar / metric_points (port of build.py)

func pyStr(_ n: NSNumber) -> String {
    let t = String(cString: n.objCType)
    if t == "d" || t == "f" { return numberRepr(n.doubleValue) }
    return String(n.int64Value)
}

/// major version = str(v).split(".")[0]
func major(_ v: Any) -> String {
    let s: String
    if let str = v as? String { s = str } else if let num = v as? NSNumber { s = pyStr(num) } else { s = "\(v)" }
    if let dot = s.firstIndex(of: ".") { return String(s[..<dot]) }
    return s
}

/// (kind, value) for a scalar commit value, or nil to skip. Booleans fold into
/// int (Python bool is an int subclass), so no special case is needed.
func scalar(_ value: Any) -> (String, PointValue)? {
    if let num = value as? NSNumber {
        let t = String(cString: num.objCType)
        if t == "d" || t == "f" { return ("count", .double(num.doubleValue)) }
        return ("count", .int(num.int64Value))
    }
    if let dict = value as? [String: Any] {
        let count = dict.values.reduce(into: Int64(0)) { acc, v in if !(v is NSNull) { acc += 1 } }
        return ("adoption", .int(count))
    }
    return nil
}

func metricPoints(_ m: [String: Any]) -> (String, [Point]) {
    let name = m["name"] as? String ?? ""
    let commits = m["commits"] as? [[String: Any]] ?? []
    if name == "SWIFT_VERSION" {
        var points: [Point] = []
        for c in commits {
            guard let dict = c["value"] as? [String: Any] else { continue }
            var counts: [String: Int] = [:]
            for v in dict.values where !(v is NSNull) {
                counts[major(v), default: 0] += 1
            }
            if !counts.isEmpty {
                let hist = counts.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
                points.append(Point(ts: toMs(c["timestamp"] as? String ?? ""), value: .histogram(hist)))
            }
        }
        // Stable sort by timestamp (matches Python's sort(key=lambda p: p[0])).
        points = points.enumerated().sorted { a, b in
            a.element.ts != b.element.ts ? a.element.ts < b.element.ts : a.offset < b.offset
        }.map(\.element)
        return ("versions", points)
    }
    var kind = "count"
    var points: [Point] = []
    for c in commits {
        guard let (k, v) = scalar(c["value"] ?? NSNull()) else { continue }
        kind = k
        points.append(Point(ts: toMs(c["timestamp"] as? String ?? ""), value: v))
    }
    // Python points.sort() orders by [ts, value].
    points.sort { a, b in a.ts != b.ts ? a.ts < b.ts : scalarLess(a.value, b.value) }
    return (kind, points)
}

func scalarLess(_ a: PointValue, _ b: PointValue) -> Bool {
    func d(_ v: PointValue) -> Double {
        switch v {
        case let .int(x): return Double(x)
        case let .double(x): return x
        case .histogram: return 0
        }
    }
    return d(a) < d(b)
}

// MARK: - Banker's rounding (Python round)

func pyRound(_ x: Double) -> Int64 { Int64(x.rounded(.toNearestOrEven)) }

// MARK: - resolve_series

func resolveSeries(_ chart: [String: Any], _ metricNames: [String]) -> [(String, String)] {
    if let prefix = chart["seriesPrefix"] as? String {
        return metricNames.sorted().filter { $0.hasPrefix(prefix) }
            .map { ($0, String($0.dropFirst(prefix.count))) }
    }
    let series = chart["series"] as? [String] ?? []
    return series.map { ($0, $0) }
}

// MARK: - main

let root = FileManager.default.currentDirectoryPath

func readData(_ path: String) -> Data {
    (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data()
}

let chartsData = readData("\(root)/charts.json")
let charts = (try? JSONSerialization.jsonObject(with: chartsData)) as? [[String: Any]] ?? []

let inputData: Data
if CommandLine.arguments.count >= 2 {
    inputData = readData(CommandLine.arguments[1])
} else {
    inputData = FileHandle.standardInput.readDataToEndOfFile()
}
let doc = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]

var metrics: [String: Metric] = [:]
for m in (doc["metrics"] as? [[String: Any]] ?? []) {
    let (kind, points) = metricPoints(m)
    if !points.isEmpty, let name = m["name"] as? String {
        metrics[name] = Metric(name: name, kind: kind, points: points)
    }
}

// SwiftUI = View; UIKit = UIView + UIViewController — derived from fresh type
// counts, never collected, so the share chart and hero track the latest commit.
@MainActor func summed(_ names: [String]) -> [Point] {
    var acc: [Int64: Int64] = [:]
    for n in names {
        for p in metrics[n]?.points ?? [] {
            if case let .int(v) = p.value { acc[p.ts, default: 0] += v }
        }
    }
    return acc.sorted { $0.key < $1.key }.map { Point(ts: $0.key, value: .int($0.value)) }
}

if let view = metrics["View"] {
    metrics["SwiftUI"] = Metric(name: "SwiftUI", kind: "count", points: view.points)
}
let uikit = summed(["UIView", "UIViewController"])
if !uikit.isEmpty {
    metrics["UIKit"] = Metric(name: "UIKit", kind: "count", points: uikit)
}

// Shared x-axis bounds across every series any chart draws (selfBounds-agnostic).
let metricNames = Array(metrics.keys)
var used = Set<String>()
for c in charts {
    for (n, _) in resolveSeries(c, metricNames) where metrics[n] != nil { used.insert(n) }
}
let allTs = used.flatMap { metrics[$0]!.points.map(\.ts) }
let minTs = allTs.min()!
let maxTs = allTs.max()!

// Headline stats — recomputed every build.
var heroJSON = "{}"
if let sv = metrics["SWIFT_VERSION"], case let .histogram(last) = sv.points.last?.value {
    let total = last.reduce(0) { $0 + $1.1 }
    let six = last.first { $0.0 == "6" }?.1 ?? 0
    let pct = total != 0 ? pyRound(Double(six) / Double(total) * 100) : 0
    heroJSON = "{\"swift6Pct\":\(pct),\"swift6Total\":\(total)}"
}

// Per-chart files: only the drawn series, in chart order.
let chartsDir = "\(root)/data/charts"
try? FileManager.default.createDirectory(atPath: chartsDir, withIntermediateDirectories: true)
for c in charts {
    let id = c["id"] as? String ?? ""
    let seriesJSON = resolveSeries(c, metricNames).compactMap { pair -> String? in
        guard let metric = metrics[pair.0] else { return nil }
        let pts = metric.points.map { $0.json() }.joined(separator: ",")
        return "{\"name\":\(jsonString(pair.1)),\"kind\":\(jsonString(metric.kind)),\"points\":[\(pts)]}"
    }.joined(separator: ",")
    let body = "{\"series\":[\(seriesJSON)]}"
    try? body.write(toFile: "\(chartsDir)/\(id).json", atomically: true, encoding: .utf8)
}

let repoJSON: String
if let repo = doc["repo"] as? String { repoJSON = jsonString(repo) } else { repoJSON = "null" }
let years = max(1, pyRound((Double(maxTs) - Double(minTs)) / (365.25 * DAY_MS)))
let meta = "{\"repo\":\(repoJSON),\"updated\":\(maxTs),\"bounds\":{\"min\":\(minTs),\"max\":\(maxTs)},\"years\":\(years),\"hero\":\(heroJSON)}"
try? meta.write(toFile: "\(root)/data/meta.json", atomically: true, encoding: .utf8)

// Inline the "updated" date so the page doesn't flicker a "—" while meta loads.
let (dy, dm, dd) = civilFromDays(maxTs / 1000 / 86400)
let date = String(format: "%04d-%02d-%02d", dy, dm, dd)
let indexPath = "\(root)/index.html"
if var html = try? String(contentsOfFile: indexPath, encoding: .utf8) {
    let re = try! NSRegularExpression(pattern: "(<b id=\"updated\">)[^<]*(</b>)")
    let range = NSRange(html.startIndex..., in: html)
    html = re.stringByReplacingMatches(in: html, range: range, withTemplate: "$1\(date)$2")
    try? html.write(toFile: indexPath, atomically: true, encoding: .utf8)
}
