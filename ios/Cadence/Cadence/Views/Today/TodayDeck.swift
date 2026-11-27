import SwiftUI
import UIKit

/// Where a card sits in the deck, for the view drawing it.
struct DeckSlot {
    var isFront: Bool
}

/// The deck every view is built on: one card per plan, stacked, with the next card peeking
/// above and page dots below. Two gestures move between plans, the same on every view:
///
/// - **Sideways**: the card stays under the finger, 1:1 and then with growing resistance, while
///   the plan in that direction rises behind it (left for the next plan, right for the
///   previous). Nothing commits while the finger is down. On release past a third of the
///   width, or on a flick, the card is thrown off with the finger's velocity and tucks into the
///   stack, with one solid haptic; otherwise it springs back.
/// - **Pull down** (a longer pull): the card follows with resistance and fades a little as the
///   one behind it rises into view, with a haptic hum that tightens as the pull loads and a
///   detent once it's far enough. On release the card pops up out of the stack and drops to the
///   back as the next one opens, with a second haptic. Pushing up brings the previous plan back.
///
/// Every value on screen (offset, tilt, fade, the card behind, the hum) derives from the one drag,
/// so they never drift apart when the finger reverses. On Week and Month the cards scroll inside;
/// the deck takes a vertical drag only at the card's scroll edges.
struct PlanDeck<Card: View>: View {
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.focusedKey) private var focusedKey

    @Binding var frontID: UUID?
    /// Today drags with SwiftUI (so the ruler inside a card wins its own drags); Week and Month
    /// use a UIKit pan that defers to the card's scroll.
    var cardsScroll: Bool
    @ViewBuilder var card: (Plan, DeckSlot) -> Card

    @State private var drag: CGSize = .zero
    /// 0…1: how far the card behind has risen toward the front.
    @State private var promote: CGFloat = 0
    /// Which plan rises behind: +1 the next, −1 the previous, 0 none.
    @State private var reveal = 0
    @State private var axis: Axis?
    @State private var armed = false
    @State private var flying = false
    @State private var popping: UUID?
    @State private var reentering: UUID?
    /// The card that just popped, on its way to the back: blurred and dimmed as it sinks.
    @State private var sinking: UUID?
    /// Which tick of the pull the haptics last played (0 = none).
    @State private var pullStep = 0
    /// Where the deck is headed once a throw or pop lands. The dots move there on release,
    /// in step with the card, instead of waiting for the card to finish flying.
    @State private var landing: Int?

    /// How far a pull has to go before it commits. Deliberately longer than a scroll's bounce.
    private let pullDistance: CGFloat = 128

    var body: some View {
        let plans = store.plans
        let frontIndex = store.index(of: frontID) ?? 0

        VStack(spacing: 0) {
            if !plans.isEmpty {
                GeometryReader { proxy in
                    let width = proxy.size.width
                    ZStack(alignment: .top) {
                        ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                            let depth = visualDepth((index - frontIndex + plans.count) % plans.count, count: plans.count)
                            deckCard(plan, depth: depth, count: plans.count, width: width)
                        }
                        if plans.count > 1 {
                            // The card peeking behind can be tapped to bring it forward,
                            // like reaching for the next card in a stack.
                            Color.clear
                                .frame(height: Metrics.deckPeek + 14)
                                .contentShape(.rect)
                                .offset(y: -(Metrics.deckPeek + 14))
                                .onTapGesture { cycle(by: 1, count: plans.count) }
                                .zIndex(Double(plans.count + 1))
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(.top, Metrics.deckPeek)
                    .contentShape(.rect)
                    .modifier(DeckGesture(
                        cardsScroll: cardsScroll,
                        onChanged: { changed($0, width: width, count: plans.count) },
                        onEnded: { ended($0, velocity: $1, width: width, count: plans.count) },
                        onCancelled: { cancelled() }
                    ))
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 14)
            }

            DeckDots(count: plans.count, index: landing ?? frontIndex) { target in
                guard target != frontIndex else { return }
                cycle(by: target - frontIndex, count: plans.count)
            } onScrub: { target in
                scrub(to: target)
            }
        }
    }

    /// While a sideways drag to the right reveals the previous plan, it takes the slot right
    /// behind the front card, and the rest of the stack shifts back one.
    private func visualDepth(_ depth: Int, count: Int) -> Int {
        guard reveal < 0, count > 2, depth > 0 else { return depth }
        return depth == count - 1 ? 1 : depth + 1
    }

    // MARK: Cards

    @ViewBuilder
    private func deckCard(_ plan: Plan, depth: Int, count: Int, width: CGFloat) -> some View {
        let isFront = depth == 0
        // The card behind rises as the front one is dragged away.
        let effective = isFront ? 0 : max(0, CGFloat(depth) - promote)
        let visibleDepth = min(effective, 2)
        let isReentering = reentering == plan.id
        // A pull fades, darkens and softens the front card as the one behind rises. Derived
        // from the animated drag (not the gesture), so it eases back with the card instead of
        // snapping on release.
        let pull = isFront && abs(drag.height) > abs(drag.width) ? promote : 0
        let fade = 1 - 0.22 * Double(pull)
        // A popped card sinks into the stack: out of focus and in shadow until it lands.
        let sinks = sinking == plan.id

        Group {
            // Only the front card and the one about to come forward are drawn in full; the
            // rest of the stack is blank paper, so a deep deck costs nothing.
            if depth <= 1 {
                card(plan, DeckSlot(isFront: isFront))
            } else {
                Color.surface
            }
        }
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
        .focusableCard(plan.id)
        .scaleEffect(1 - Metrics.deckScaleStep * visibleDepth, anchor: .top)
        // Only one card peeks: deeper cards sit behind it, fading up as they come forward.
        .offset(y: -Metrics.deckPeek * min(visibleDepth, 1))
        .opacity(effective > 1 ? Double(max(0, 2 - effective)) : 1)
        .opacity(fade)
        .brightness(-0.14 * Double(pull) - (sinks ? 0.18 : 0))
        .blur(radius: reduceMotion ? 0 : 5 * pull + (sinks ? 6 : 0))
        .scaleEffect(popping == plan.id && !reduceMotion ? 1.06 : 1)
        .scaleEffect(isReentering ? 0.97 : 1, anchor: .top)
        .opacity(isReentering ? 0 : 1)
        .offset(isFront ? drag : .zero)
        .rotationEffect(.degrees(isFront && !reduceMotion ? Double(drag.width / max(width, 1)) * 7 : 0), anchor: .bottom)
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

    // MARK: Tracking

    private func changed(_ t: CGSize, width: CGFloat, count: Int) {
        guard !flying else { return }
        // A hold lifted the card before the finger moved: leave it where it is.
        guard focusedKey == nil else {
            if drag != .zero { settle(velocity: .zero) }
            return
        }
        if axis == nil {
            axis = abs(t.width) > abs(t.height) ? .horizontal : .vertical
            Haptics.shared.prepare()
        }
        switch axis {
        case .horizontal?:
            guard count > 1 else {
                // One plan: nowhere to go, so it gives a little and no more.
                drag = CGSize(width: Motion.resist(t.width, dimension: 260), height: 0)
                return
            }
            // 1:1 under the finger, then heavier the further it goes.
            drag = CGSize(
                width: Motion.rubberband(t.width, limit: width * 0.55, constant: 0.7),
                height: Motion.resist(t.height, dimension: 400) * 0.2
            )
            promote = min(1, abs(t.width) / (width * 0.6))
            setReveal(t.width < 0 ? 1 : t.width > 0 ? -1 : reveal)
        case .vertical?:
            guard count > 1 else {
                drag = CGSize(width: 0, height: Motion.resist(t.height, dimension: 420))
                return
            }
            let pulling = t.height > 0
            drag = CGSize(width: 0, height: Motion.rubberband(t.height * 0.6, limit: pulling ? 64 : 44))
            promote = min(1, abs(t.height) / pullDistance)
            setReveal(pulling ? 1 : -1)
            // Tick, tick, tick: one even tap for every sixth of the way, then the detent when
            // it's far enough. Felt as notches, never a buzz.
            let step = min(Int(promote * 6), 5)
            if step > pullStep { Haptics.shared.pullTick() }
            pullStep = step
            setArmed(abs(t.height) >= pullDistance)
        case nil:
            break
        }
    }

    private func ended(_ t: CGSize, velocity v: CGSize, width: CGFloat, count: Int) {
        let current = axis
        axis = nil
        armed = false
        pullStep = 0
        guard !flying else { return }
        guard focusedKey == nil, count > 1 else {
            settle(velocity: v)
            return
        }
        switch current {
        case .horizontal?:
            let direction: CGFloat = t.width < 0 ? -1 : 1
            let flick = abs(v.width) > 600 && abs(t.width) > 30 && (v.width > 0) == (t.width > 0)
            let projected = abs(t.width + Motion.project(v.width))
            if abs(t.width) >= width * 0.32 || flick || (projected >= width * 0.6 && abs(t.width) > 40) {
                toss(direction: direction, velocity: v.width, width: width, count: count)
            } else {
                settle(velocity: v)
            }
        case .vertical?:
            if t.height >= pullDistance {
                popToBack(count: count)
            } else if t.height <= -pullDistance {
                cycle(by: -1, count: count, velocity: v.height)
            } else {
                settle(velocity: v)
            }
        case nil:
            settle(velocity: v)
        }
    }

    /// The drag was taken away (a call, Control Center) without ending: reset the pull's
    /// ticks and put the card back.
    private func cancelled() {
        guard axis != nil else { return }
        axis = nil
        armed = false
        pullStep = 0
        if !flying { settle(velocity: .zero) }
    }

    private func setReveal(_ value: Int) {
        guard value != reveal else { return }
        // The card behind swaps quickly when the drag changes direction.
        withAnimation(reduceMotion ? nil : Motion.snappy) { reveal = value }
    }

    private func setArmed(_ value: Bool) {
        guard value != armed else { return }
        armed = value
        Feedback.play(value ? .armed : .disarmed)
    }

    // MARK: Committing

    /// Sideways: the card leaves at the finger's speed, then joins the stack (at the back when
    /// moving to the next plan; just behind the new front when moving back).
    private func toss(direction: CGFloat, velocity: CGFloat, width: CGFloat, count: Int) {
        guard let plan = store.plan(frontID) ?? store.plans.first else { return }
        let step = direction < 0 ? 1 : -1
        flying = true
        Feedback.play(.toss)
        withAnimation(Motion.snappy) { landing = landingIndex(from: plan.id, step: step) }
        let target = direction * (width + 160)
        let animation: Animation = reduceMotion
            ? .easeOut(duration: 0.18)
            : Motion.release(velocity: velocity, distance: target - drag.width, duration: 0.3)
        withAnimation(animation, completionCriteria: .logicallyComplete) {
            drag = CGSize(width: target, height: drag.height + 20)
            promote = 1
        } completion: {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                frontID = neighbor(of: plan.id, step: step)
                landing = nil
                drag = .zero
                promote = 0
                reveal = 0
                reentering = plan.id
            }
            withAnimation(.easeOut(duration: 0.18)) { reentering = nil }
            flying = false
        }
    }

    /// Pull down: the card pops up out of the stack, then drops to the back as the next card
    /// opens into view. Two beats, about a third of a second in all.
    private func popToBack(count: Int) {
        guard let plan = store.plan(frontID) ?? store.plans.first else { return }
        flying = true
        Feedback.play(.pop)
        withAnimation(Motion.snappy) { landing = landingIndex(from: plan.id, step: 1) }
        guard !reduceMotion else {
            withAnimation(Motion.standard) {
                frontID = neighbor(of: plan.id, step: 1)
                landing = nil
                drag = .zero
                promote = 0
                reveal = 0
            }
            flying = false
            return
        }
        // Beat one: the card lifts toward you, out of the stack.
        withAnimation(.spring(duration: 0.1, bounce: 0), completionCriteria: .logicallyComplete) {
            popping = plan.id
            promote = 1
            drag = CGSize(width: 0, height: drag.height * 0.4)
        } completion: {
            // Beat two: it drops behind, sinking out of focus, as the next card opens.
            withAnimation(.spring(duration: 0.28, bounce: 0.1), completionCriteria: .logicallyComplete) {
                frontID = neighbor(of: plan.id, step: 1)
                landing = nil
                popping = nil
                sinking = plan.id
                drag = .zero
                promote = 0
                reveal = 0
            } completion: {
                withAnimation(.easeOut(duration: 0.16)) { sinking = nil }
                flying = false
            }
        }
    }

    /// The plan `step` places from `id` in the store as it is now (it may have changed during
    /// an animation), or the first plan if `id` is gone.
    private func neighbor(of id: UUID, step: Int) -> UUID? {
        let plans = store.plans
        guard !plans.isEmpty else { return nil }
        guard let index = store.index(of: id) else { return plans.first?.id }
        return plans[((index + step) % plans.count + plans.count) % plans.count].id
    }

    private func landingIndex(from id: UUID, step: Int) -> Int? {
        neighbor(of: id, step: step).flatMap { store.index(of: $0) }
    }

    /// Scrubbing the dots: the deck follows the finger page by page, a light tick for each.
    private func scrub(to target: Int) {
        let plans = store.plans
        guard !flying, plans.indices.contains(target), plans[target].id != frontID else { return }
        Haptics.shared.tick()
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(duration: 0.2, bounce: 0)) {
            frontID = plans[target].id
            drag = .zero
            promote = 0
            reveal = 0
        }
    }

    private func settle(velocity: CGSize, bounce: Double = 0.14) {
        let horizontal = abs(drag.width) >= abs(drag.height)
        let animation = reduceMotion
            ? Motion.standard
            : Motion.release(
                velocity: horizontal ? velocity.width : velocity.height,
                distance: horizontal ? -drag.width : -drag.height,
                duration: 0.3,
                bounce: bounce
            )
        withAnimation(animation) {
            drag = .zero
            promote = 0
            reveal = 0
        }
    }

    /// Brings the plan `step` places away to the front (the peek, the dots, VoiceOver, a push
    /// up), carrying any finger velocity into the settle.
    private func cycle(by step: Int, count: Int, velocity: CGFloat = 0) {
        guard count > 1, !flying else { return }
        let index = store.index(of: frontID) ?? 0
        Feedback.play(.cycle)
        let animation = reduceMotion
            ? Motion.standard
            : Motion.release(velocity: velocity, distance: -drag.height, duration: 0.3, bounce: 0.1)
        withAnimation(animation) {
            frontID = store.plans[((index + step) % count + count) % count].id
            drag = .zero
            promote = 0
            reveal = 0
        }
    }
}

