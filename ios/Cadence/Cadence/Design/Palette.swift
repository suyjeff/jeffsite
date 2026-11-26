import SwiftUI
import UIKit

/// The neutral palettes from Tailwind CSS (v4.3), as sRGB. The design was drawn in Mauve:
/// its canvas, surface, hairline, ink and labels are Mauve 100, 50, 200, 700 and 500.
/// Every neutral in the app is taken from the chosen palette, so a theme recolors it all.
enum Palette: String, CaseIterable, Identifiable, Sendable {
    case mauve, taupe, olive, mist, zinc

    static let storageKey = "palette"

    /// Read when colors resolve. Set it before re-rendering (Settings does both).
    nonisolated(unsafe) static var current: Palette =
        Palette(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .mauve

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    /// One step of the scale, or one of the two text shades derived from it.
    enum Tone {
        case shade(Int)
        /// Between 500 and 600: the lightest that still reads at 4.5:1 on the canvas.
        case secondary
        /// Between 400 and 500: the lightest that still reads at 3:1 on a card (glyphs).
        case muted
    }

    func hex(_ tone: Tone) -> UInt32 {
        switch tone {
        case .shade(let step): shades[step] ?? 0x808080
        case .secondary: derived.secondary
        case .muted: derived.muted
        }
    }

    private var derived: (secondary: UInt32, muted: UInt32) {
        switch self {
        case .mauve: (0x706172, 0x988C99)
        case .taupe: (0x71635E, 0x9A8E89)
        case .olive: (0x686856, 0x92927F)
        case .mist: (0x5A696D, 0x859397)
        case .zinc: (0x64646E, 0x8F8F99)
        }
    }

    var shades: [Int: UInt32] {
        switch self {
        case .mauve: [50: 0xFAFAFA, 100: 0xF3F1F3, 200: 0xE7E4E7, 300: 0xD7D0D7, 400: 0xA89EA9, 500: 0x79697B, 600: 0x594C5B, 700: 0x463947, 800: 0x2A212C, 900: 0x1D161E, 950: 0x0C090C]
        case .taupe: [50: 0xFBFAF9, 100: 0xF3F1F1, 200: 0xE8E4E3, 300: 0xD8D2D0, 400: 0xABA09C, 500: 0x7C6D67, 600: 0x5B4F4B, 700: 0x473C39, 800: 0x2B2422, 900: 0x1D1816, 950: 0x0C0A09]
        case .olive: [50: 0xFBFBF9, 100: 0xF4F4F0, 200: 0xE8E8E3, 300: 0xD8D8D0, 400: 0xABAB9C, 500: 0x7C7C67, 600: 0x5B5B4B, 700: 0x474739, 800: 0x2B2B22, 900: 0x1D1D16, 950: 0x0C0C09]
        case .mist: [50: 0xF9FBFB, 100: 0xF1F3F3, 200: 0xE3E7E8, 300: 0xD0D6D8, 400: 0x9CA8AB, 500: 0x67787C, 600: 0x4B585B, 700: 0x394447, 800: 0x22292B, 900: 0x161B1D, 950: 0x090B0C]
        case .zinc: [50: 0xFAFAFA, 100: 0xF4F4F5, 200: 0xE4E4E7, 300: 0xD4D4D8, 400: 0x9F9FA9, 500: 0x71717B, 600: 0x52525C, 700: 0x3F3F46, 800: 0x27272A, 900: 0x18181B, 950: 0x09090B]
        }
    }
}

extension Color {
    /// A color from the current palette, `light` in light mode and `dark` in dark mode.
    static func palette(_ light: Palette.Tone, dark: Palette.Tone, alpha: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { traits in
            let palette = Palette.current
            let tone = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(hex: palette.hex(tone), alpha: alpha)
        })
    }
}
