import SwiftUI

enum ViewMode: String, CaseIterable, Identifiable {
    case today, week, month

    var id: String { rawValue }

    /// The names from the design's view menu.
    var title: String {
        switch self {
        case .today: "Today"
        case .week: "Week"
        case .month: "Month"
        }
    }

    var symbol: String {
        switch self {
        case .today: "rectangle.portrait"
        case .week: "list.bullet"
        case .month: "calendar"
        }
    }

    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

/// The header from the design: "Today ⌄" opens the view menu on the left; the round glass
/// button on the right holds everything else.
///
/// It floats over the page. At rest the title sits bare on the canvas, as in the design; once
/// the page scrolls under it the title gathers into a Liquid Glass capsule (and lets go again
/// back at the top), so it stays legible over whatever passes behind.
struct HeaderBar: View {
    let mode: ViewMode
    var isScrolled: Bool
    var viewMenu: (CGRect) -> MenuRequest
    var moreMenu: (CGRect) -> MenuRequest

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The capsule's padding around the title. At rest the title is pulled back by part of
    /// it so the text keeps the design's position; in the capsule it moves in by the rest.
    private let capsulePadding: CGFloat = 14
    private let restShift: CGFloat = 6

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(mode.title)
                    .font(.cadenceTitle)
                    .tracking(-0.2)
                    .foregroundStyle(Color.ink)
                    .contentTransition(.interpolate)
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.inkSecondary)
            }
            .padding(.horizontal, capsulePadding)
            .frame(height: 44)
            .glassEffect(isScrolled ? .regular.interactive() : .identity, in: .capsule)
            .contentShape(.capsule)
            .offset(x: isScrolled ? 0 : -restShift)
            .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.34, bounce: 0.18), value: isScrolled)
            .pressMenu(label: "View: \(mode.title)", viewMenu)

            Spacer(minLength: 8)

            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.ink)
                .frame(width: 44, height: 44)
                .glassEffect(.regular.interactive(), in: .circle)
                .contentShape(.circle)
                .pressMenu(label: "More", moreMenu)
        }
        // The title's text lands on the design's 22pt margin at rest.
        .padding(.leading, Metrics.gutter - 2 - capsulePadding + restShift)
        .padding(.trailing, Metrics.gutter - 4)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }
}

/// Create, floating bottom right: the one strongly colored control in the app. Custom Liquid
/// Glass tinted deep plum, its glow on a separate layer underneath (a shadow on the glass
/// itself rendered as a square and shimmered while the glass reacted to touch). A tap or a
/// short hold opens a small menu of what you can add.
struct CreateButton: View {
    var menu: (CGRect) -> MenuRequest

    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(Color.onPlumStrong)
            .frame(width: Metrics.createSize, height: Metrics.createSize)
            .glassEffect(.regular.tint(Color.plumStrong).interactive(), in: .circle)
            .background {
                Circle()
                    .fill(Color.plumStrong.opacity(0.3))
                    .blur(radius: 12)
                    .offset(y: 8)
                    .allowsHitTesting(false)
            }
            .contentShape(.circle)
            .pressMenu(label: "New plan", menu)
    }
}

extension Int {
    func clamped(_ lower: Int, _ upper: Int) -> Int { Swift.min(Swift.max(self, lower), upper) }
}
