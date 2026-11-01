import SwiftUI
import UIKit
import os

let log = Logger(subsystem: "com.bensonperry.bagofholding", category: "capture")

@MainActor
final class CaptureModel: ObservableObject {
    static let shared = CaptureModel()

    enum Phase: Equatable { case idle, recording, sending, sent, failed(String) }

    @Published var phase: Phase = .idle
    @Published var level: Float = 0
    @Published var text = ""
    @Published var pendingImage: UIImage?
    @Published var autoRecording = false   // started by the action button; tap to send
    @Published var recent: [Item] = []
    @Published var elapsed: TimeInterval = 0

    private let recorder = Recorder()
    private let location = LocationOnce()
    private var meter: Timer?
    private var autoRecordRequested = false
    private var resetTask: Task<Void, Never>?

    private init() {
        Uploader.shared.onFinish = { [weak self] err in
            guard let self else { return }
            if let err { log.error("upload failed: \(err.localizedDescription)"); self.phase = .failed(err.localizedDescription) } else { log.info("upload done"); self.phase = .sent; Task { await self.loadRecent() } }
            self.scheduleReset()
        }
    }

    // MARK: lifecycle

    func becameActive() {
        log.info("active; configured=\(Settings.isConfigured)")
        location.refresh()
        Task { await loadRecent() }
        // Launch argument for scripted simulator checks: -debugSend "some text"
        if let t = UserDefaults.standard.string(forKey: "debugSend"), !t.isEmpty {
            UserDefaults.standard.removeObject(forKey: "debugSend")
            text = t
            sendText()
        }
        if autoRecordRequested {
            autoRecordRequested = false
            Task { await startRecording(auto: true) }
        }
    }

    func wentToBackground() {
        if phase == .recording { Task { await stopAndSend() } }
    }

    /// Called by the action-button intent before the app is in the foreground.
    func requestAutoRecord() {
        autoRecordRequested = true
        if UIApplication.shared.applicationState == .active {
            autoRecordRequested = false
            Task { await startRecording(auto: true) }
        }
    }

    // MARK: recording

    func startRecording(auto: Bool = false) async {
        guard phase != .recording else { return }
        guard await recorder.requestPermission() else { fail("microphone not allowed"); return }
        do {
            try recorder.start()
            autoRecording = auto
            phase = .recording
            elapsed = 0
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            meter?.invalidate()
            meter = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.level = self.recorder.level
                    self.elapsed += 0.05
                    if self.elapsed > 120 { await self.stopAndSend() }
                }
            }
        } catch {
            fail(error.localizedDescription)
        }
    }

    func stopAndSend() async {
        guard phase == .recording else { return }
        meter?.invalidate(); meter = nil
        level = 0
        autoRecording = false
        let url = recorder.stop()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        guard url != nil || pendingImage != nil else { phase = .idle; return }
        send(CapturePayload(text: nil, note: text.isEmpty ? nil : text, audioURL: url, image: pendingImage, location: location.last))
    }

    func cancelRecording() {
        meter?.invalidate(); meter = nil
        level = 0
        autoRecording = false
        if let url = recorder.stop() { try? FileManager.default.removeItem(at: url) }
        phase = .idle
    }

    // MARK: text / photo

    func sendText() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || pendingImage != nil else { return }
        send(CapturePayload(text: t.isEmpty ? nil : t, note: nil, audioURL: nil, image: pendingImage, location: location.last))
    }

    func sendPhotoAlone() {
        guard pendingImage != nil else { return }
        send(CapturePayload(text: nil, note: text.isEmpty ? nil : text, audioURL: nil, image: pendingImage, location: location.last))
    }

    private func send(_ payload: CapturePayload) {
        log.info("send text=\(payload.text ?? "", privacy: .public) audio=\(payload.audioURL != nil) photo=\(payload.image != nil)")
        phase = .sending
        do {
            try Uploader.shared.send(payload)
            text = ""
            pendingImage = nil
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            fail(error.localizedDescription)
        }
    }

    private func fail(_ message: String) {
        phase = .failed(message)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        scheduleReset()
    }

    private func scheduleReset() {
        resetTask?.cancel()
        resetTask = Task {
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            if !Task.isCancelled, phase != .recording { phase = .idle }
        }
    }

    // MARK: recent

    struct Item: Decodable, Identifiable {
        let id: String
        let kind: String
        let status: String
        let title: String?
        let summary: String?
        let tags: [String]
        let created_at: String
    }

    func loadRecent() async {
        guard Settings.isConfigured, let url = URL(string: Settings.server + "/items?limit=30") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(Settings.key)", forHTTPHeaderField: "Authorization")
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return }
        struct Wrap: Decodable { let items: [Item] }
        if let wrap = try? JSONDecoder().decode(Wrap.self, from: data) { recent = wrap.items }
    }
}
