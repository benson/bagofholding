import AppIntents

struct BagShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureIntent(),
            phrases: ["capture to \(.applicationName)", "put it in the \(.applicationName)", "\(.applicationName) this"],
            shortTitle: "capture",
            systemImageName: "mic.fill"
        )
    }
}
