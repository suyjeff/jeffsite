import SwiftUI

/// A daily number on the Today deck: a big reading, a two-week sparkline, and a ruler to
/// scrub. Swipe right (or tap the check) to log what the ruler says; swipe left to skip today.
struct MetricTodayCard: View {
    let plan: Plan
    let day: Day
    var swipe: CGFloat

    @Environment(Store.self) private var store
    @State private var ripple = 0

    var body: some View {
        let logged = plan.value(on: day)
        let draft = store.draft(for: plan, on: day)
        let changed = store.hasDraftChange(plan)
        let isLogged = logged != nil && !changed
        let status = plan.status(on: day)
        let recent = plan.points(in: (0..<14).map { day.adding($0 - 13) })

        VStack(alignment: .leading, spacing: 0) {
            // The card's handle: hold it (or tap ⋯) for the plan's options. It spans the full
            // card width, so it steps out of the card's padding.
            FocusableHeader(planID: plan.id) {
                MonoLabel(text: plan.name.uppercased(), color: isLogged ? .inkMuted : .inkSecondary)
                Spacer(minLength: 12)
            }
            .padding(.horizontal, -Metrics.cardPadding)
            .padding(.top, -Metrics.cardPadding)

            Spacer(minLength: 12)

            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(plan.format(draft))
                        .font(.cadenceNumber(64))
                        .tracking(-2)
                        .monospacedDigit()
                        .foregroundStyle(isLogged ? Color.ink : Color.inkSecondary)
                        .contentTransition(.numericText(value: draft))
                        .animation(.easeOut(duration: 0.14), value: draft)
                    if !plan.unit.isEmpty {
                        Text(plan.unit)
                            .font(.cadenceLabel)
                            .foregroundStyle(Color.inkSecondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)

                MonoLabel(text: TrendText.delta(plan, value: draft, before: day) ?? "FIRST ENTRY", color: .inkMuted, style: .cadenceCaption)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)

            Spacer(minLength: 12)

            if recent.count >= 2 {
                MetricChart(
                    points: recent,
                    domain: MetricChart.domain(from: day.adding(-13), to: day),
                    highlight: logged == nil ? nil : day
                )
                .frame(height: 64)
                .padding(.bottom, 16)
                .transition(.opacity)
            }

            RulerPicker(
                value: Binding(
                    get: { store.draft(for: plan, on: day) },
                    set: { store.setDraft($0, for: plan.id) }
                ),
                step: plan.step,
                range: 0...max(1000, draft * 3)
            )
            .padding(.horizontal, -Metrics.cardPadding)

            HStack(alignment: .center) {
                MonoLabel(text: footerText(status: status, changed: changed), color: .inkMuted)
                    .contentTransition(.opacity)
                Spacer()
                CheckButton(
                    look: isLogged ? .done : status == .skipped ? .skipped : .open,
                    swipe: swipe,
                    voiceOverLabel: isLogged ? "Clear today's \(plan.name)" : "Log \(plan.format(draft)) \(plan.unit)",
                    action: logTapped
                )
            }
            .padding(.top, 14)
        }
        .padding(Metrics.cardPadding)
        .opacity(1 - 0.28 * Double(max(0, -swipe).clamped(0, 1)))
        .overlay(alignment: .bottomTrailing) {
            InkRipple(trigger: ripple)
                .padding(Metrics.cardPadding)
        }
        .overlay {
            Color.plum
                .opacity(0.06 * Double(abs(swipe).clamped(0, 1)))
                .allowsHitTesting(false)
        }
        .animation(Motion.standard, value: recent.count >= 2)
    }

    private func footerText(status: DayStatus, changed: Bool) -> String {
        if changed { return "TAP ✓ TO UPDATE" }
        switch status {
        case .done:
            if let at = plan.record(on: day).completedAt { return "LOGGED · \(DayText.time(at))" }
            return "LOGGED"
        case .skipped:
            return "NOT TODAY"
        default:
            return "SCRUB, THEN LOG"
        }
    }

    private func logTapped() {
        let change = withAnimation(Motion.settle) {
            if plan.status(on: day) == .skipped {
                store.toggleSkipped(plan.id, on: day)
            }
            return store.toggleDone(plan.id, on: day)
        }
        Feedback.play(for: change)
        if change == .logged { ripple += 1 }
    }
}
