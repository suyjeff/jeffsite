import SwiftUI

enum ViewMode: String, CaseIterable, Identifiable {
    case today, week, month, scrolling

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .week: "Week"
        case .month: "Month"
        case .scrolling: "Scrolling"
        }
    }
}

/// "Today ⌄" on the left (a Liquid Glass menu, as in the design), plan dots in the middle,
/// the edit button on the right.
struct HeaderBar: View {
    @Binding var mode: ViewMode
    let plans: [Plan]
    @Binding var frontID: UUID?
    var onEdit: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                Picker("View", selection: $mode.animation(Motion.standard)) {
                    ForEach(ViewMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
            } label: {
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
                .padding(.vertical, 10)
                .padding(.trailing, 20)
                .contentShape(.rect)
            }
            .accessibilityLabel("View: \(mode.title)")
            .accessibilityHint("Choose Today, Week, Month or Scrolling")

            Spacer(minLength: 8)

            GlassIconButton(systemName: "square.and.pencil", voiceOverLabel: "Edit plans", action: onEdit)
        }
        .overlay {
            if plans.count > 1 {
                PlanDots(plans: plans, frontID: $frontID)
            }
        }
        .padding(.horizontal, Metrics.gutter - 2)
        .padding(.top, 13)
        .sensoryFeedback(.selection, trigger: mode)
    }
}

/// Which plan is at the front of the deck. Behaves like a page control: tap a dot, or
/// slide a finger along the capsule to scrub through plans with a detent per plan.
/// Each dot owns a fixed-width slot, so the active dot growing never shifts the others.
struct PlanDots: View {
    let plans: [Plan]
    @Binding var frontID: UUID?

    private let slot: CGFloat = 18
    private let inset: CGFloat = 8

    var body: some View {
        let activeIndex = plans.firstIndex { $0.id == frontID } ?? 0

        HStack(spacing: 0) {
            ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                Capsule()
                    .fill(index == activeIndex ? Color.plum : Color.inkFaint)
                    .frame(width: index == activeIndex ? 14 : 6, height: 6)
                    .frame(width: slot)
            }
        }
        .padding(.horizontal, inset)
        .frame(height: 26)
        .glassEffect(.regular, in: .capsule)
        .frame(height: 44)
        .contentShape(.rect)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in select(at: value.location.x) }
        )
        .animation(Motion.snappy, value: activeIndex)
        .accessibilityElement()
        .accessibilityLabel("Plan")
        .accessibilityValue(plans.indices.contains(activeIndex) ? "\(plans[activeIndex].name), \(activeIndex + 1) of \(plans.count)" : "")
        .accessibilityAdjustableAction { direction in
            let step = direction == .increment ? 1 : -1
            let next = (activeIndex + step + plans.count) % plans.count
            withAnimation(Motion.deck) { frontID = plans[next].id }
        }
    }

    private func select(at x: CGFloat) {
        guard !plans.isEmpty else { return }
        let index = Int(((x - inset) / slot).rounded(.down)).clamped(0, plans.count - 1)
        let id = plans[index].id
        guard id != frontID else { return }
        Feedback.play(.cycle)
        withAnimation(Motion.deck) { frontID = id }
    }
}

extension Int {
    func clamped(_ lower: Int, _ upper: Int) -> Int { Swift.min(Swift.max(self, lower), upper) }
}
