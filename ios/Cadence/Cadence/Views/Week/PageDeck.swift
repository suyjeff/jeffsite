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
    /// Only a finger can arm the pull; a fling that bounces off the top shouldn't.
    @State private var interacting = false
    /// After switching, ignore the bounce-back until the page is at rest again.
    @State private var waitingForRest = false

    private let pullDistance: CGFloat = 84

    var body: some View {
        let plans = store.plans
        let front = store.plan(frontID) ?? plans.first
        let canCycle = plans.count > 1
        let progress = canCycle ? min(pull / pullDistance, 1) : 0

        ScrollView {
            ZStack(alignment: .top) {
                if canCycle {
                    // The next card, peeking above. It rises out from behind as the page is
                    // pulled down, and comes forward when tapped.
                    DeckPeek(rise: progress, pull: pull, height: 160 + pull * 0.42) { cycle(plans: plans) }
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
            // The last row scrolls clear of the floating Create button.
            .padding(.bottom, Metrics.createClearance + 16)
        }
        .scrollIndicators(.hidden)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            max(0, -(geometry.contentOffset.y + geometry.contentInsets.top))
        } action: { _, newValue in
            pull = newValue
            if waitingForRest {
                if newValue < 1 { waitingForRest = false }
                return
            }
            let isArmed = canCycle && interacting && newValue >= pullDistance
            if isArmed != armed {
                armed = isArmed
                Feedback.play(isArmed ? .armed : .disarmed)
            }
        }
        .onScrollPhaseChange { oldPhase, newPhase in
            interacting = newPhase == .interacting
            // Commit when the finger lifts while armed.
            if oldPhase == .interacting, newPhase != .interacting, armed {
                armed = false
                waitingForRest = true
                cycle(plans: plans)
            }
        }
    }

    private var deckTransition: AnyTransition {
        Motion.deckForward(reduceMotion: reduceMotion)
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

/// The blank card peeking 10pt above the front card, as in the design. Tapping it (or the
/// gap just above it) brings it forward; a pull draws it out by `rise` / `pull`.
struct DeckPeek: View {
    var rise: CGFloat = 0
    var pull: CGFloat = 0
    /// Tall enough that a long pull never lifts its bottom past the front card's top.
    var height: CGFloat = 120
    var onTap: () -> Void

    var body: some View {
        RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
            .fill(Color.surface)
            .frame(height: height)
            .cardSurface()
            .scaleEffect(1 - Metrics.deckScaleStep * (1 - rise * 0.7), anchor: .top)
            .offset(y: -Metrics.deckPeek - pull * 0.42)
            .overlay(alignment: .top) {
                Color.clear
                    .frame(height: Metrics.deckPeek + 14)
                    .contentShape(.rect)
                    .offset(y: -(Metrics.deckPeek + 14) - pull * 0.42)
                    .onTapGesture(perform: onTap)
            }
            .accessibilityHidden(true)
    }
}

/// "‹  NOV 23 – 29  ›" under a card's header strip. Shows a "Today" chip when you've
/// wandered off the current period.
struct PeriodBar: View {
    let title: String
    /// "week" or "month", for the step buttons' names.
    var unit = "week"
    var isCurrent: Bool
    var onStep: (Int) -> Void
    var onReset: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton("chevron.backward", label: "Previous \(unit)", delta: -1)
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
            stepButton("chevron.forward", label: "Next \(unit)", delta: 1)
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
