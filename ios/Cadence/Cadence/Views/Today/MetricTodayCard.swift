import SwiftUI

/// A daily number on the Today deck: a big reading, a two-week sparkline, and a ruler to
/// scrub. Tap the check to log what the ruler says.
struct MetricTodayCard: View {
    let plan: Plan
    let day: Day

    @Environment(Store.self) private var store
    @Environment(\.focusedKey) private var focusedKey
    @State private var ripple = 0
    /// The ruler is moving. Its readout then tracks the finger directly, without per-step
    /// animation; rolling digits only play for a change that arrives at rest.
    @State private var scrubbing = false

    var body: some View {
        let logged = plan.value(on: day)
        let draft = store.draft(for: plan, on: day)
        let changed = store.hasDraftChange(plan)
        let isLogged = logged != nil && !changed
        let status = plan.status(on: day)
        let recent = plan.points(in: (0..<14).map { day.adding($0 - 13) })

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                MonoLabel(text: plan.name.uppercased())
                Spacer()
                StatusBadge(mark: isLogged ? .done : status == .skipped ? .skipped : nil)
            }

            Spacer(minLength: 12)

            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(plan.format(draft))
                        .font(.cadenceNumber(64))
                        .tracking(-2)
                        .monospacedDigit()
                        .foregroundStyle(isLogged ? Color.ink : Color.inkSecondary)
                        .contentTransition(scrubbing ? .identity : .numericText(value: draft))
                        .animation(scrubbing ? nil : .easeOut(duration: 0.14), value: draft)
                    if !plan.unit.isEmpty {
                        Text(plan.unit)
                            .font(.cadenceLabel)
                            .foregroundStyle(Color.inkSecondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)

                MonoLabel(text: TrendText.delta(plan, value: draft, before: day) ?? "FIRST ENTRY", style: .cadenceCaption)
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
                .equatable()
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
                range: 0...max(1000, draft * 3),
                label: plan.name,
                onScrubbing: { scrubbing = $0 }
            )
            .padding(.horizontal, -Metrics.cardPadding)

            HStack(alignment: .center) {
                MonoLabel(text: footerText(status: status))
                    .contentTransition(.opacity)
                Spacer()
                CheckButton(
                    look: isLogged ? .done : status == .skipped ? .skipped : .open,
                    voiceOverLabel: isLogged ? "Clear today's \(plan.name)" : "Log \(plan.format(draft)) \(plan.unit)",
                    action: logTapped
                )
            }
            .padding(.top, 14)
            .padding(.bottom, -2)
        }
        .padding(Metrics.cardPadding)
        // Logged or skipped: the card settles a step darker.
        .background {
            Color.settled
                .opacity(isLogged || status == .skipped ? 1 : 0)
                .animation(Motion.settle, value: isLogged || status == .skipped)
        }
        .overlay(alignment: .bottomTrailing) {
            InkRipple(trigger: ripple)
                .padding(.trailing, Metrics.cardPadding)
                .padding(.bottom, Metrics.cardPadding - 2)
        }
        .animation(Motion.standard, value: recent.count >= 2)
    }

    private func footerText(status: DayStatus) -> String {
        switch status {
        case .done:
            if let at = plan.record(on: day).completedAt { return "LOGGED · \(DayText.time(at))" }
            return "LOGGED"
        case .skipped:
            return ""
        default:
            return ""
        }
    }

    private func logTapped() {
        // The release that ends a hold on the check isn't a tap.
        guard focusedKey == nil else { return }
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
