import CoreLocation

final class LocationOnce: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private(set) var last: (lat: Double, lng: Double)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func refresh() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        default: break
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { manager.requestLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let l = locations.last { last = (l.coordinate.latitude, l.coordinate.longitude) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
