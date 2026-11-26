import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

// MARK: - Model

/// Something a long-press lifted into focus: a whole plan's card, or one day of a plan (a row).
struct FocusItem: Equatable {
    enum Kind: Equatable {
        case plan(UUID)
        case day(UUID, Day, column: Int?)
    }

    let kind: Kind
    /// Where the original sits on screen, in window coordinates.
    let frame: CGRect
    /// Identifies the original so it can react while lifted.
    let key: String
    /// A row is drawn again on top of the backdrop (it can't rise out of its card). Nil for a
    /// whole card, which stays where it is, lifts itself, and shows through a cut in the backdrop.
    var preview: AnyView?

    var liftsInPlace: Bool { preview == nil }

    var planID: UUID {
        switch kind {
        case .plan(let id), .day(let id, _, _): id
        }
    }

    static func == (lhs: FocusItem, rhs: FocusItem) -> Bool {
        lhs.key == rhs.key && lhs.kind == rhs.kind && lhs.frame == rhs.frame
    }

    static func planKey(_ id: UUID) -> String { "plan:\(id.uuidString)" }
    static func dayKey(_ id: UUID, _ day: Day, _ column: Int?) -> String {
        "day:\(id.uuidString):\(day.key):\(column ?? -1)"
    }
}

/// Lets any view deep in the hierarchy ask the root to lift it into focus.
struct FocusRequest {
    var handler: (FocusItem) -> Void = { _ in }
    func callAsFunction(_ item: FocusItem) { handler(item) }
}

/// What a card hands down to the part of it that can be held (its header strip, or all of it).
struct CardLift {
    var press: (Bool) -> Void = { _ in }
    var lift: () -> Void = {}
}

extension EnvironmentValues {
    /// The key of the item currently lifted.
    @Entry var focusedKey: String? = nil
    @Entry var requestFocus = FocusRequest()
    @Entry var cardLift = CardLift()
}

/// Holds the latest on-screen frame without making the view re-render when it changes,
/// which happens on every frame while a list scrolls or a card is dragged.
private final class FrameBox {
    var frame: CGRect = .zero
}

/// How long a hold takes to lift. Short enough to feel immediate, long enough not to fire
/// while someone is just resting a thumb.
private let holdDuration = 0.3

// MARK: - Whole cards

extension View {
    /// Makes this card liftable as a whole. While held it eases down a touch (anticipation);
    /// when the hold completes it pops up past full size with a deeper shadow, and stays
    /// there, sharp, while everything around it blurs.
    func focusableCard(_ planID: UUID) -> some View {
        modifier(FocusableCard(planID: planID))
    }

    /// The part of a card that answers a long-press by lifting the whole card.
    func liftsCardOnHold() -> some View {
        modifier(LiftsCardOnHold())
    }
}

private struct FocusableCard: ViewModifier {
    let planID: UUID

    @Environment(\.focusedKey) private var focusedKey
    @Environment(\.requestFocus) private var requestFocus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var box = FrameBox()
    @State private var pressing = false

    func body(content: Content) -> some View {
        let key = FocusItem.planKey(planID)
        let focused = focusedKey == key
        let scale: CGFloat = reduceMotion ? 1 : focused ? 1.025 : pressing ? 0.975 : 1

        content
            .environment(\.cardLift, CardLift(
                press: { isPressing in pressing = isPressing },
                lift: { lift(key: key) }
            ))
            .background {
                // The lifted shadow lives on its own shape, so the card's contents aren't shadowed.
                RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                    .fill(Color.surface)
                    .shadow(color: Color.cardShadow.opacity(0.32), radius: 26, x: 0, y: 18)
                    .opacity(focused ? 1 : 0)
            }
            .scaleEffect(scale)
            // Pressing (which starts a beat into the touch, so a tap or the start of a swipe never
            // dips the card) eases down over the rest of the hold; lifting pops past full size;
            // letting go settles.
            .animation(
                pressing && !focused
                    ? .easeOut(duration: holdDuration - HoldGesture.pressDelay)
                    : .spring(duration: 0.26, bounce: focused ? 0.32 : 0),
                value: scale
            )
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { [box] frame in
                box.frame = frame
            }
            .accessibilityAction(named: "Options") { lift(key: key) }
    }

    private func lift(key: String) {
        pressing = false
        Haptics.shared.lift()
        requestFocus(FocusItem(kind: .plan(planID), frame: box.frame, key: key))
    }
}

private struct LiftsCardOnHold: ViewModifier {
    @Environment(\.cardLift) private var cardLift

