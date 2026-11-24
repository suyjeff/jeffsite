import SwiftUI

/// The Today view: one card per plan, stacked like a deck with the next card peeking above.
///
/// Gestures (one axis is chosen after ~12pt of movement, then the card tracks the finger 1:1):
/// - Swipe right: done. Swipe left: not today (skip). Past the commit point the card arms
///   with a detent; on release it's thrown off with the finger's velocity and tucks behind the deck.
/// - Pull down: the peeking card comes forward. Push up: the previous card comes back.
struct TodayDeck: View {
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var frontID: UUID?
    var onEditDay: (UUID, Day) -> Void
    var onCreatePlan: () -> Void

    @State private var drag: CGSize = .zero
    /// 0…1: how far the card behind has been drawn forward by the current gesture.
    @State private var promote: CGFloat = 0
    @State private var axis: Axis?
    @State private var armed = false
    @State private var flying = false
    @State private var reentering: UUID?

    private let commitDistance: CGFloat = 110
    private let pullDistance: CGFloat = 96

    var body: some View {
        let plans = store.plans
        Group {
            if plans.isEmpty {
                EmptyDeck(onCreatePlan: onCreatePlan)
            } else {
                GeometryReader { proxy in
                    let width = proxy.size.width
                    let frontIndex = store.index(of: frontID) ?? 0
                    ZStack(alignment: .top) {
                        ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                            let depth = (index - frontIndex + plans.count) % plans.count
                            deckCard(plan, depth: depth, count: plans.count, width: width)
                        }
                    }
                    .padding(.top, Metrics.deckPeek)
                    .contentShape(.rect)
                    .gesture(dragGesture(width: width, count: plans.count))
                }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 14)
        .padding(.bottom, 14)
    }

    /// Signed swipe progress for the front card: −1 (skip armed) … 0 … 1 (done armed).
    private var swipeProgress: CGFloat {
        // Vertical gestures leave drag.width at 0. Deriving this from the animated state means
        // the check button eases back with the card on a cancelled swipe instead of snapping.
        (drag.width / commitDistance).clamped(-1.2, 1.2)
    }

    // MARK: Cards

    @ViewBuilder
    private func deckCard(_ plan: Plan, depth: Int, count: Int, width: CGFloat) -> some View {
        let isFront = depth == 0
        // Cards behind move up one slot as the front card is dragged away.
        let effective = isFront ? 0 : max(0, CGFloat(depth) - promote)
        let visibleDepth = min(effective, 2)
        let isReentering = reentering == plan.id

        TodayCard(
            plan: plan,
            day: store.today,
            isFront: isFront,
            swipe: isFront ? swipeProgress : 0,
            onEditDay: onEditDay
        )
        .equatable()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay {
            // Back cards read as blank paper, as in the design; their content fades up
            // as they come forward.
            Rectangle()
                .fill(Color.surface)
                .opacity(Double(min(effective, 1)))
                .allowsHitTesting(false)
        }
        .cardSurface(elevated: depth <= 1)
        .scaleEffect(1 - Metrics.deckScaleStep * visibleDepth, anchor: .top)
        .offset(y: -Metrics.deckPeek * visibleDepth)
        .opacity(effective > 1 ? Double(max(0, 2 - effective)) : 1)
        .scaleEffect(isReentering ? 0.97 : 1, anchor: .top)
        .opacity(isReentering ? 0 : 1)
        .offset(isFront ? drag : .zero)
        .rotationEffect(.degrees(isFront && !reduceMotion ? Double(drag.width / max(width, 1)) * 9 : 0), anchor: .bottom)
        .zIndex(Double(count - depth))
        .allowsHitTesting(isFront && !flying)
        .accessibilityHidden(!isFront)
        .accessibilityActions {
            if isFront && count > 1 {
                Button("Next plan") { cycle(by: 1, count: count) }
                Button("Previous plan") { cycle(by: -1, count: count) }
            }
        }
    }

    // MARK: Gesture

