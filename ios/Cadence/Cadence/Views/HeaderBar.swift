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

    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

/// The header from the design: "Today ⌄" opens the view menu on the left. On the right, one
/// Liquid Glass pill holds ⋯ (everything else) and + (add a plan), the way system toolbars
/// group related buttons. Each half opens its own menu.
struct HeaderBar: View {
    let mode: ViewMode
    var viewMenu: (CGRect) -> MenuRequest
    var moreMenu: (CGRect) -> MenuRequest
    var addMenu: (CGRect) -> MenuRequest

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
            .frame(height: 44)
            .padding(.trailing, 16)
            .contentShape(.rect)
            .pressMenu(label: "View: \(mode.title)", viewMenu)

            Spacer(minLength: 8)

            HStack(spacing: 0) {
                PillGlyph(systemName: "ellipsis")
                    .pressMenu(label: "More", moreMenu)
                PillGlyph(systemName: "plus")
                    .pressMenu(label: "New plan", addMenu)
            }
            .padding(.horizontal, 4)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .padding(.leading, Metrics.gutter - 2)
        .padding(.trailing, Metrics.gutter - 6)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }
}

/// One button inside the header pill.
private struct PillGlyph: View {
    let systemName: String

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.ink)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}

extension Int {
    func clamped(_ lower: Int, _ upper: Int) -> Int { Swift.min(Swift.max(self, lower), upper) }
}
