import SwiftUI

/// A schedule on the Today deck. One column fills the card (Training); several split it
/// evenly with a hairline (Skincare AM / PM). Each part shows its state plainly: settled (a
/// step darker) with a green ✓ when done or a red ✕ when skipped. With two parts, each is
/// tapped to check it off and held to lift just that part.
struct RoutineTodayCard: View {
    let plan: Plan
    let day: Day

    @Environment(Store.self) private var store
    @Environment(\.focusedKey) private var focusedKey
    @State private var ripple = 0

    private var isMulti: Bool { plan.columnCount > 1 }

    var body: some View {
        let items = plan.items(on: day)
        let status = plan.status(on: day)

        VStack(spacing: 0) {
            ForEach(0..<plan.columnCount, id: \.self) { column in
                let text = items.indices.contains(column) ? items[column] : ""
                TodaySection(plan: plan, day: day, column: column, text: text)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .contentShape(.rect)
                    // Simultaneous, so a still finger on a part can still grow into its hold.
                    .simultaneousGesture(TapGesture().onEnded {
                        // The release that ends a hold isn't a tap.
                        guard isMulti, !text.isEmpty, focusedKey == nil else { return }
                        let change = withAnimation(Motion.settle) {
                            store.toggleColumn(plan.id, on: day, column: column)
                        }
                        Feedback.play(for: change, step: column)
                        if change == .completed { ripple += 1 }
                    })
                    .modifier(SectionLift(isEnabled: isMulti && !text.isEmpty, planID: plan.id, day: day, column: column, text: text))
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(isMulti && !text.isEmpty ? .isButton : [])
                    .accessibilityHint(isMulti && !text.isEmpty ? "Double tap to check off \(plan.columns[column].isEmpty ? "this part" : plan.columns[column])" : "")
                if column < plan.columnCount - 1 {
                    Hairline()
                }
            }
        }
        .overlay(alignment: .bottom) {
            footer(status: status)
                .padding(.horizontal, Metrics.cardPadding)
                .padding(.bottom, Metrics.cardPadding - 2)
        }
        .overlay(alignment: .bottomTrailing) {
            InkRipple(trigger: ripple)
                .padding(.trailing, Metrics.cardPadding)
                .padding(.bottom, Metrics.cardPadding - 2)
        }
    }

    // MARK: Footer

    private func footer(status: DayStatus) -> some View {
        HStack(alignment: .center) {
            MonoLabel(text: footerText(status), color: status == .done ? .ink : .inkSecondary)
                .contentTransition(.opacity)
                .animation(Motion.settle, value: footerText(status))
            Spacer()
            if plan.isPlanned(day) {
                CheckButton(
                    look: status == .done ? .done : status == .skipped ? .skipped : .open,
                    fraction: progressFraction(status),
                    voiceOverLabel: "Check off \(plan.name)",
                    action: checkTapped
                )
            }
        }
    }

    private func footerText(_ status: DayStatus) -> String {
        switch status {
        case .done:
            // When it was done shows (muted) only when the card is held.
            return ""
        case .skipped:
            // The red ✕ in the corner says it.
            return ""
        case .partial(let done, let total):
            return "\(done) OF \(total)"
        case .pending:
            let streak = plan.streak(asOf: day)
            return streak >= 2 ? "\(streak) DAY STREAK" : ""
        case .empty:
            return ""
        }
    }

    private func progressFraction(_ status: DayStatus) -> CGFloat {
        if case .partial(let done, let total) = status, total > 0 { return CGFloat(done) / CGFloat(total) }
        return 0
    }

    private func checkTapped() {
        // The release that ends a hold on the check isn't a tap.
        guard focusedKey == nil else { return }
        let change = withAnimation(Motion.settle) {
            if plan.status(on: day) == .skipped {
                return store.toggleSkipped(plan.id, on: day)
            }
            return isMulti ? store.advance(plan.id, on: day) : store.toggleDone(plan.id, on: day)
        }
        let doneCount = store.plan(plan.id).map { updated in
            updated.plannedColumns(on: day).filter { updated.mark(on: day, column: $0) == .done }.count
        } ?? 1
        Feedback.play(for: change, step: max(0, doneCount - 1))
        if change == .completed { ripple += 1 }
    }
}

/// One part of a Today card: the plan's name over the first part, what's planned in large
/// type, and in the corner the part's name (AM, PM) with its ✓ or ✕. Settled parts sit a step
/// darker. Also drawn on its own when the part is held and lifted.
struct TodaySection: View {
    let plan: Plan
    let day: Day
    let column: Int
    let text: String

    var body: some View {
        let mark = plan.mark(on: day, section: column)
        let isPlanned = !text.isEmpty
        let isMulti = plan.columnCount > 1

        VStack(alignment: .leading, spacing: Metrics.labelGap) {
            if column == 0 {
                MonoLabel(text: plan.name.uppercased())
            }
            Text(isPlanned ? text : "Nothing planned")
                .font(.cadenceToday)
                .tracking(-0.5)
                .lineSpacing(4)
                .foregroundStyle(mark != nil || !isPlanned ? Color.inkSecondary : Color.ink)
                .minimumScaleFactor(0.8)
                .animation(Motion.settle, value: mark)
        }
        .padding(Metrics.cardPadding)
        .padding(.trailing, 36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 8) {
                if isMulti, !plan.columns[column].isEmpty {
                    MonoLabel(text: plan.columns[column].uppercased())
                }
                StatusBadge(mark: isPlanned ? mark : nil)
            }
            .padding(.top, Metrics.cardPadding - 2)
            .padding(.trailing, Metrics.cardPadding - 2)
        }
        .background {
            Color.settled
                .opacity(mark != nil && isPlanned ? 1 : 0)
                .animation(Motion.settle, value: mark)
        }
        .accessibilityValue(mark == .done ? "Done" : mark == .skipped ? "Skipped" : "")
    }
}

/// Holding one part of a two-part Today card lifts just that part, with options for it.
private struct SectionLift: ViewModifier {
    var isEnabled: Bool
    let planID: UUID
    let day: Day
    let column: Int
    let text: String

    func body(content: Content) -> some View {
        content.liftsOnHold(
            .day(planID, day, column: column),
            key: FocusItem.dayKey(planID, day, column),
            isEnabled: isEnabled
        ) { [planID, day, column, text] in
            LivePlan(id: planID) { plan in
                TodaySection(plan: plan, day: day, column: column, text: text)
                    .background(Color.surface)
            }
        }
    }
}

/// A soft green wash that spreads from the check button across the card when a day completes.
struct InkRipple: View {
    var trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if !reduceMotion {
            ripple
        }
    }

    private var ripple: some View {
        Circle()
            .fill(Color.success)
            .frame(width: 48, height: 48)
            .keyframeAnimator(initialValue: RippleValues(), trigger: trigger) { content, value in
                content
                    .scaleEffect(value.scale)
                    .opacity(value.opacity)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    LinearKeyframe(1, duration: 0.001)
                    CubicKeyframe(32, duration: 0.62)
                }
                KeyframeTrack(\.opacity) {
                    LinearKeyframe(0.1, duration: 0.06)
                    CubicKeyframe(0, duration: 0.56)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

struct RippleValues: Sendable {
    var scale: CGFloat = 1
    var opacity: Double = 0
}