    private func dragGesture(width: CGFloat, count: Int) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard !flying else { return }
                let t = value.translation
                if axis == nil {
                    axis = abs(t.width) > abs(t.height) ? .horizontal : .vertical
                    Haptics.shared.prepare()
                }
                switch axis {
                case .horizontal?:
                    drag = CGSize(width: t.width, height: Motion.resist(t.height, dimension: 300) * 0.35)
                    promote = min(1, abs(t.width) / commitDistance)
                    setArmed(abs(t.width) >= commitDistance)
                case .vertical?:
                    if count > 1 && t.height > 0 {
                        // Pulling down draws the peeking card forward.
                        drag = CGSize(width: 0, height: Motion.rubberband(t.height * 0.55, limit: 36))
                        promote = min(1, t.height / pullDistance)
                    } else {
                        drag = CGSize(width: 0, height: Motion.resist(t.height, dimension: 420))
                        promote = 0
                    }
                    setArmed(count > 1 && abs(t.height) >= pullDistance)
                case nil:
                    break
                }
            }
            .onEnded { value in
                guard !flying else { return }
                let t = value.translation
                let v = value.velocity
                let current = axis
                axis = nil
                armed = false
                switch current {
                case .horizontal?:
                    // Distance or a flick in the same direction both commit.
                    let flick = abs(v.width) > 650 && abs(t.width) > 28 && (v.width > 0) == (t.width > 0)
                    let projected = abs(t.width + Motion.project(v.width))
                    if abs(t.width) >= commitDistance || flick || (projected >= commitDistance * 1.6 && abs(t.width) > 40) {
                        commitSwipe(direction: t.width > 0 ? 1 : -1, velocity: v.width, width: width, count: count)
                    } else {
                        settle(velocity: v)
                    }
                case .vertical? where count > 1:
                    if t.height > pullDistance || (v.height > 700 && t.height > 24) {
                        cycle(by: 1, count: count)
                    } else if t.height < -pullDistance || (v.height < -700 && t.height < -24) {
                        cycle(by: -1, count: count)
                    } else {
                        settle(velocity: v)
                    }
                default:
                    settle(velocity: v)
                }
            }
    }

    private func setArmed(_ value: Bool) {
        guard value != armed else { return }
        armed = value
        Feedback.play(value ? .armed : .disarmed)
    }

    private func commitSwipe(direction: CGFloat, velocity: CGFloat, width: CGFloat, count: Int) {
        guard let plan = store.plan(frontID) ?? store.plans.first else { return }
        let day = store.today
        let change = withAnimation(Motion.settle) {
            direction > 0 ? store.toggleDone(plan.id, on: day) : store.toggleSkipped(plan.id, on: day)
        }
        Feedback.play(for: change)

        // Undoing (or nothing to mark) keeps the card where it is.
        guard let change, change != .cleared else {
            settle(velocity: CGSize(width: velocity, height: 0), bounce: 0.22)
            return
        }

        flying = true
        let target = direction * (width + 140)
        let animation: Animation = reduceMotion
            ? .easeOut(duration: 0.2)
            : Motion.release(velocity: velocity, distance: target - drag.width, duration: 0.48)
        withAnimation(animation, completionCriteria: .logicallyComplete) {
            drag = CGSize(width: target, height: drag.height + 36)
            promote = 1
        } completion: {
            finishFlight(of: plan.id, count: count)
        }
    }

    /// The thrown card tucks in at the back of the deck and fades up there.
    private func finishFlight(of id: UUID, count: Int) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            if count > 1, let index = store.index(of: id) {
                frontID = store.plans[(index + 1) % store.plans.count].id
            }
            drag = .zero
            promote = 0
            reentering = id
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(24))
            withAnimation(.easeOut(duration: 0.3)) { reentering = nil }
            flying = false
        }
    }

    private func settle(velocity: CGSize, bounce: Double = 0.14) {
        let horizontal = abs(drag.width) >= abs(drag.height)
        let animation = reduceMotion
            ? Motion.standard
            : Motion.release(
                velocity: horizontal ? velocity.width : velocity.height,
                distance: horizontal ? -drag.width : -drag.height,
                duration: 0.36,
                bounce: bounce
            )
        withAnimation(animation) {
            drag = .zero
            promote = 0
        }
    }

    private func cycle(by step: Int, count: Int) {
        guard count > 1 else { return }
        let index = store.index(of: frontID) ?? 0
        Feedback.play(.cycle)
        withAnimation(reduceMotion ? Motion.standard : Motion.deck) {
            frontID = store.plans[(index + step + count) % count].id
            drag = .zero
            promote = 0
        }
    }
}

/// Picks the right card for the plan type.
///
/// Equatable (ignoring the callback) so that while one card is dragged, the cards behind it
/// skip re-rendering their content on every frame; store changes still reach them through
/// observation.
struct TodayCard: View, Equatable {
    let plan: Plan
    let day: Day
    var isFront: Bool
    var swipe: CGFloat
    var onEditDay: (UUID, Day) -> Void

    static func == (lhs: TodayCard, rhs: TodayCard) -> Bool {
        lhs.plan == rhs.plan && lhs.day == rhs.day && lhs.isFront == rhs.isFront && lhs.swipe == rhs.swipe
    }

    var body: some View {
        switch plan.kind {
        case .routine:
            RoutineTodayCard(plan: plan, day: day, swipe: swipe, onEditDay: onEditDay)
        case .metric:
            MetricTodayCard(plan: plan, day: day, swipe: swipe)
        }
    }
}

struct EmptyDeck: View {
    var onCreatePlan: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.labelGap) {
            MonoLabel(text: "NO PLANS YET")
            Text("Write your first week: a training block, a skincare routine, a habit, or a number to log each day.")
                .font(.cadenceBody)
                .foregroundStyle(Color.ink)
            Spacer()
            HStack {
                Spacer()
                Button(action: onCreatePlan) {
                    Label("New plan", systemImage: "plus")
                        .font(.cadenceCallout)
                        .padding(.horizontal, 6)
                }
                .buttonStyle(.glassProminent)
                .tint(Color.plum)
            }
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .cardSurface()
        .padding(.top, Metrics.deckPeek)
    }
}
