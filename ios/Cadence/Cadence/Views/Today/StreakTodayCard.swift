import SwiftUI

/// A streak on the Today deck: one question a day, so the card is the answer so far. The
/// current run, big; the last two weeks as a row of days; the check to say yes for today.
struct StreakTodayCard: View {
    let plan: Plan
    let day: Day

    @Environment(Store.self) private var store
    @Environment(\.focusedKey) private var focusedKey
    @State private var ripple = 0

    var body: some View {
        let status = plan.status(on: day)
        let streak = plan.streak(asOf: day)
        let recent = (0..<14).map { day.adding($0 - 13) }

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                MonoLabel(text: plan.name.uppercased())
                Spacer()
                StatusBadge(mark: status == .done ? .done : status == .skipped ? .skipped : nil)
            }

            Spacer(minLength: 12)

            VStack(spacing: 6) {
                Text("\(streak)")
                    .font(.cadenceNumber(72))
                    .tracking(-2)
                    .monospacedDigit()
                    .foregroundStyle(streak > 0 ? Color.ink : Color.inkSecondary)
                    .contentTransition(.numericText(value: Double(streak)))
                    .animation(.spring(duration: 0.4, bounce: 0.2), value: streak)
                MonoLabel(text: "DAY STREAK", style: .cadenceCaption)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)

            Spacer(minLength: 12)

            HStack(spacing: 0) {
                ForEach(recent, id: \.self) { date in
                    StreakDot(status: plan.status(on: date), isToday: date == day)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.bottom, 20)
            .accessibilityHidden(true)

            // The green ✓ says done; when it was done shows (muted) only when the card is held.
            HStack(alignment: .center) {
                Spacer()
                CheckButton(
                    look: status == .done ? .done : status == .skipped ? .skipped : .open,
                    voiceOverLabel: "Check off \(plan.name)",
                    action: checkTapped
                )
            }
            .padding(.bottom, -2)
        }
        .padding(Metrics.cardPadding)
        .background {
            Color.settled
                .opacity(status == .done || status == .skipped ? 1 : 0)
                .animation(Motion.settle, value: status)
        }
        .overlay(alignment: .bottomTrailing) {
            InkRipple(trigger: ripple)
                .padding(.trailing, Metrics.cardPadding)
                .padding(.bottom, Metrics.cardPadding - 2)
        }
    }

    private func checkTapped() {
        // The release that ends a hold on the check isn't a tap.
        guard focusedKey == nil else { return }
        let change = withAnimation(Motion.settle) {
            plan.status(on: day) == .skipped ? store.toggleSkipped(plan.id, on: day) : store.toggleDone(plan.id, on: day)
        }
        Feedback.play(for: change)
        if change == .completed { ripple += 1 }
    }
}

/// One day of the last two weeks: filled green when done, a small ✕ when skipped, a ring
/// otherwise; today's ring is darker.
private struct StreakDot: View {
    let status: DayStatus
    let isToday: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(isToday ? Color.inkMuted : Color.inkFaint, lineWidth: 1.5)
                .opacity(status == .done ? 0 : 1)
            Circle()
                .fill(Color.success)
                .scaleEffect(status == .done ? 1 : 0.4)
                .opacity(status == .done ? 1 : 0)
            Image(systemName: "xmark")
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(Color.inkMuted)
                .opacity(status == .skipped ? 1 : 0)
        }
        .frame(width: 14, height: 14)
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.35, bounce: 0.4), value: status)
    }
}