    func body(content: Content) -> some View {
        content.gesture(HoldGesture(
            onPress: { cardLift.press($0) },
            onHold: { cardLift.lift() }
        ))
    }
}

/// A hold that never fights scrolling or swiping. It watches the touch without ever
/// recognizing (it fails when the finger lifts), so it can't take a touch from the scroll
/// view, the deck's drag, a row's swipe or a tap: they all keep working, and moving more than a
/// few points before the hold completes cancels it. SwiftUI's long-press, by contrast, holds
/// the touch and stops a scroll view from scrolling.
///
/// `onPress(true)` after `pressDelay` (so a tap or the start of a swipe never dips anything),
/// then `onHold` once the hold completes.
struct HoldGesture: UIGestureRecognizerRepresentable {
    var isEnabled = true
    var onPress: (Bool) -> Void
    var onHold: () -> Void

    static let pressDelay: TimeInterval = 0.12

    func makeUIGestureRecognizer(context: Context) -> TouchHoldRecognizer {
        let recognizer = TouchHoldRecognizer()
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesEnded = false
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: TouchHoldRecognizer, context: Context) {
        recognizer.isEnabled = isEnabled
        recognizer.onPress = onPress
        recognizer.onHold = onHold
    }

    /// The recognizer reports through its callbacks; it never changes state on its own.
    func handleUIGestureRecognizerAction(_ recognizer: TouchHoldRecognizer, context: Context) {}
}

/// Times a still finger. Stays `.possible` for the whole touch and fails at the end, so no
/// other gesture ever waits on it or is excluded by it.
final class TouchHoldRecognizer: UIGestureRecognizer {
    var onPress: (Bool) -> Void = { _ in }
    var onHold: () -> Void = {}

    private var start: CGPoint = .zero
    private var pressTask: Task<Void, Never>?
    private var holdTask: Task<Void, Never>?
    private var pressing = false
    private var tracking = false

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard !tracking, touches.count == 1, let touch = touches.first, event.allTouches?.count == 1 else {
            cancelHold()
            return
        }
        tracking = true
        start = touch.location(in: nil)
        pressTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(HoldGesture.pressDelay))
            guard let self, !Task.isCancelled, self.tracking else { return }
            self.pressing = true
            self.onPress(true)
        }
        holdTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(holdDuration))
            guard let self, !Task.isCancelled, self.tracking else { return }
            self.endPress()
            self.tracking = false
            self.onHold()
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard tracking, let point = touches.first?.location(in: nil) else { return }
        if hypot(point.x - start.x, point.y - start.y) > 10 { cancelHold() }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        cancelHold()
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        cancelHold()
        state = .failed
    }

    override func reset() {
        super.reset()
        cancelHold()
    }

    private func cancelHold() {
        tracking = false
        pressTask?.cancel()
        holdTask?.cancel()
        pressTask = nil
        holdTask = nil
        endPress()
    }

    private func endPress() {
        guard pressing else { return }
        pressing = false
        onPress(false)
    }
}

// MARK: - Rows

extension View {
    /// Long-press lifts a copy of this row above the blurred page, with its options below.
    /// While held, the row takes a soft wash in place (it can't move inside its card).
    func liftsOnHold<Preview: View>(
        _ kind: FocusItem.Kind,
        key: String,
        isEnabled: Bool = true,
        @ViewBuilder preview: @escaping () -> Preview
    ) -> some View {
        modifier(LiftsRowOnHold(kind: kind, key: key, isEnabled: isEnabled, preview: { AnyView(preview()) }))
    }
}

private struct LiftsRowOnHold: ViewModifier {
    let kind: FocusItem.Kind
    let key: String
    var isEnabled: Bool
    var preview: () -> AnyView

    @Environment(\.focusedKey) private var focusedKey
    @Environment(\.requestFocus) private var requestFocus
    @State private var box = FrameBox()
    @State private var pressing = false

    func body(content: Content) -> some View {
        content
            .overlay {
                Color.ink
                    .opacity(pressing ? 0.06 : 0)
                    .animation(pressing ? .easeOut(duration: holdDuration - HoldGesture.pressDelay) : .easeOut(duration: 0.12), value: pressing)
                    .allowsHitTesting(false)
            }
            // The copy on top stands in for it while lifted.
            .opacity(focusedKey == key ? 0 : 1)
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { [box] frame in
                box.frame = frame
            }
            .gesture(HoldGesture(
                isEnabled: isEnabled,
                onPress: { pressing = $0 },
                onHold: lift
            ))
            .accessibilityAction(named: "Options") {
                if isEnabled { lift() }
            }
    }

    private func lift() {
        Haptics.shared.lift()
        requestFocus(FocusItem(kind: kind, frame: box.frame, key: key, preview: preview()))
    }
}

