import SwiftUI

/// The deck for Week and Month: the front card sits in a scroll view with the next card
/// peeking above it. Pulling down past the top draws that card forward, like the Today deck,
/// so the same gesture moves between plans everywhere.
struct PageDeck<Card: View>: View {
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var frontID: UUID?
    @ViewBuilder var card: (Plan) -> Card

    @State private var pull: CGFloat = 0
    @State private var armed = false

    private let pullDistance: CGFloat = 84

    var body: some View {
        let plans = store.plans
        let front = store.plan(frontID) ?? plans.first
        let canCycle = plans.count > 1
        let progress = canCycle ? min(pull / pullDistance, 1) : 0

        ScrollView {
            ZStack(alignment: .top) {
                if canCycle {
                    // The next card: blank paper, peeking 10pt above. It rises out from
                    // behind as the page is pulled down.
                    RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                        .fill(Color.surface)
                        .frame(height: 160)
                        .cardSurface()
                        .scaleEffect(1 - Metrics.deckScaleStep * (1 - progress * 0.7), anchor: .top)
                        .offset(y: -Metrics.deckPeek - pull * 0.42)
                }
                if let front {
                    card(front)
                        .id(front.id)
                        .transition(deckTransition)
                        .zIndex(1)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 14 + Metrics.deckPeek)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            max(0, -(geometry.contentOffset.y + geometry.contentInsets.top))
        } action: { _, newValue in
            pull = newValue
            let isArmed = canCycle && newValue >= pullDistance
            if isArmed != armed {
                armed = isArmed
                Feedback.play(isArmed ? .armed : .disarmed)
            }
        }
        .onScrollPhaseChange { oldPhase, newPhase in
            // Commit when the finger lifts while armed.
            if oldPhase == .interacting, newPhase != .interacting, armed {
                armed = false
                cycle(plans: plans)
            }
        }
    }

    private var deckTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(
            insertion: .scale(scale: 1 - Metrics.deckScaleStep, anchor: .top)
                .combined(with: .offset(y: -Metrics.deckPeek))
                .combined(with: .opacity),
            removal: .opacity.combined(with: .scale(scale: 0.98, anchor: .top))
        )
    }

    private func cycle(plans: [Plan]) {
        guard plans.count > 1 else { return }
        let index = store.index(of: frontID) ?? 0
        Feedback.play(.cycle)
        withAnimation(Motion.deck) {
            frontID = plans[(index + 1) % plans.count].id
        }
    }
}

/// "‹  NOV 23 – 29  ›" under a card's header strip. Shows a "Today" chip when you've
/// wandered off the current period.
struct PeriodBar: View {
    let title: String
    var isCurrent: Bool
    var onStep: (Int) -> Void
    var onReset: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton("chevron.left", label: "Previous", delta: -1)
            Spacer(minLength: 0)
            Text(title)
                .font(.cadenceLabel)
                .foregroundStyle(Color.ink)
                .contentTransition(.numericText())
                .lineLimit(1)
            if !isCurrent {
                Button(action: onReset) {
                    Text("TODAY")
                        .font(.cadenceCaption)
                        .foregroundStyle(Color.plum)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.plum.opacity(0.1), in: Capsule())
                        .padding(.vertical, 10)
                        .contentShape(.rect)
                }
                .buttonStyle(PressableStyle())
                .padding(.leading, 8)
                .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
            Spacer(minLength: 0)
            stepButton("chevron.right", label: "Next", delta: 1)
        }
        .padding(.horizontal, 8)
        .frame(height: 44)
        .overlay(alignment: .bottom) { Hairline() }
        .animation(Motion.snappy, value: isCurrent)
    }

    private func stepButton(_ symbol: String, label: String, delta: Int) -> some View {
        Button {
            Haptics.shared.tick()
            onStep(delta)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.inkSecondary)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}
