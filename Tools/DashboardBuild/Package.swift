// swift-tools-version:6.0
import PackageDescription

// Two executables that port the data pipeline scripts (see README § Data pipeline):
//   build           — mcm dump → data/meta.json + data/charts/<id>.json, and inline
//                     the "updated" date into index.html.
//   build-roadmap   — roadmap/*.json → board + dialogs injected into index.html.
// Foundation only, no external dependencies; builds on macOS and Linux (deploy).
let package = Package(
    name: "DashboardBuild",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "build"),
        .executableTarget(name: "build-roadmap"),
    ]
)