// MARK: - The focus layer

/// What the focus layer can ask the root to do.
struct FocusActions {
    var editPlan: (UUID) -> Void
    var editDay: (UUID, Day) -> Void
    var editValue: (UUID, Day) -> Void
}

/// The focus view. Everything except the held item blurs and dims (a cut in the backdrop for a
/// whole card, which lifts in place; a lifted copy for a row), and the options pill rises near
/// the bottom of the screen, always in the same place. Its menus open over it, from it.
///
/// Choreography: the backdrop fades in over 0.18s as the item pops (it starts on the same frame
/// as the haptic); the pill follows 40ms later, rising 24pt with a little bounce. Closing runs
/// faster: pill out in 0.12s, backdrop in 0.16s, the item settles home at once.
struct FocusLayer: View {
    let item: FocusItem
    /// The part of the screen cards scroll within (below the header), in window coordinates.
    /// A card's cut in the backdrop never extends past it.
    var contentArea: CGRect = .infinite
    let actions: FocusActions
    /// The held item can start settling home (called as closing begins).
    var onRelease: () -> Void
    /// The layer can be removed (called once closing has finished).
    var onDismiss: () -> Void

    @Environment(Store.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    @State private var pillShown = false
    @State private var closing = false
    /// The plan as it was when lifted, so the pill can fade out even after a delete.
    @State private var snapshot: Plan?

    private let pillHeight: CGFloat = 56

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            // Clear of the home indicator with room to breathe, not pinned to the edge.
            let pillY = size.height - proxy.safeAreaInsets.bottom - 30 - pillHeight / 2
            let pillTop = pillY - pillHeight / 2

            ZStack(alignment: .topLeading) {
                // Tap anywhere outside the pill to close.
                Color.clear
                    .contentShape(.rect)
                    .onTapGesture { close() }
                    .accessibilityLabel("Close options")
                    .accessibilityAddTraits(.isButton)

                backdrop(size: size)
                    .opacity(shown ? 1 : 0)
                    .allowsHitTesting(false)

                if let preview = item.preview {
                    let offset = previewOffset(pillTop: pillTop, top: proxy.safeAreaInsets.top + 8)
                    preview
                        .environment(\.focusedKey, nil)
                        .frame(width: item.frame.width, height: item.frame.height)
                        .background(Color.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .background {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(Color.surface)
                                .shadow(color: Color.cardShadow.opacity(shown ? 0.3 : 0), radius: 22, x: 0, y: 14)
                        }
                        .scaleEffect(shown && !reduceMotion ? 1.04 : 1)
                        .offset(x: item.frame.minX, y: item.frame.minY + (shown ? offset : 0))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }

                FocusPill(item: item, fallback: snapshot, actions: actions, onDone: close)
                    .scaleEffect(pillShown || reduceMotion ? 1 : 0.92)
                    .opacity(pillShown ? 1 : 0)
                    .position(x: size.width / 2, y: pillY + (pillShown || reduceMotion ? 0 : 24))
            }
        }
        .ignoresSafeArea()
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { close() }
        .onAppear {
            snapshot = store.plan(item.planID)
            withAnimation(.easeOut(duration: 0.18)) { shown = true }
            withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.3, bounce: 0.22).delay(0.04)) {
                pillShown = true
            }
        }
    }

    /// Blur and dim over the whole screen, with a card-shaped cut where a card lifts in place.
    private func backdrop(size: CGSize) -> some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(colorScheme == .dark ? 0.34 : 0.1)
        }
        .mask {
            if item.liftsInPlace {
                // Cut out the card at its lifted size (it doesn't grow under Reduce Motion),
                // clipped to the content area so a card scrolled under the header doesn't
                // leave the header sharp.
                let grow: CGFloat = reduceMotion ? 1 : 1.025
                let card = CGRect(
                    x: item.frame.midX - item.frame.width * grow / 2 - 1,
                    y: item.frame.midY - item.frame.height * grow / 2 - 1,
                    width: item.frame.width * grow + 2,
                    height: item.frame.height * grow + 2
                )
                let visible = card.intersection(contentArea.isInfinite ? card : contentArea)
                Rectangle()
                    .overlay {
                        RoundedRectangle(cornerRadius: Metrics.cardRadius * grow, style: .continuous)
                            .frame(width: card.width, height: card.height)
                            .position(x: card.midX, y: card.midY)
                            .mask {
                                Rectangle()
                                    .frame(width: visible.width, height: visible.height)
                                    .position(x: visible.midX, y: visible.midY)
                            }
                            .blendMode(.destinationOut)
                    }
                    .compositingGroup()
            } else {
                Rectangle()
            }
        }
    }

    /// Rows near the bottom move up just enough to clear the pill.
    private func previewOffset(pillTop: CGFloat, top: CGFloat) -> CGFloat {
        let bottom = item.frame.maxY + item.frame.height * 0.02
        let overflow = bottom - (pillTop - 16)
        guard overflow > 0 else { return 0 }
        return -min(overflow, max(0, item.frame.minY - top))
    }

    private func close() {
        guard !closing else { return }
        closing = true
        onRelease()
        withAnimation(.easeIn(duration: 0.12)) { pillShown = false }
        withAnimation(.easeOut(duration: 0.16)) { shown = false }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(170))
            onDismiss()
        }
    }
}

