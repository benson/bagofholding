import SwiftUI

// Paper, ink and one accent, like Tomebound's book style.
enum BagStyle {
    static let paper = adaptive(light: 0xf7f1e3, dark: 0x1d1a16)
    static let card = adaptive(light: 0xfffbf2, dark: 0x26221d)
    static let ink = adaptive(light: 0x2b2521, dark: 0xeee5d3)
    static let muted = adaptive(light: 0x8a7f72, dark: 0x9b9183)
    static let accent = adaptive(light: 0x6f4fa3, dark: 0xb39ddb)
    static let accentSoft = adaptive(light: 0xe9e1f4, dark: 0x3a2f55)
    static let line = adaptive(light: 0xe3d9c6, dark: 0x3a342c)

    static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { trait in
            UIColor(hex: trait.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}
