// swift-tools-version:5.3

// Capacitor's frameworks with a Mac Catalyst slice, built from source by
// scripts/build-mac-frameworks.sh. The package has the same name as the
// published capacitor-swift-pm, so in the AuroraMac workspace it stands in
// for it, for the app and for every plugin that depends on it.
import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    dependencies: [],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