// MARK: - The options pill

/// A Liquid Glass pill with the two actions that matter (a green Done, a red Delete for a
/// plan) and ⋯ for the rest. ⋯ and Delete open panels that rise out of the pill and point
/// back at their button; the pill itself stays put underneath.
private struct FocusPill: View {
    let item: FocusItem
    let fallback: Plan?
    let actions: FocusActions
    var onDone: () -> Void

    @Environment(Store.self) private var store
    @State private var box = PillFrameBox()

    var body: some View {
        if let plan = store.plan(item.planID) ?? fallback {
            HStack(spacing: 4) {
                switch item.kind {
                case .plan:
                    planActions(plan)
                case .day(_, let day, let column):
                    dayActions(plan, day: day, column: column)
                }
            }
            .padding(.horizontal, 6)
            .frame(height: 56)
            .glassEffect(.regular, in: .capsule)
            .fixedSize()
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { [box] frame in
                box.frame = frame
            }
        }
    }

    // MARK: Plan

    @ViewBuilder
    private func planActions(_ plan: Plan) -> some View {
        let today = store.today
        let status = plan.status(on: today)
        let done = status == .done

        if plan.isMetric {
            let changed = store.hasDraftChange(plan)
            DoneButton(title: done ? (changed ? "Update" : "Logged") : "Log", isDone: done && !changed) {
                if plan.value(on: today) == nil {
                    onDone()
                    actions.editValue(plan.id, today)
                } else {
                    let change = withAnimation(Motion.settle) { store.toggleDone(plan.id, on: today) }
                    Feedback.play(for: change)
                    onDone()
                }
            }
            .disabled(done && !changed)
        } else {
            DoneButton(title: "Done", isDone: done) {
                let change = withAnimation(Motion.settle) { store.toggleDone(plan.id, on: today) }
                Feedback.play(for: change)
                onDone()
            }
            .disabled(done || !plan.isPlanned(today))
        }

        PillIcon(systemName: "trash", tint: .danger)
            .pressMenu(label: "Delete \(plan.name)") { _ in
                MenuRequest(
                    anchor: box.frame,
                    placement: .aboveCenter,
                    title: "Delete \(plan.name.isEmpty ? "this plan" : plan.name)?",
                    message: "Its weeks and check marks go with it.",
                    sections: [[
                        MenuItem(id: "delete", title: "Delete plan", role: .destructive) {
                            onDone()
                            withAnimation(Motion.deck) { store.delete(plan.id) }
                            Feedback.play(.skip)
                        },
                    ]],
                    tailX: box.trash.midX,
                    choosesOnRelease: false
                )
            }
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { [box] frame in
                box.trash = frame
            }

        PillIcon(systemName: "ellipsis")
            .pressMenu(label: "More") { frame in
                MenuRequest(
                    anchor: box.frame,
                    placement: .aboveCenter,
                    sections: planMenu(plan, status: status),
                    tailX: frame.midX
                )
            }
    }

