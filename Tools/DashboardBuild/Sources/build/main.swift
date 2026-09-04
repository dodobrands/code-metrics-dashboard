import Foundation

// Port of data/build.py. Reads an `codemetrics get` JSON dump (arg or stdin) plus
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
    // One metric carries several shapes over time. Type metrics store the list of
    // found types (a bare count before that switch). Build settings store a record
    // per target, where a null value means the setting could not be read — those
    // records are present but do not count as adoption.
    if let records = value as? [[String: Any]], records.contains(where: { $0["value"] != nil }) {
        let count = records.reduce(into: Int64(0)) { acc, r in if !(r["value"] is NSNull) { acc += 1 } }
        return ("adoption", .int(count))
    }
    if let list = value as? [Any] {
        return ("count", .int(Int64(list.count)))
    }
    if let dict = value as? [String: Any] {
        let count = dict.values.reduce(into: Int64(0)) { acc, v in if !(v is NSNull) { acc += 1 } }
        return ("adoption", .int(count))
    }
    return nil
}

/// Language version per module, folded from the per-target records.
///
/// A module is a project — `Modules/Cart/Cart.xcodeproj` — and it ships several
/// targets: Cart, CartUI, CartTests. It counts as being on a version only once all
/// of them are, so the lowest value in the group wins and one target left behind
/// keeps the whole module out of the Swift 6 bucket. Targets whose setting could not
/// be read are skipped; a project with nothing readable does not appear.
func moduleVersions(_ records: [[String: Any]]) -> [String: Any] {
    var versions: [String: Any] = [:]
    for record in records {
        guard let project = record["project"] as? String,
              let value = record["value"], !(value is NSNull) else { continue }
        let module = (((project as NSString).lastPathComponent) as NSString).deletingPathExtension
        if let seen = versions[module], versionLess(seen, value) { continue }
        versions[module] = value
    }
    return versions
}

/// Numeric comparison of two settings values: `5.10` sorts below `6`.
func versionLess(_ lhs: Any, _ rhs: Any) -> Bool {
    let left = String(describing: lhs).split(separator: ".").map { Int($0) ?? 0 }
    let right = String(describing: rhs).split(separator: ".").map { Int($0) ?? 0 }
    for index in 0 ..< max(left.count, right.count) {
        let a = index < left.count ? left[index] : 0
        let b = index < right.count ? right[index] : 0
        if a != b { return a < b }
    }
    return false
}

