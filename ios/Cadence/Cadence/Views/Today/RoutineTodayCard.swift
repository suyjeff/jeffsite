import SwiftUI

/// A routine on the Today deck. One column fills the card (Training); several split it
/// evenly with a hairline (Skincare AM / PM), and each half can be tapped on its own.
struct RoutineTodayCard: View {
    let plan: Plan
    let day: Day
    /// −1…1 from the deck's horizontal drag.
    var swipe: CGFloat

    @Environment(Store.self) private var store
    @Environment(\.focusedKey) private var focusedKey
    @State private var ripple = 0

    private var isMulti: Bool { plan.columnCount > 1 }

    var body: some View {
        let items = plan.items(on: day)
        let status = plan.status(on: day)

        VStack(spacing: 0) {
            ForEach(0..<plan.columnCount, id: \.self) { column in
                section(column: column, text: items.indices.contains(column) ? items[column] : "", status: status)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                if column < plan.columnCount - 1 {
                    Hairline()
                }
            }
        }
        .opacity(1 - 0.28 * Double(max(0, -swipe).clamped(0, 1)))
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
        .overlay {
            // The card warms toward plum as a swipe approaches its commit point.
            Color.plum
                .opacity(0.06 * Double(abs(swipe).clamped(0, 1)))
                .allowsHitTesting(false)
        }
    }

    // MARK: Sections

    /// As in the design: the plan's label above the first section's text, 24pt padding,
    /// a 12pt gap. With AM / PM columns, each half carries its column's name in the corner,
    /// with a ✓ beside it once done.
    @ViewBuilder
    private func section(column: Int, text: String, status: DayStatus) -> some View {
        let mark = plan.mark(on: day, column: column)
        let isPlanned = !text.isEmpty
        let finished = isPlanned && (mark == .done || status == .done || status == .skipped)

        VStack(alignment: .leading, spacing: Metrics.labelGap) {
            if column == 0 {
                PlanLabel(plan: plan)
            }
            Text(isPlanned ? text : "Nothing planned")
                .font(.cadenceToday)
                .tracking(-0.5)
                .lineSpacing(4)
                .foregroundStyle(finished || !isPlanned ? Color.inkSecondary : Color.ink)
                .minimumScaleFactor(0.8)
        }
        .padding(Metrics.cardPadding)
        .padding(.trailing, isMulti ? 20 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(alignment: .topTrailing) {
            if isMulti {
                ColumnCheck(title: plan.columns[column], mark: mark)
                    .padding(.top, Metrics.cardPadding + 2)
                    .padding(.trailing, Metrics.cardPadding)
            }
        }
        .contentShape(.rect)
        // Simultaneous, so a still finger on a half can still grow into the card's hold.
        .simultaneousGesture(TapGesture().onEnded {
            // The release that ends a hold isn't a tap.
            guard isMulti, isPlanned, focusedKey == nil else { return }
            let change = withAnimation(Motion.settle) {
                store.toggleColumn(plan.id, on: day, column: column)
            }
            Feedback.play(for: change, step: column)
            if change == .completed { ripple += 1 }
        })
        .accessibilityElement(children: .combine)
        .accessibilityValue(mark == .done ? "Done" : mark == .skipped ? "Skipped" : "")
        .accessibilityHint(isMulti && isPlanned ? "Double tap to check off \(plan.columns[column].isEmpty ? "this half" : plan.columns[column])" : "")
    }

    // MARK: Footer

    private func footer(status: DayStatus) -> some View {
        HStack(alignment: .center) {
            MonoLabel(text: footerText(status))
                .contentTransition(.opacity)
                .animation(Motion.settle, value: footerText(status))
            Spacer()
            if plan.isPlanned(day) {
                CheckButton(
                    look: status == .done ? .done : status == .skipped ? .skipped : .open,
                    swipe: swipe,
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
            if let at = plan.record(on: day).completedAt { return "DONE · \(DayText.time(at))" }
            return "DONE"
        case .skipped:
            // The ✕ in the check already says it.
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

/// "AM ✓" in the corner of a half: the column's name, and its mark once it has one.
private struct ColumnCheck: View {
    let title: String
    let mark: Mark?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 6) {
            if !title.isEmpty {
                MonoLabel(text: title.uppercased())
            }
            glyph
        }
    }

    private var glyph: some View {
        ZStack {
            Image(systemName: "checkmark")
                .opacity(mark == .done ? 1 : 0)
                .scaleEffect(mark == .done ? 1 : 0.25)
                .blur(radius: mark == .done ? 0 : 4)
            Image(systemName: "xmark")
                .opacity(mark == .skipped ? 1 : 0)
                .scaleEffect(mark == .skipped ? 1 : 0.25)
                .blur(radius: mark == .skipped ? 0 : 4)
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(Color.inkMuted)
        .frame(width: 16, height: 16)
        .animation(mark == .done ? Motion.pop(reduceMotion: reduceMotion) : Motion.icon, value: mark)
        .accessibilityHidden(true)
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
