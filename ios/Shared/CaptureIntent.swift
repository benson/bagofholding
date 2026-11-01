import AppIntents

// Compiled into both the app and the controls extension. openAppWhenRun makes the
// system launch the app and perform the intent there, where CaptureModel exists.
struct CaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "capture to bag"
    static var description = IntentDescription("opens bag of holding already recording. tap to send.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !CONTROLS_EXTENSION
        CaptureModel.shared.requestAutoRecord()
        #endif
        return .result()
    }
}