func metricPoints(_ m: [String: Any]) -> (String, [Point]) {
    let name = m["name"] as? String ?? ""
    let commits = m["commits"] as? [[String: Any]] ?? []
    if name == "SWIFT_VERSION" {
        var points: [Point] = []
        for c in commits {
            var counts: [String: Int] = [:]
            if let records = c["value"] as? [[String: Any]] {
                for (_, version) in moduleVersions(records) {
                    counts[major(version), default: 0] += 1
                }
            } else if let dict = c["value"] as? [String: Any] {
                // Shape before the service started reporting the declaring project:
                // one entry per target, so these points count targets, not modules.
                for v in dict.values where !(v is NSNull) {
                    counts[major(v), default: 0] += 1
                }
            } else {
                continue
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

/// A toggle group's `shorten` rule, applied to the key after the family prefix: drop
/// whole path segments, strip suffixes, collapse a segment repeated back to back.
/// `contexts/common/payment/payment-impl` -> `common/payment`.
func shortened(_ key: String, _ rule: [String: Any]) -> String {
    let drop = Set(rule["dropSegments"] as? [String] ?? [])
    let suffixes = rule["dropSuffixes"] as? [String] ?? []
    let collapse = rule["collapseRepeats"] as? Bool ?? true
    var out: [String] = []
    for raw in key.split(separator: "/") {
        var seg = String(raw)
        if drop.contains(seg) { continue }
        for s in suffixes where seg.hasSuffix(s) { seg = String(seg.dropLast(s.count)) }
        if collapse, out.last == seg { continue }
        out.append(seg)
    }
    return out.isEmpty ? key : out.joined(separator: "/")
}

func resolveSeries(_ chart: [String: Any], _ metricNames: [String], _ lastTs: [String: Int64]) -> [(String, String)] {
    // A toggle chart draws one of several prefix groups at a time (the client
    // switches). Emit the union of every group's series, keeping the prefix in every
    // name so the client can split them back per group.
    if let toggle = chart["toggle"] as? [[String: Any]] {
        var out: [(String, String)] = []
        for group in toggle {
            guard let prefix = group["seriesPrefix"] as? String else { continue }
            var names = metricNames.sorted().filter { $0.hasPrefix(prefix) }
            // The bar shows each series' last value whatever its date, so a series that
            // stopped getting points (a module renamed away) would keep a bar forever.
            if let newest = names.compactMap({ lastTs[$0] }).max() {
                names = names.filter { lastTs[$0] == newest }
            }
            var pairs = names.map { ($0, $0) }
            if let rule = group["shorten"] as? [String: Any] {
                let shorts = names.map { prefix + shortened(String($0.dropFirst(prefix.count)), rule) }
                var taken: [String: Int] = [:]
                for s in shorts { taken[s, default: 0] += 1 }
                // Two keys that shorten alike keep their full names rather than merge.
                pairs = zip(names, shorts).map { taken[$1] == 1 ? ($0, $1) : ($0, $0) }
            }
            out += pairs
        }
        return out
    }
    if let prefix = chart["seriesPrefix"] as? String {
        return metricNames.sorted().filter { $0.hasPrefix(prefix) }
            .map { ($0, String($0.dropFirst(prefix.count))) }
    }
    // A chart can also carry a grid of per-module series beside its headline pair;
    // both go in the same file, and the client tells them apart by the prefix.
    let series = chart["series"] as? [String] ?? []
    var out = series.map { ($0, $0) }
    if let prefix = chart["moduleSeriesPrefix"] as? String {
        out += metricNames.sorted().filter { $0.hasPrefix(prefix) }.map { ($0, $0) }
    }
    return out
}

// MARK: - BuildWarnings: derive the drawn families from the rich value

// The collector ships ONE `BuildWarnings` metric whose per-commit value is the
// raw issues (`{types:[{name, issues:[{file,line,message}]}]}`). The service
// stores that as-is; the breakdown lives here, so how we slice it (by symbol,
// by module, per type) is a dashboard decision, not baked into what's collected.

/// Deprecated/warned symbol from the message: `'FooView' is deprecated…` →
/// `FooView`. Falls back to the first few words when nothing is quoted.
func warningSymbol(_ message: String) -> String {
    if
        let open = message.firstIndex(of: "'"),
        let close = message[message.index(after: open)...].firstIndex(of: "'") {
        return String(message[message.index(after: open)..<close])
    }
    return message.split(separator: " ").prefix(5).joined(separator: " ")
}

/// SPM module from an issue's resolved path (`Modules/<M>/…`).
func warningModule(_ file: String) -> String {
    if let range = file.range(of: "(?:^|/)Modules/([^/]+)", options: .regularExpression) {
        return String(file[range].split(separator: "/").last ?? "unknown")
    }
    if !file.contains("/") || file.hasSuffix(".generated.swift") { return "Generated/root" }
    return String(file.split(separator: "/").first ?? "unknown")
}

/// The stored history carries this category under two names: commits up to
/// 2025-09-22 use `Deprecation`, later ones `DeprecatedDeclaration`. They mean
/// the same thing, so they fold into one series — read raw, the deprecations
/// chart covers only the later half, and the earlier issues land in the
/// other-warnings bucket through the `else` below.
func canonicalWarningType(_ name: String) -> String {
    name == "Deprecation" ? "DeprecatedDeclaration" : name
}

/// Slice the rich BuildWarnings commits into count metrics the charts draw:
/// `BuildWarnings:<type>` (per-type totals), `OtherWarnings` (everything except
/// deprecations), `DeprecationBySymbol:<symbol>`, `DeprecationByModule:<module>`,
/// `WarningBySymbol:<symbol>`, `WarningByModule:<module>`. Every metric is
/// 0-filled across all commits so the total line stays continuous.
/// Snapshot coverage, split three ways: every view, then SwiftUI and UIKit apart.
///
/// The metric stores a record per view — its name, its file, the base type it comes
/// from, and whether a snapshot test covers it. Coverage is attributed by file:
/// Prefire generates one test class per source file, so every view declared in a
/// covered file counts as covered.
///
/// Each pair goes out under its own prefix so the chart's segmented control can
/// switch between them, and as counts rather than a ratio so the pool's own growth
/// stays visible next to the share.
/// The module a repository-relative path belongs to: `Modules/Cart/…` is Cart,
/// anything under `App/` is the monolith, and a stray path answers with its own
/// first component rather than being dropped.
///
/// `DodoPizza/Cart/…` is Cart too: until #13144 moved the repository to a single
/// root in July 2026, every module lived under that directory. Without this the
/// whole history before the move collapses into one module named after it.
func moduleOf(_ path: String) -> String {
    let parts = path.split(separator: "/")
    guard let first = parts.first else { return "—" }
    if first == "App" { return "App" }
    if first == "Modules", parts.count > 1 { return String(parts[1]) }
    if first == "DodoPizza", parts.count > 1 {
        // The app target sat one level deeper under the same name, the way it now
        // sits under App/ — without this the monolith's history reads as a module
        // called DodoPizza that no longer exists, and App begins on moving day.
        return parts[1].hasPrefix("DodoPizza") ? "App" : String(parts[1])
    }
    return String(first)
}

/// At most `limit` points, evenly spaced, always keeping the last one.
///
/// A sparkline is 150 pixels wide; carrying two thousand points to draw it would
/// spend bandwidth on pixels that do not exist.
func thinned(_ points: [Point], to limit: Int) -> [Point] {
    guard points.count > limit else { return points }
    let step = Double(points.count - 1) / Double(limit - 1)
    var out = (0 ..< limit - 1).map { points[Int((Double($0) * step).rounded())] }
    out.append(points[points.count - 1])
    return out
}

func deriveSnapshotCoverage(_ commits: [[String: Any]]) -> [String: Metric] {
    let pools: [(prefix: String, kinds: Set<String>)] = [
        ("Snapshot:All:", ["View", "UIView", "UIViewController"]),
        ("Snapshot:SwiftUI:", ["View"]),
        ("Snapshot:UIKit:", ["UIView", "UIViewController"]),
    ]
    var points: [String: [Point]] = [:]
    for c in commits {
        guard let views = c["value"] as? [[String: Any]], !views.isEmpty else { continue }
        let ts = toMs(c["timestamp"] as? String ?? "")
        for pool in pools {
            // Records written before the base type was recorded carry no kind. They
            // still count in the whole-repository pool, where no kind is needed, and
            // stay out of the split ones rather than landing in the wrong half.
            let inPool = views.filter { view in
                guard let kind = view["kind"] as? String else { return pool.kinds.count == 3 }
                return pool.kinds.contains(kind)
            }
            guard !inPool.isEmpty else { continue }
            let covered = inPool.reduce(into: Int64(0)) { acc, view in
                if (view["hasSnapshot"] as? Bool) == true { acc += 1 }
            }
            points[pool.prefix + "Covered", default: []].append(Point(ts: ts, value: .int(covered)))
            points[pool.prefix + "Bare", default: []]
                .append(Point(ts: ts, value: .int(Int64(inPool.count) - covered)))
        }
    }
    // How far along each module is, since the whole-repository share says nothing
    // about where to go next. Split the same three ways as the share above, so the
    // question "which modules are behind on SwiftUI" has an answer too. Each module
    // gets its own line over time — a grid of sparklines reads as one picture where
    // forty ranked bars read as a scroll.
    for c in commits {
        guard let views = c["value"] as? [[String: Any]], !views.isEmpty else { continue }
        let ts = toMs(c["timestamp"] as? String ?? "")
        for pool in pools {
            var total: [String: Int] = [:]
            var covered: [String: Int] = [:]
            for view in views {
                if let kind = view["kind"] as? String {
                    guard pool.kinds.contains(kind) else { continue }
                } else if pool.kinds.count < 3 {
                    continue
                }
                let module = moduleOf(view["path"] as? String ?? "")
                total[module, default: 0] += 1
                if (view["hasSnapshot"] as? Bool) == true { covered[module, default: 0] += 1 }
            }
            for (module, count) in total {
                let share = Double(covered[module] ?? 0) / Double(count) * 1000
                points[pool.prefix + "ByModule:" + module, default: []]
                    .append(Point(ts: ts, value: .double(share.rounded() / 10)))
            }
        }
    }

    // Only modules the repository still has. History remembers ones long deleted,
    // and a grid cell reading a flat zero for a module nobody can open is noise.
    let alive = Set(
        (commits.last(where: { ($0["value"] as? [[String: Any]])?.isEmpty == false })?["value"]
            as? [[String: Any]] ?? [])
            .map { moduleOf($0["path"] as? String ?? "") }
    )

    var out: [String: Metric] = [:]
    for (name, unsorted) in points {
        if let range = name.range(of: ":ByModule:"), !alive.contains(String(name[range.upperBound...])) {
            continue
        }
        let sorted = unsorted.sorted { $0.ts < $1.ts }
        out[name] = Metric(
            name: name,
            kind: "count",
            points: name.contains(":ByModule:") ? thinned(sorted, to: 60) : sorted
        )
    }

    // Every module that has an interface at all gets a series in all three pools,
    // empty where it has no views of that kind. The grid then holds the same cells
    // whichever pool is showing, instead of reflowing under the reader's cursor.
    for module in alive {
        for pool in pools where out[pool.prefix + "ByModule:" + module] == nil {
            out[pool.prefix + "ByModule:" + module] =
                Metric(name: pool.prefix + "ByModule:" + module, kind: "count", points: [])
        }
    }
    return out
}

func deriveBuildWarnings(_ commits: [[String: Any]]) -> [String: Metric] {
    var perCommit: [(ts: Int64, counts: [String: Int])] = []
    var names = Set<String>()
    for c in commits {
        let ts = toMs(c["timestamp"] as? String ?? "")
        var counts: [String: Int] = [:]
        func bump(_ name: String) { counts[name, default: 0] += 1; names.insert(name) }
        let value = c["value"] as? [String: Any] ?? [:]
        for group in (value["types"] as? [[String: Any]] ?? []) {
            let typeName = canonicalWarningType(group["name"] as? String ?? "")
            for issue in (group["issues"] as? [[String: Any]] ?? []) {
                let message = issue["message"] as? String ?? ""
                let file = issue["file"] as? String ?? ""
                bump("BuildWarnings:\(typeName)")
                if typeName == "DeprecatedDeclaration" {
                    bump("DeprecationBySymbol:\(warningSymbol(message))")
                    bump("DeprecationByModule:\(warningModule(file))")
                } else {
                    // Deprecations are counted out — they carry their own total
                    // and breakdown, and they dwarf the rest often enough that a
                    // combined line would hide what the others are doing.
                    bump("OtherWarnings")
                    bump("WarningBySymbol:\(warningSymbol(message))")
                    bump("WarningByModule:\(warningModule(file))")
                }
            }
        }
        perCommit.append((ts, counts))
    }
    perCommit.sort { $0.ts < $1.ts }
    var out: [String: Metric] = [:]
    for name in names {
        let points = perCommit.map { Point(ts: $0.ts, value: .int(Int64($0.counts[name] ?? 0))) }
        out[name] = Metric(name: name, kind: "count", points: points)
    }
    return out
}

/// SwiftUI against UIKit per module, over time.
///
/// The type metrics carry the list of types they found with the file each lives in,
/// so the same lists that make the repository-wide share also make it per module —
/// no second collection, no join against anything else.
///
/// Counts rather than a ratio: a module that grew from four views to forty while
/// holding the same share did something a percentage cannot say.
func deriveMigrationByModule(swiftUI: [[String: Any]], uiKit: [[[String: Any]]]) -> [String: Metric] {
    var points: [String: [Point]] = [:]

    func fold(_ commits: [[String: Any]], suffix: String) {
        for c in commits {
            guard let types = c["value"] as? [[String: Any]], !types.isEmpty else { continue }
            let ts = toMs(c["timestamp"] as? String ?? "")
            var perModule: [String: Int64] = [:]
            for type in types {
                perModule[moduleOf(type["path"] as? String ?? ""), default: 0] += 1
            }
            for (module, count) in perModule {
                let key = "Migration:ByModule:" + module + ":" + suffix
                if let index = points[key]?.lastIndex(where: { $0.ts == ts }) {
                    if case let .int(existing) = points[key]![index].value {
                        points[key]![index] = Point(ts: ts, value: .int(existing + count))
                    }
                } else {
                    points[key, default: []].append(Point(ts: ts, value: .int(count)))
                }
            }
        }
    }

    fold(swiftUI, suffix: "SwiftUI")
    for commits in uiKit { fold(commits, suffix: "UIKit") }

    // Modules the repository still has, and both halves present for each: a cell
    // stacks two series, and one of them missing would draw a full bar of the other.
    let alive = Set(
        (swiftUI.last?["value"] as? [[String: Any]] ?? []).map { moduleOf($0["path"] as? String ?? "") }
    ).union(
        Set((uiKit.compactMap { $0.last }.flatMap { ($0["value"] as? [[String: Any]]) ?? [] })
            .map { moduleOf($0["path"] as? String ?? "") })
    )

    var out: [String: Metric] = [:]
    for module in alive {
        for suffix in ["SwiftUI", "UIKit"] {
            let key = "Migration:ByModule:" + module + ":" + suffix
            let sorted = (points[key] ?? []).sorted { $0.ts < $1.ts }
            out[key] = Metric(name: key, kind: "count", points: thinned(sorted, to: 60))
        }
    }
    return out
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
    let name = m["name"] as? String ?? ""
    if name == "BuildWarnings" {
        for (n, metric) in deriveBuildWarnings(m["commits"] as? [[String: Any]] ?? []) {
            metrics[n] = metric
        }
        continue
    }
    if name == "SnapshotCoverage" {
        for (n, metric) in deriveSnapshotCoverage(m["commits"] as? [[String: Any]] ?? []) {
            metrics[n] = metric
        }
        continue
    }
    let (kind, points) = metricPoints(m)
    if !points.isEmpty, !name.isEmpty {
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

// The same type lists, folded per module, so the migration chart can show each
// module's own SwiftUI-to-UIKit balance under the repository's.
let typeCommits = { (name: String) -> [[String: Any]] in
    (doc["metrics"] as? [[String: Any]] ?? [])
        .first { ($0["name"] as? String) == name }?["commits"] as? [[String: Any]] ?? []
}
for (name, metric) in deriveMigrationByModule(
    swiftUI: typeCommits("View"),
    uiKit: [typeCommits("UIView"), typeCommits("UIViewController")]
) {
    metrics[name] = metric
}
let uikit = summed(["UIView", "UIViewController"])
if !uikit.isEmpty {
    metrics["UIKit"] = Metric(name: "UIKit", kind: "count", points: uikit)
}

// Shared x-axis bounds across every series any chart draws (selfBounds-agnostic).
let metricNames = Array(metrics.keys)
let lastTs = metrics.mapValues { $0.points.last?.ts ?? 0 }
var used = Set<String>()
for c in charts {
    for (n, _) in resolveSeries(c, metricNames, lastTs) where metrics[n] != nil { used.insert(n) }
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
    let seriesJSON = resolveSeries(c, metricNames, lastTs).compactMap { pair -> String? in
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
