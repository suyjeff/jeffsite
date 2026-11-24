import SwiftUI

/// A routine on the Today deck. One column fills the card (Training); several split it
/// evenly with a hairline (Skincare AM / PM), and each half can be tapped on its own.
struct RoutineTodayCard: View {
    let plan: Plan
    let day: Day
    /// −1…1 from the deck's horizontal drag.
    var swipe: CGFloat
    var onEditDay: (UUID, Day) -> Void

    @Environment(Store.self) private var store
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
                .padding(Metrics.cardPadding)
        }
        .overlay {
            // The card warms toward plum as a swipe approaches its commit point.
            Color.plum
                .opacity(0.06 * Double(abs(swipe).clamped(0, 1)))
                .allowsHitTesting(false)
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func section(column: Int, text: String, status: DayStatus) -> some View {
        let mark = plan.mark(on: day, column: column)
        let isPlanned = !text.isEmpty
        let finished = isPlanned && (mark == .done || status == .done || status == .skipped)

        VStack(alignment: .leading, spacing: Metrics.labelGap) {
            if column == 0 {
                MonoLabel(text: plan.name.uppercased(), color: finished ? .inkMuted : .inkSecondary)
            }
            Text(isPlanned ? text : "Nothing planned")
                .font(.cadenceBody)
                .tracking(-0.2)
                .foregroundStyle(finished || !isPlanned ? Color.inkFaint : Color.ink)
                .minimumScaleFactor(0.8)
        }
        .padding(Metrics.cardPadding)
        .padding(.trailing, isMulti ? 36 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(alignment: .topTrailing) {
            if isMulti {
                ColumnTag(title: plan.columns[column], mark: mark)
                    .padding(.top, Metrics.cardPadding)
                    .padding(.trailing, Metrics.cardPadding)
            }
        }
        .contentShape(.rect)
        .onTapGesture {
            guard isMulti, isPlanned else { return }
            let change = withAnimation(Motion.settle) {
                store.toggleColumn(plan.id, on: day, column: column)
            }
            Feedback.play(for: change, step: column)
            if change == .completed { ripple += 1 }
        }
        .contextMenu {
            dayMenu(column: column, isPlanned: isPlanned)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(isMulti && isPlanned ? "Double tap to check off \(plan.columns[column])" : "")
    }

    @ViewBuilder
    private func dayMenu(column: Int, isPlanned: Bool) -> some View {
        let status = plan.status(on: day)
        if plan.isPlanned(day) {
            Button(status == .done ? "Mark not done" : "Mark done", systemImage: status == .done ? "arrow.uturn.backward" : "checkmark") {
                let change = withAnimation(Motion.settle) { store.toggleDone(plan.id, on: day) }
                Feedback.play(for: change)
                if change == .completed { ripple += 1 }
            }
            Button(status == .skipped ? "Undo skip" : "Not today", systemImage: status == .skipped ? "arrow.uturn.backward" : "xmark") {
                let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: day) }
                Feedback.play(for: change)
            }
        }
        Button("Edit today…", systemImage: "pencil") {
            onEditDay(plan.id, day)
        }
    }

    // MARK: Footer

    private func footer(status: DayStatus) -> some View {
        HStack(alignment: .center) {
            MonoLabel(text: footerText(status), color: .inkMuted)
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
            return "NOT TODAY"
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

/// "AM ✓" in the corner of a multi-column section.
private struct ColumnTag: View {
    let title: String
    let mark: Mark?

    var body: some View {
        HStack(spacing: 6) {
            if !title.isEmpty {
                MonoLabel(text: title.uppercased(), color: .inkMuted)
            }
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
            .frame(width: 14)
            .animation(Motion.icon, value: mark)
        }
    }
}

/// A soft plum wash that spreads from the check button across the card when a day completes.
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
            .fill(Color.plum)
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
                    LinearKeyframe(0.12, duration: 0.06)
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
