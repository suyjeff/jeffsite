import SwiftUI
import UIKit

// MARK: - Color tokens (from the Figma file, with dark-mode counterparts)

extension Color {
    /// Page background. Figma #F3F1F3.
    static let canvas = Color(light: 0xF3F1F3, dark: 0x131114)
    /// Card surface. Figma #FAFAFA.
    static let surface = Color(light: 0xFAFAFA, dark: 0x1D1A1E)
    /// Dividers and outlines. Figma #E7E4E7.
    static let hairline = Color(light: 0xE7E4E7, dark: 0x2D282E)
    /// Primary text. Figma #463947.
    static let ink = Color(light: 0x463947, dark: 0xF1ECF2)
    /// Labels. Figma #79697B.
    static let inkSecondary = Color(light: 0x79697B, dark: 0xA797A9)
    /// Icons and other glyphs that carry state (✓, ✕, ⋯, rings). Graphics only, never text:
    /// it clears the 3:1 that meaningful graphics need on both backgrounds, not the 4.5:1
    /// text needs. (The Figma's #A89EA9 read at 2.5:1, too faint for its finished-row labels;
    /// text now steps down to `inkSecondary` instead.)
    static let inkMuted = Color(light: 0x908292, dark: 0x7B6E7D)
    /// Ruler ticks, disabled controls and decorative marks only. Figma #D7D0D7.
    static let inkFaint = Color(light: 0xD7D0D7, dark: 0x4B414C)
    /// The glass tint on buttons. Figma #79697B.
    static let plum = Color(light: 0x79697B, dark: 0x9A87A0)
    /// Glyphs sitting on a plum fill (white clears 3:1 in both appearances).
    static let onPlum = Color.white
    /// Text on a plum fill. White fails 4.5:1 on dark mode's lighter plum, so text flips dark.
    static let onPlumText = Color(light: 0xFFFFFF, dark: 0x1D1520)
    /// The one strong accent: the create button. Deeper and more saturated than `plum` so the
    /// primary action stands apart from the quieter plum controls, without shouting.
    static let plumStrong = Color(light: 0x56305F, dark: 0xC4A1CB)
    /// The glyph on `plumStrong`.
    static let onPlumStrong = Color(light: 0xFFFFFF, dark: 0x1D1520)
    /// The 1px ring in the card shadow stack.
    static let cardRing = Color(light: 0x26262B, lightAlpha: 0.05, dark: 0xFFFFFF, darkAlpha: 0.06)
    static let cardShadow = Color(red: 38 / 255, green: 38 / 255, blue: 43 / 255)

    init(light: UInt32, lightAlpha: CGFloat = 1, dark: UInt32, darkAlpha: CGFloat = 1) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark, alpha: darkAlpha)
                : UIColor(hex: light, alpha: lightAlpha)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

// MARK: - Type

/// Plus Jakarta Sans for content, Geist Mono for labels, as in the design.
/// Every style scales with Dynamic Type relative to a matching text style.
extension Font {
    static let cadenceTitle = Font.custom("PlusJakartaSans-SemiBold", size: 20, relativeTo: .title3)
    static let cadenceBody = Font.custom("PlusJakartaSans-SemiBold", size: 17, relativeTo: .body)
    static let cadenceBodyMedium = Font.custom("PlusJakartaSans-Medium", size: 17, relativeTo: .body)
    static let cadenceCallout = Font.custom("PlusJakartaSans-SemiBold", size: 15, relativeTo: .callout)
    static let cadenceSubhead = Font.custom("PlusJakartaSans-Medium", size: 15, relativeTo: .subheadline)
    static let cadenceLabel = Font.custom("GeistMono-Medium", size: 14, relativeTo: .footnote)
    static let cadenceCaption = Font.custom("GeistMono-Medium", size: 12, relativeTo: .caption)
    static let cadenceMicro = Font.custom("GeistMono-Regular", size: 11, relativeTo: .caption2)

    static func cadenceNumber(_ size: CGFloat) -> Font {
        .custom("PlusJakartaSans-Bold", size: size, relativeTo: .largeTitle)
    }
}

// MARK: - Layout

enum Metrics {
    /// Screen margin. Figma: 24.
    static let gutter: CGFloat = 24
    /// Card corner. Figma: 20.
    static let cardRadius: CGFloat = 20
    /// Inner padding of card sections. Figma: 24 horizontal, 20 vertical on rows.
    static let cardPadding: CGFloat = 24
    static let rowVertical: CGFloat = 20
    /// Gap between a label and its text. Figma: 12.
    static let labelGap: CGFloat = 12
    /// How far the next card in the deck peeks above the front one. Figma: 10.
    static let deckPeek: CGFloat = 10
    /// Room the floating Create button needs at the bottom of the page.
    static let createClearance: CGFloat = 76
    /// Back card width ÷ front card width. Figma: 348 / 372.
    static let deckScaleStep: CGFloat = 1 - 348.0 / 372.0
}

// MARK: - Card surface

/// The Figma card: #FAFAFA, 20pt corners, a three-layer shadow
/// (1px contact shadow, 1px ring, soft drop). Shadows live on the background
/// shape only, so content isn't shadowed and the card stays cheap to move.
struct CardSurface: ViewModifier {
    var radius: CGFloat = Metrics.cardRadius
    var elevated = true

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .clipShape(shape)
            .background {
                shape
                    .fill(Color.surface)
                    .shadow(color: Color.cardShadow.opacity(elevated ? 0.16 : 0.08), radius: 0.5, x: 0, y: 1)
                    .shadow(color: Color.cardShadow.opacity(elevated ? 0.13 : 0.05), radius: 7, x: 0, y: 7)
            }
            .overlay {
                shape.strokeBorder(Color.cardRing, lineWidth: 1)
            }
    }
}

extension View {
    func cardSurface(radius: CGFloat = Metrics.cardRadius, elevated: Bool = true) -> some View {
        modifier(CardSurface(radius: radius, elevated: elevated))
    }
}

// MARK: - Small shared pieces

struct Hairline: View {
    var axis: Axis = .horizontal

    var body: some View {
        Rectangle()
            .fill(Color.hairline)
            .frame(width: axis == .vertical ? 1 : nil, height: axis == .horizontal ? 1 : nil)
    }
}

/// "TRAINING" style label.
struct MonoLabel: View {
    let text: String
    var color: Color = .inkSecondary
    var style: Font = .cadenceLabel

    var body: some View {
        Text(text)
            .font(style)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

/// The "2/7" pill in a card's header strip.
struct CountPill: View {
    let done: Int
    let total: Int

    var body: some View {
        Text("\(done)/\(total)")
            .font(.cadenceLabel)
            .monospacedDigit()
            .foregroundStyle(Color.inkSecondary)
            .contentTransition(.numericText(value: Double(done)))
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(Color.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 1))
            .accessibilityLabel("\(done) of \(total) done")
    }
}

/// The grey strip at the top of week and month cards: plan name and progress.
struct CardHeaderStrip<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            MonoLabel(text: title.uppercased())
            Spacer(minLength: 12)
            trailing
        }
        .padding(.horizontal, Metrics.cardPadding)
        .padding(.vertical, 8)
        .frame(minHeight: 41)
        .background(Color.canvas)
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(.rect)
    }
}

/// A check drawn as a path so it can be stroked on with `trim`.
struct CheckmarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.14, y: rect.minY + rect.height * 0.55))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.40, y: rect.minY + rect.height * 0.80))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.88, y: rect.minY + rect.height * 0.22))
        return path
    }
}