/// The page dots under the deck: how many plans there are and which is in front.
///
/// Tap a dot to go to that plan, or press and slide along them to page through the deck: the
/// row swells into a glass capsule, the dots nearest the finger grow like a dock, and every
/// plan you pass comes to the front with a tick. VoiceOver adjusts it like a page control.
struct DeckDots: View {
    let count: Int
    let index: Int
    var onSelect: (Int) -> Void
    var onScrub: (Int) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The finger's x within the dots while scrubbing (once it has moved; a tap isn't a scrub).
    @State private var finger: CGFloat?
    @State private var touchStart: CGFloat?

    private var pitch: CGFloat { count > 9 ? 12 : 18 }

    var body: some View {
        let scrubbing = finger != nil
        HStack(spacing: 0) {
            if count > 1 {
                ForEach(0..<count, id: \.self) { dot in
                    let current = dot == index
                    Circle()
                        .fill(current ? Color.ink : Color.inkMuted.opacity(0.6))
                        .frame(width: 7, height: 7)
                        .scaleEffect((current ? 1 : 0.86) * magnification(dot))
                        .frame(width: pitch, height: 28)
                }
            }
        }
        .padding(.horizontal, 10)
        .background {
            Capsule()
                .fill(.clear)
                .glassEffect(scrubbing ? .regular : .identity, in: .capsule)
                .scaleEffect(scrubbing || reduceMotion ? 1 : 0.9)
        }
        // A 44pt-tall hit area around the 28pt row.
        .padding(.vertical, 8)
        .contentShape(.rect)
        .gesture(scrubGesture)
        .animation(.spring(duration: 0.2, bounce: 0), value: index)
        .animation(.spring(duration: 0.28, bounce: 0.25), value: scrubbing)
        .animation(.interactiveSpring(duration: 0.18), value: finger)
        .accessibilityElement()
        .accessibilityLabel("Plan")
        .accessibilityValue(count > 1 ? "\(index + 1) of \(count)" : "")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onSelect(min(index + 1, count - 1))
            case .decrement: onSelect(max(index - 1, 0))
            @unknown default: break
            }
        }
        .accessibilityHidden(count < 2)
    }

    /// Dots swell near the finger, up to 1.7× right under it, falling off over two dots.
    private func magnification(_ dot: Int) -> CGFloat {
        guard let finger, !reduceMotion else { return 1 }
        let center = 10 + pitch * (CGFloat(dot) + 0.5)
        let distance = abs(finger - center) / pitch
        return 1 + 0.7 * max(0, 1 - distance / 2)
    }

    private func dot(at x: CGFloat) -> Int {
        min(max(Int(((x - 10) / pitch).rounded(.down)), 0), count - 1)
    }

    private var scrubGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard count > 1 else { return }
                if touchStart == nil { touchStart = value.location.x }
                // Scrubbing starts once the finger slides; a tap goes through onSelect below.
                guard finger != nil || abs(value.location.x - (touchStart ?? 0)) > 6 else { return }
                if finger == nil { Haptics.shared.press() }
                finger = value.location.x
                onScrub(dot(at: value.location.x))
            }
            .onEnded { value in
                let wasScrubbing = finger != nil
                finger = nil
                touchStart = nil
                if !wasScrubbing { onSelect(dot(at: value.location.x)) }
            }
    }
}

