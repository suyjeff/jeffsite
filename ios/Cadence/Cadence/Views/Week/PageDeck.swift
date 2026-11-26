import SwiftUI

/// The deck for Week and Month: the front card on a scrolling page, with the next card
/// peeking above it. The same gestures as the Today deck move between plans: pull down past
/// the top to draw the next card forward, push up past the bottom to bring the previous one
/// back, or tap the peek.
struct PageDeck<Card: View>: View {
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.focusedKey) private var focusedKey

    @Binding var frontID: UUID?
    /// The page has scrolled away from its top (the header's title takes its capsule).
    @Binding var scrolled: Bool
    @ViewBuilder var card: (Plan) -> Card

    @State private var pull: CGFloat = 0
    @State private var push: CGFloat = 0
    /// +1 when a pull is armed (next plan), −1 when a push is (previous plan).
    @State private var armed = 0
    /// Only a finger can arm it; a fling that bounces off an edge shouldn't.
    @State private var interacting = false
    /// After switching, ignore the bounce-back until the page is at rest again.
    @State private var waitingForRest = false
    @State private var stickyTop: CGFloat = 0
    @State private var position = ScrollPosition(edge: .top)
    @State private var direction = 1

    private let pullDistance: CGFloat = 84
    private let pushDistance: CGFloat = 72

    /// What the page needs from its scroll geometry; equal values skip the update, so at rest
    /// and mid-page nothing re-renders as it scrolls.
    private struct Edges: Equatable {
        var pull: CGFloat
        var push: CGFloat
        var scrolled: Bool
        var top: CGFloat
    }

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
                    DeckPeek(rise: progress, pull: pull, height: 160 + pull * 0.42) { cycle(by: 1, plans: plans) }
                }
                if let front {
                    card(front)
                        .id(front.id)
                        .transition(direction >= 0 ? Motion.deckForward(reduceMotion: reduceMotion) : Motion.deckBack(reduceMotion: reduceMotion))
                        .zIndex(1)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 14 + Metrics.deckPeek)
            // The last row scrolls clear of the floating Create button.
            .padding(.bottom, Metrics.createClearance)
        }
        .scrollPosition($position)
        .scrollIndicators(.hidden)
        .scrollEdgeEffectStyle(.soft, for: .top)
        // A lifted card stays exactly where its cut in the focus backdrop is.
        .scrollDisabled(focusedKey != nil)
        .environment(\.stickyTop, stickyTop)
        .onScrollGeometryChange(for: Edges.self) { geometry in
            let offset = geometry.contentOffset.y
            let rest = -geometry.contentInsets.top
            let end = max(rest, geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height)
            return Edges(
                pull: max(0, rest - offset).rounded(),
                push: max(0, offset - end).rounded(),
                scrolled: offset - rest > 2,
                top: geometry.contentInsets.top
            )
        } action: { _, edges in
            pull = edges.pull
            push = edges.push
            if stickyTop != edges.top { stickyTop = edges.top }
            if scrolled != edges.scrolled { scrolled = edges.scrolled }
            if waitingForRest {
                if edges.pull < 1 && edges.push < 1 { waitingForRest = false }
                return
            }
            let next = !canCycle || !interacting ? 0
                : edges.pull >= pullDistance ? 1
                : edges.push >= pushDistance ? -1
                : 0
            if next != armed {
                Feedback.play(next != 0 ? .armed : .disarmed)
                armed = next
            }
        }
        .onScrollPhaseChange { oldPhase, newPhase in
            interacting = newPhase == .interacting
            // Commit when the finger lifts while armed.
            if oldPhase == .interacting, newPhase != .interacting, armed != 0 {
                let step = armed
                armed = 0
                waitingForRest = true
                cycle(by: step, plans: plans)
            }
        }
        .onAppear { scrolled = false }
    }

    private func cycle(by step: Int, plans: [Plan]) {
        guard plans.count > 1 else { return }
        let index = store.index(of: frontID) ?? 0
        direction = step
        Feedback.play(.cycle)
        if step < 0 {
            // Coming back from the bottom: the previous card arrives from its top.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { position.scrollTo(edge: .top) }
        }
        withAnimation(reduceMotion ? Motion.standard : Motion.deck) {
            frontID = plans[(index + step + plans.count) % plans.count].id
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
    @Environment(\.focusedKey) private var focusedKey

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
                Button {
                    guard focusedKey == nil else { return }
                    onReset()
                } label: {
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
            // The release that ends a hold on the header isn't a tap.
            guard focusedKey == nil else { return }
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
