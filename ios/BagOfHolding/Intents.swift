import AppIntents

struct StartCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "capture to bag"
    static var description = IntentDescription("opens bag of holding and starts recording. tap to send.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        CaptureModel.shared.requestAutoRecord()
        return .result()
    }
}

struct BagShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartCaptureIntent(),
            phrases: ["capture to \(.applicationName)", "put it in the \(.applicationName)", "\(.applicationName) this"],
            shortTitle: "capture",
            systemImageName: "mic.fill"
        )
    }
}