/// The deck's drag. Today uses SwiftUI's drag on the whole card, so a drag inside it (the
/// ruler) keeps precedence. Week and Month use a UIKit pan that defers to the card's scroll.
private struct DeckGesture: ViewModifier {
    var cardsScroll: Bool
    var onChanged: (CGSize) -> Void
    var onEnded: (CGSize, CGSize) -> Void
    var onCancelled: () -> Void

    /// True while SwiftUI's drag is active. It resets on its own when the drag is cancelled,
    /// which `onEnded` never reports.
    @GestureState private var dragging = false

    func body(content: Content) -> some View {
        if !cardsScroll {
            content
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .updating($dragging) { _, state, _ in state = true }
                        .onChanged { onChanged($0.translation) }
                        .onEnded { onEnded($0.translation, $0.velocity) }
                )
                .onChange(of: dragging) { _, isDragging in
                    // After a normal end the deck has already reset, so this does nothing.
                    if !isDragging { onCancelled() }
                }
        } else {
            content.gesture(DeckPan(onChanged: onChanged, onEnded: onEnded))
        }
    }
}

/// The deck's pan for cards that scroll. Sideways it always wins (that's switching plans).
/// Vertically it wins over the card's scroll view only at the scroll's edges: pulling down
/// when scrolled to the top, pushing up at the bottom (or either way when the content fits).
/// Anywhere else it fails at once and the card scrolls.
struct DeckPan: UIGestureRecognizerRepresentable {
    var onChanged: (CGSize) -> Void
    var onEnded: (CGSize, CGSize) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let t = pan.translation(in: pan.view)
        let translation = CGSize(width: t.x, height: t.y)
        switch pan.state {
        case .began, .changed:
            onChanged(translation)
        case .ended:
            let v = pan.velocity(in: pan.view)
            onEnded(translation, CGSize(width: v.x, height: v.y))
        case .cancelled, .failed:
            onEnded(.zero, .zero)
        default:
            break
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer, let view = pan.view else { return false }
            let velocity = pan.velocity(in: view)
            if abs(velocity.x) > abs(velocity.y) { return true }
            guard let scroll = scrollView(at: pan.location(in: view), in: view) else { return true }
            let top = -scroll.adjustedContentInset.top
            let bottom = max(top, scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height)
            let offset = scroll.contentOffset.y
            return velocity.y > 0 ? offset <= top + 1 : offset >= bottom - 1
        }

