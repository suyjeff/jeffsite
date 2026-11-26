import SwiftUI
import UIKit

/// Where a card sits in the deck, for the view drawing it.
struct DeckSlot {
    var isFront: Bool
    /// −1…1 from the front card's sideways drag (Today only).
    var swipe: CGFloat
}

/// The deck every view is built on: one card per plan, stacked, with the next card peeking
/// above. The same physical gestures move between plans everywhere:
/// - Pull the card down: the peeking card comes forward. Push it up: the previous one returns.
///   The card follows the finger 1:1 (rubber-banding where it leads nowhere), the card behind
///   rises with it, and on release the motion carries the finger's velocity.
/// - Tap the peek to bring it forward.
///
/// On Today the cards also swipe sideways: right for done, left to skip, thrown off with the
/// finger's velocity and tucked in at the back. On Week and Month the cards scroll inside;
/// the deck takes the drag only once the card's own scroll is at its top (pulling down) or
/// bottom (pushing up), so scrolling and switching never fight.
struct PlanDeck<Card: View>: View {
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.focusedKey) private var focusedKey

    @Binding var frontID: UUID?
    /// Sideways swipes mark the day (Today). Otherwise the deck only moves vertically.
    var swipesToMark: Bool
    @ViewBuilder var card: (Plan, DeckSlot) -> Card

    @State private var drag: CGSize = .zero
    /// 0…1: how far the card behind has been drawn forward by the current gesture.
    @State private var promote: CGFloat = 0
    @State private var axis: Axis?
    @State private var armed = false
    @State private var flying = false
    @State private var reentering: UUID?

    private let commitDistance: CGFloat = 110
    private let pullDistance: CGFloat = 88

    var body: some View {
        let plans = store.plans
        Group {
            if !plans.isEmpty {
                GeometryReader { proxy in
                    let width = proxy.size.width
                    let frontIndex = store.index(of: frontID) ?? 0
                    ZStack(alignment: .top) {
                        ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                            let depth = (index - frontIndex + plans.count) % plans.count
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
                        swipesToMark: swipesToMark,
                        onChanged: { changed($0, count: plans.count) },
                        onEnded: { ended($0, velocity: $1, width: width, count: plans.count) }
                    ))
                }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 14)
        .padding(.bottom, Metrics.deckBottom)
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

        Group {
            // Only the front card and the one about to come forward are drawn in full; the
            // rest of the stack is blank paper, so a deep deck costs nothing.
            if depth <= 1 {
                card(plan, DeckSlot(isFront: isFront, swipe: isFront ? swipeProgress : 0))
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
        // Only one card peeks: deeper cards sit behind it, fading up as they come forward,
        // instead of rising above the deck into the header.
        .offset(y: -Metrics.deckPeek * min(visibleDepth, 1))
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

    private func changed(_ t: CGSize, count: Int) {
        guard !flying else { return }
        // A hold lifted the card before the finger moved: leave it where it is.
        guard focusedKey == nil else {
            if drag != .zero { settle(velocity: .zero) }
            return
        }
        if axis == nil {
            axis = swipesToMark && abs(t.width) > abs(t.height) ? .horizontal : .vertical
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
                drag = CGSize(width: 0, height: Motion.rubberband(t.height * 0.55, limit: 40))
                promote = min(1, t.height / pullDistance)
            } else if count > 1 {
                // Pushing up lifts the card away toward the previous one.
                drag = CGSize(width: 0, height: Motion.rubberband(t.height * 0.55, limit: 40))
                promote = 0
            } else {
                drag = CGSize(width: 0, height: Motion.resist(t.height, dimension: 420))
                promote = 0
            }
            setArmed(count > 1 && abs(t.height) >= pullDistance)
        case nil:
            break
        }
    }

    private func ended(_ t: CGSize, velocity v: CGSize, width: CGFloat, count: Int) {
        guard !flying else { return }
        let current = axis
        axis = nil
        armed = false
        guard focusedKey == nil else { return }
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
            if t.height > pullDistance || (v.height > 650 && t.height > 24) {
                cycle(by: 1, count: count, velocity: v.height)
            } else if t.height < -pullDistance || (v.height < -650 && t.height < -24) {
                cycle(by: -1, count: count, velocity: v.height)
            } else {
                settle(velocity: v)
            }
        default:
            settle(velocity: v)
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
            : Motion.release(velocity: velocity, distance: target - drag.width, duration: 0.36)
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
            withAnimation(.easeOut(duration: 0.2)) { reentering = nil }
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
                duration: 0.3,
                bounce: bounce
            )
        withAnimation(animation) {
            drag = .zero
            promote = 0
        }
    }

    /// Brings the next (+1) or previous (−1) plan to the front, carrying the finger's
    /// velocity into the settle so the release has no seam.
    private func cycle(by step: Int, count: Int, velocity: CGFloat = 0) {
        guard count > 1, !flying else { return }
        let index = store.index(of: frontID) ?? 0
        Feedback.play(.cycle)
        let animation = reduceMotion
            ? Motion.standard
            : Motion.release(velocity: velocity, distance: -drag.height, duration: 0.32, bounce: 0.1)
        withAnimation(animation) {
            frontID = store.plans[(index + step + count) % count].id
            drag = .zero
            promote = 0
        }
    }
}

/// The deck's drag. Today uses SwiftUI's drag on the whole card (both axes). Week and Month
/// use a UIKit pan that only begins vertically, and only when the card's own scroll is at the
/// edge the finger is pulling away from; until then the card's scroll view has the touch.
private struct DeckGesture: ViewModifier {
    var swipesToMark: Bool
    var onChanged: (CGSize) -> Void
    var onEnded: (CGSize, CGSize) -> Void

    func body(content: Content) -> some View {
        if swipesToMark {
            content.gesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { onChanged($0.translation) }
                    .onEnded { onEnded($0.translation, $0.velocity) }
            )
        } else {
            content.gesture(DeckPan(onChanged: onChanged, onEnded: onEnded))
        }
    }
}

/// A vertical pan for decks whose cards scroll. It wins over the card's scroll view only at
/// the scroll's edges: pulling down when scrolled to the top, pushing up at the bottom (or
/// either way when the content fits). Anywhere else it fails at once and the card scrolls.
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
        let translation = CGSize(width: 0, height: pan.translation(in: pan.view).y)
        switch pan.state {
        case .began, .changed:
            onChanged(translation)
        case .ended:
            onEnded(translation, CGSize(width: 0, height: pan.velocity(in: pan.view).y))
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
            guard abs(velocity.y) > abs(velocity.x) * 1.2 else { return false }
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
    var swipe: CGFloat

    static func == (lhs: TodayCard, rhs: TodayCard) -> Bool {
        lhs.plan.id == rhs.plan.id && lhs.revision == rhs.revision && lhs.day == rhs.day
            && lhs.isFront == rhs.isFront && lhs.swipe == rhs.swipe
    }

    var body: some View {
        switch plan.kind {
        case .routine:
            RoutineTodayCard(plan: plan, day: day, swipe: swipe)
        case .metric:
            MetricTodayCard(plan: plan, day: day, swipe: swipe)
        case .streak:
            StreakTodayCard(plan: plan, day: day, swipe: swipe)
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
