// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LibraryAPI",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "LibraryAPI", targets: ["App"])
    ],
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.110.0")
    ],
    targets: [
        .executableTarget(
            name: "App",
            dependencies: [
                .product(name: "Vapor", package: "vapor")
            ]
        )
    ]
)