        /// The card's scroll view waits for this pan to decide, so a pull at the edge never
        /// starts a scroll first.
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            otherGestureRecognizer.view is UIScrollView && otherGestureRecognizer is UIPanGestureRecognizer
        }

        /// The vertically scrolling scroll view under the finger, if any.
        private func scrollView(at point: CGPoint, in view: UIView) -> UIScrollView? {
            var candidate = view.hitTest(point, with: nil)
            while let current = candidate, current !== view {
                if let scroll = current as? UIScrollView, scroll.contentSize.height > 0, !(scroll.contentSize.width > scroll.bounds.width + 1) {
                    return scroll
                }
                candidate = current.superview
            }
            return nil
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
    /// The store's revision when `plan` was read; equal revisions mean an identical plan.
    let revision: Int
    let day: Day
    var isFront: Bool

    static func == (lhs: TodayCard, rhs: TodayCard) -> Bool {
        lhs.plan.id == rhs.plan.id && lhs.revision == rhs.revision && lhs.day == rhs.day
            && lhs.isFront == rhs.isFront
    }

    var body: some View {
        switch plan.kind {
        case .routine:
            RoutineTodayCard(plan: plan, day: day)
        case .metric:
            MetricTodayCard(plan: plan, day: day)
        case .streak:
            StreakTodayCard(plan: plan, day: day)
        }
    }
}

/// What Today shows before there are any plans: what goes here, and the way to add one.
struct EmptyDeck: View {
    var addMenu: (CGRect) -> MenuRequest

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.labelGap) {
            MonoLabel(text: "NO PLANS YET")
            Text("A schedule to write each week, a scale to log a number, or a streak to keep.")
                .font(.cadenceToday)
                .tracking(-0.5)
                .lineSpacing(4)
                .foregroundStyle(Color.ink)
            Spacer(minLength: 24)
            Label("Add a plan", systemImage: "plus")
                .font(.cadenceCallout)
                .foregroundStyle(Color.ink)
                .padding(.horizontal, 18)
                .frame(height: 44)
                .glassEffect(.regular.interactive(), in: .capsule)
                .pressMenu(label: "Add a plan", addMenu)
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .cardSurface()
        .padding(.top, Metrics.deckPeek)
    }
}
