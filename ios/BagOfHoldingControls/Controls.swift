import AppIntents
import SwiftUI
import WidgetKit

// Shows up under Settings > Action Button > Controls, and in Control Center / Lock Screen.
struct CaptureControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.bensonperry.bagofholding.capture") {
            ControlWidgetButton(action: CaptureIntent()) {
                Label("capture", systemImage: "mic.fill")
            }
        }
        .displayName("capture to bag")
        .description("opens bag of holding already recording. tap to send.")
    }
}

@main
struct BagOfHoldingControlsBundle: WidgetBundle {
    var body: some Widget {
        CaptureControl()
    }
}