    private func planMenu(_ plan: Plan, status: DayStatus) -> [[MenuItem]] {
        let today = store.today
        var marking: [MenuItem] = []
        if !plan.record(on: today).isEmpty {
            marking.append(MenuItem(id: "undo", title: "Undo", systemImage: "arrow.uturn.backward") {
                let change = withAnimation(Motion.settle) { store.clearDay(plan.id, on: today) }
                Feedback.play(for: change)
                onDone()
            })
        }
        if status != .skipped && (plan.isMetric || plan.isPlanned(today)) {
            marking.append(MenuItem(id: "skip", title: "Skip today", systemImage: "xmark") {
                let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: today) }
                Feedback.play(for: change)
                onDone()
            })
        }
        let editing = [
            MenuItem(id: "edit", title: "Edit plan", systemImage: "square.and.pencil") {
                onDone()
                actions.editPlan(plan.id)
            },
            MenuItem(id: "today", title: plan.isMetric ? "Change today's value" : "Edit today", systemImage: "pencil") {
                onDone()
                plan.isMetric ? actions.editValue(plan.id, today) : actions.editDay(plan.id, today)
            },
        ]
        let more = [
            MenuItem(id: "duplicate", title: "Duplicate", systemImage: "plus.square.on.square") {
                var copy = plan
                copy.id = UUID()
                copy.name = "\(plan.name) copy"
                copy.records = [:]
                withAnimation(Motion.standard) { store.add(copy) }
                Feedback.play(.check(step: 0))
                onDone()
            },
        ]
        return [marking, editing, more].filter { !$0.isEmpty }
    }

    // MARK: Day

    @ViewBuilder
    private func dayActions(_ plan: Plan, day: Day, column: Int?) -> some View {
        let status = plan.status(on: day)
        let isFuture = day > store.today

        if plan.isMetric {
            DoneButton(title: plan.value(on: day) == nil ? "Log" : "Change", isDone: false) {
                onDone()
                actions.editValue(plan.id, day)
            }
            .disabled(isFuture)
        } else {
            let mark: Mark? = column.map { plan.mark(on: day, column: $0) } ?? (status == .done ? .done : nil)
            DoneButton(title: "Done", isDone: mark == .done) {
                let change = withAnimation(Motion.settle) {
                    if let column { return store.toggleColumn(plan.id, on: day, column: column) }
                    return store.toggleDone(plan.id, on: day)
                }
                Feedback.play(for: change, step: column ?? 0)
                onDone()
            }
            .disabled(mark == .done || !plan.isPlanned(day))
        }

        PillIcon(systemName: "ellipsis")
            .pressMenu(label: "More") { frame in
                MenuRequest(
                    anchor: box.frame,
                    placement: .aboveCenter,
                    sections: dayMenu(plan, day: day, status: status),
                    tailX: frame.midX
                )
            }
    }

    private func dayMenu(_ plan: Plan, day: Day, status: DayStatus) -> [[MenuItem]] {
        var marking: [MenuItem] = []
        if !plan.record(on: day).isEmpty {
            marking.append(MenuItem(id: "undo", title: plan.isMetric ? "Clear value" : "Undo", systemImage: "arrow.uturn.backward") {
                let change = withAnimation(Motion.settle) { store.clearDay(plan.id, on: day) }
                Feedback.play(for: change)
                onDone()
            })
        }
        if status != .skipped && (plan.isMetric ? day <= store.today : plan.isPlanned(day)) {
            marking.append(MenuItem(id: "skip", title: "Skip", systemImage: "xmark") {
                let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: day) }
                Feedback.play(for: change)
                onDone()
            })
        }
        var editing: [MenuItem] = []
        if !plan.isMetric {
            editing.append(MenuItem(id: "day", title: "Edit this day", systemImage: "pencil") {
                onDone()
                actions.editDay(plan.id, day)
            })
            if plan.overrides[day.key] != nil {
                editing.append(MenuItem(id: "reset", title: "Use the week's plan", systemImage: "arrow.counterclockwise") {
                    store.setOverride(plan.id, on: day, items: nil)
                    Feedback.play(.uncheck)
                    onDone()
                })
            }
        }
        editing.append(MenuItem(id: "edit", title: "Edit \(plan.name.isEmpty ? "plan" : plan.name)", systemImage: "square.and.pencil") {
            onDone()
            actions.editPlan(plan.id)
        })
        return [marking, editing].filter { !$0.isEmpty }
    }
}

/// Where the pill and its delete button are, for the panels that rise out of them.
private final class PillFrameBox {
    var frame: CGRect = .zero
    var trash: CGRect = .zero
}

/// The pill's main action, in green. Once done it shows that, quietly, instead of offering
/// to undo (Undo lives under ⋯).
private struct DoneButton: View {
    let title: String
    var isDone: Bool
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: isDone ? "checkmark.circle.fill" : "checkmark")
                    .font(.system(size: 17, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
                Text(title)
                    .font(.cadenceBody)
                    .lineLimit(1)
            }
            .foregroundStyle(isEnabled || isDone ? Color.success : Color.inkFaint)
            .padding(.horizontal, 16)
            .frame(height: 44)
            .background(Color.success.opacity(isEnabled ? 0.14 : 0.07), in: Capsule())
            .contentShape(.capsule)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(isDone ? "\(title), done" : title)
    }
}

private struct PillIcon: View {
    let systemName: String
    var tint: Color = .ink
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(isEnabled ? tint : Color.inkFaint)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}
