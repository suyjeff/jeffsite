import SwiftUI

extension EnvironmentValues {
    /// Where pinned card headers stick, in the scroll view's coordinates: the bottom of the
    /// floating header bar.
    @Entry var stickyTop: CGFloat = 0
}

/// A card on a scrolling page whose header (title strip, period bar, weekday names) pins
/// under the app's header while the rest scrolls beneath it.
///
/// The header is a pinned section header, so it moves in the same layout pass as the scroll
/// (no lag, real hit targets). The card's rounded outline follows the header down: what's
/// scrolled above it is cut away, so the card always reads as a whole card, its top corners
/// riding on the pinned header.
struct StickyCard<Header: View, Content: View>: View {
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    @Environment(\.stickyTop) private var stickyTop

    var body: some View {
        LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
            Section {
                content
            } header: {
                header
                    .background(Color.surface)
            }
        }
        .background(Color.surface)
        .mask { CardOutline(top: stickyTop, style: .mask) }
        .background { CardOutline(top: stickyTop, style: .shadow) }
        .overlay { CardOutline(top: stickyTop, style: .ring) }
    }
}

/// The card's shape from wherever its visible top is (its own top, or the pinned header) down
/// to its bottom. Read from geometry during layout, so it stays locked to the header.
private struct CardOutline: View {
    enum Style { case mask, shadow, ring }

    var top: CGFloat
    var style: Style

    var body: some View {
        GeometryReader { proxy in
            let inset = (top - proxy.frame(in: .scrollView).minY).clamped(0, max(0, proxy.size.height - Metrics.cardRadius * 2))
            let shape = RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
            Group {
                switch style {
                case .mask:
                    shape.fill(.black)
                case .shadow:
                    shape
                        .fill(Color.surface)
                        .shadow(color: Color.cardShadow.opacity(0.16), radius: 0.5, x: 0, y: 1)
                        .shadow(color: Color.cardShadow.opacity(0.13), radius: 7, x: 0, y: 7)
                case .ring:
                    shape.strokeBorder(Color.cardRing, lineWidth: 1)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height - inset)
            .offset(y: inset)
        }
        .allowsHitTesting(false)
    }
}
