import Foundation
import UIKit

struct CapturePayload {
    var text: String?
    var note: String?
    var audioURL: URL?
    var image: UIImage?
    var location: (lat: Double, lng: Double)?
}

/// Builds a multipart body and sends it with a short background-time grant,
/// so the app can be dismissed the moment the button is released.
final class Uploader: NSObject {
    static let shared = Uploader()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForResource = 120
        return URLSession(configuration: config)
    }()
    var onFinish: ((Error?) -> Void)?

    func send(_ payload: CapturePayload) throws {
        guard Settings.isConfigured, let url = URL(string: Settings.server + "/capture") else {
            throw NSError(domain: "uploader", code: 1, userInfo: [NSLocalizedDescriptionKey: "set the server key first"])
        }
        let boundary = "boh-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        func file(_ name: String, _ filename: String, _ type: String, _ data: Data) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\nContent-Type: \(type)\r\n\r\n".data(using: .utf8)!)
            body.append(data)
            body.append("\r\n".data(using: .utf8)!)
        }
        field("client", "ios")
        if let t = payload.text, !t.isEmpty { field("text", t) }
        if let n = payload.note, !n.isEmpty { field("note", n) }
        if let loc = payload.location { field("lat", String(loc.lat)); field("lng", String(loc.lng)) }
        if let a = payload.audioURL, let data = try? Data(contentsOf: a) { file("audio", "voice.m4a", "audio/mp4", data) }
        if let img = payload.image, let jpeg = img.resized(maxSide: 1600).jpegData(compressionQuality: 0.85) { file("photo", "photo.jpg", "image/jpeg", jpeg) }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        if let a = payload.audioURL { try? FileManager.default.removeItem(at: a) }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(Settings.key)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var bgTask = UIBackgroundTaskIdentifier.invalid
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "capture upload") {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
        session.uploadTask(with: req, from: body) { [weak self] data, response, error in
            var err = error
            if err == nil, let http = response as? HTTPURLResponse, http.statusCode >= 300 {
                let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                err = NSError(domain: "uploader", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "server said \(http.statusCode) \(detail.prefix(80))"])
            }
            DispatchQueue.main.async {
                self?.onFinish?(err)
                if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
            }
        }.resume()
    }
}

extension UIImage {
    func resized(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in draw(in: CGRect(origin: .zero, size: newSize)) }
    }
}
