import Foundation

enum Settings {
    static let defaultServer = "https://bagofholding-api.bensonperry.workers.dev"

    static var server: String {
        get { UserDefaults.standard.string(forKey: "server").flatMap { $0.isEmpty ? nil : $0 } ?? defaultServer }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }

    static var key: String {
        get { UserDefaults.standard.string(forKey: "key") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "key") }
    }

    static var isConfigured: Bool { !key.isEmpty }
}
