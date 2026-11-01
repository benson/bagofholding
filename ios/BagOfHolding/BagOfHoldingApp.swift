import SwiftUI

@main
struct BagOfHoldingApp: App {
    @StateObject private var model = CaptureModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            CaptureView()
                .environmentObject(model)
                .onAppear { model.becameActive() }
                .onOpenURL { url in
                    log.info("open url \(url.absoluteString, privacy: .public)")
                    if url.host == "capture" { model.requestAutoRecord() }
                }
                .tint(BagStyle.accent)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.becameActive() }
            if phase == .background { model.wentToBackground() }
        }
    }
}
