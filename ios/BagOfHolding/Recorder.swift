import AVFoundation

final class Recorder: NSObject, AVAudioRecorderDelegate {
    private var recorder: AVAudioRecorder?
    private(set) var startedAt: Date?
    var fileURL: URL?

    func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("capture-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let r = try AVAudioRecorder(url: url, settings: settings)
        r.delegate = self
        r.isMeteringEnabled = true
        guard r.record() else { throw NSError(domain: "recorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "couldn't start recording"]) }
        recorder = r
        fileURL = url
        startedAt = Date()
    }

    /// Returns the file if the recording was long enough to mean anything.
    func stop() -> URL? {
        guard let r = recorder else { return nil }
        r.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        startedAt = nil
        guard duration > 0.4, let url = fileURL else {
            if let url = fileURL { try? FileManager.default.removeItem(at: url) }
            fileURL = nil
            return nil
        }
        fileURL = nil
        return url
    }

    var level: Float {
        guard let r = recorder else { return 0 }
        r.updateMeters()
        let db = r.averagePower(forChannel: 0)
        return max(0, min(1, (db + 50) / 50))
    }

    var isRecording: Bool { recorder?.isRecording ?? false }
}
