import AppIntents
import SwiftUI
import WidgetKit

// Shows up under Settings > Action Button > Controls, and in Control Center / Lock Screen.
struct CaptureControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.bensonperry.bagofholding.capture") {
            ControlWidgetButton(action: OpenCaptureIntent()) {
                Label("capture", systemImage: "mic.fill")
            }
        }
        .displayName("capture to bag")
        .description("opens bag of holding already recording. tap to send.")
    }
}

// Runs in the extension, so it can't touch the app; it opens the app through a URL instead.
struct OpenCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "capture to bag"
    static var description = IntentDescription("opens bag of holding already recording.")

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "bagofholding://capture")!))
    }
}

@main
struct BagOfHoldingControlsBundle: WidgetBundle {
    var body: some Widget {
        CaptureControl()
    }
}
