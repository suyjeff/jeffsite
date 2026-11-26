import SwiftUI

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
    /// Pass `inScrollView` when the card scrolls, so the hold never fights the scroll.
    func liftsCardOnHold(inScrollView: Bool = false) -> some View {
        modifier(LiftsCardOnHold(inScrollView: inScrollView))
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
            // Pressing eases down over the rest of the hold, after a short beat so a tap or the
            // start of a swipe never dips the card; lifting pops past full size; letting go settles.
            .animation(
                pressing && !focused
                    ? .easeOut(duration: holdDuration - 0.12).delay(0.12)
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
    var inScrollView: Bool

    @Environment(\.cardLift) private var cardLift
    @GestureState private var holding = false

    func body(content: Content) -> some View {
        if inScrollView {
            content
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: holdDuration, maximumDistance: 10)
                        .updating($holding) { value, state, _ in state = value }
                        .onEnded { _ in cardLift.lift() }
                )
                .onChange(of: holding) { _, isHolding in cardLift.press(isHolding) }
        } else {
            content
                .onLongPressGesture(minimumDuration: holdDuration, maximumDistance: 10) {
                    cardLift.lift()
                } onPressingChanged: { isPressing in
                    cardLift.press(isPressing)
                }
        }
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
        inScrollView: Bool = false,
        @ViewBuilder preview: @escaping () -> Preview
    ) -> some View {
        modifier(LiftsRowOnHold(kind: kind, key: key, isEnabled: isEnabled, inScrollView: inScrollView, preview: { AnyView(preview()) }))
    }
}

private struct LiftsRowOnHold: ViewModifier {
    let kind: FocusItem.Kind
    let key: String
    var isEnabled: Bool
    var inScrollView: Bool
    var preview: () -> AnyView

    @Environment(\.focusedKey) private var focusedKey
    @Environment(\.requestFocus) private var requestFocus
    @State private var box = FrameBox()
    @State private var pressing = false
    @GestureState private var holding = false

    func body(content: Content) -> some View {
        let lifted = content
            .overlay {
                Color.ink
                    .opacity(pressing || holding ? 0.06 : 0)
                    .animation(pressing || holding ? .easeOut(duration: holdDuration) : .easeOut(duration: 0.12), value: pressing || holding)
                    .allowsHitTesting(false)
            }
            // The copy on top stands in for it while lifted.
            .opacity(focusedKey == key ? 0 : 1)
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { [box] frame in
                box.frame = frame
            }
            .accessibilityAction(named: "Options") {
                if isEnabled { lift() }
            }

        if inScrollView {
            lifted.simultaneousGesture(
                LongPressGesture(minimumDuration: holdDuration, maximumDistance: 10)
                    .updating($holding) { value, state, _ in state = value }
                    .onEnded { _ in
                        guard isEnabled else { return }
                        lift()
                    },
                isEnabled: isEnabled
            )
        } else {
            lifted.onLongPressGesture(minimumDuration: holdDuration, maximumDistance: 10) {
                guard isEnabled else { return }
                pressing = false
                lift()
            } onPressingChanged: { isPressing in
                pressing = isEnabled && isPressing
            }
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
/// whole card, which lifts in place; a lifted copy for a row), and the options pill rises from
/// the bottom of the screen, always in the same place.
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
            let pillY = size.height - proxy.safeAreaInsets.bottom - 14 - pillHeight / 2
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

/// A Liquid Glass pill: the most likely action named in full, the rest as icons, delete
/// behind a confirmation popover and anything else under ⋯.
private struct FocusPill: View {
    let item: FocusItem
    let fallback: Plan?
    let actions: FocusActions
    var onDone: () -> Void

    @Environment(Store.self) private var store
    @State private var confirmingDelete = false

    var body: some View {
        if let plan = store.plan(item.planID) ?? fallback {
            HStack(spacing: 2) {
                switch item.kind {
                case .plan:
                    planActions(plan)
                case .day(_, let day, let column):
                    dayActions(plan, day: day, column: column)
                }
            }
            .padding(.horizontal, 6)
            .frame(height: 56)
            .glassEffect(.regular.interactive(), in: .capsule)
            .fixedSize()
        }
    }

    // MARK: Plan

    @ViewBuilder
    private func planActions(_ plan: Plan) -> some View {
        let today = store.today
        let status = plan.status(on: today)

        PillButton(title: "Edit", systemImage: "square.and.pencil") {
            onDone()
            actions.editPlan(plan.id)
        }

        if plan.isMetric || plan.isPlanned(today) {
            PillButton(
                systemImage: status == .done ? "arrow.uturn.backward" : "checkmark",
                label: status == .done ? "Mark today not done" : (plan.isMetric ? "Log today" : "Mark today done")
            ) {
                if plan.isMetric && plan.value(on: today) == nil {
                    onDone()
                    actions.editValue(plan.id, today)
                    return
                }
                let change = withAnimation(Motion.settle) { store.toggleDone(plan.id, on: today) }
                Feedback.play(for: change)
                onDone()
            }
        }

        if plan.isMetric || plan.isPlanned(today) {
            PillButton(
                systemImage: status == .skipped ? "arrow.uturn.backward" : "xmark",
                label: status == .skipped ? "Undo not today" : "Not today"
            ) {
                let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: today) }
                Feedback.play(for: change)
                onDone()
            }
        }

        deleteButton(plan)

        Menu {
            Button(plan.isMetric ? "Edit today's value…" : "Edit today…", systemImage: "pencil") {
                onDone()
                plan.isMetric ? actions.editValue(plan.id, today) : actions.editDay(plan.id, today)
            }
            Button("Duplicate", systemImage: "plus.square.on.square") {
                var copy = plan
                copy.id = UUID()
                copy.name = "\(plan.name) copy"
                copy.records = [:]
                withAnimation(Motion.standard) { store.add(copy) }
                Feedback.play(.check(step: 0))
                onDone()
            }
        } label: {
            PillIcon(systemName: "ellipsis")
        }
        .accessibilityLabel("More")
    }

    // MARK: Day

    @ViewBuilder
    private func dayActions(_ plan: Plan, day: Day, column: Int?) -> some View {
        let status = plan.status(on: day)
        let isFuture = day > store.today

        if plan.isMetric {
            PillButton(title: plan.value(on: day) == nil ? "Log" : "Change", systemImage: "number") {
                onDone()
                actions.editValue(plan.id, day)
            }
            .disabled(isFuture)
        } else {
            let mark: Mark? = column.map { plan.mark(on: day, column: $0) } ?? (status == .done ? .done : nil)
            PillButton(
                title: mark == .done ? "Undo" : "Done",
                systemImage: mark == .done ? "arrow.uturn.backward" : "checkmark"
            ) {
                let change = withAnimation(Motion.settle) {
                    if let column { return store.toggleColumn(plan.id, on: day, column: column) }
                    return store.toggleDone(plan.id, on: day)
                }
                Feedback.play(for: change, step: column ?? 0)
                onDone()
            }
            .disabled(!plan.isPlanned(day))
        }

        PillButton(
            systemImage: status == .skipped ? "arrow.uturn.backward" : "xmark",
            label: status == .skipped ? "Undo not today" : "Not today"
        ) {
            let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: day) }
            Feedback.play(for: change)
            onDone()
        }
        .disabled(!plan.isMetric && !plan.isPlanned(day))

        if !plan.isMetric {
            PillButton(systemImage: "pencil", label: "Edit this day") {
                onDone()
                actions.editDay(plan.id, day)
            }
        }

        Menu {
            Button("Edit \(plan.name)…", systemImage: "square.and.pencil") {
                onDone()
                actions.editPlan(plan.id)
            }
            if plan.isMetric, plan.value(on: day) != nil {
                Button("Clear value", systemImage: "trash", role: .destructive) {
                    withAnimation(Motion.settle) { store.setValue(plan.id, on: day, value: nil) }
                    Feedback.play(.uncheck)
                    onDone()
                }
            }
            if !plan.isMetric, plan.overrides[day.key] != nil {
                Button("Use the week's plan", systemImage: "arrow.uturn.backward") {
                    store.setOverride(plan.id, on: day, items: nil)
                    Feedback.play(.uncheck)
                    onDone()
                }
            }
        } label: {
            PillIcon(systemName: "ellipsis")
        }
        .accessibilityLabel("More")
    }

    // MARK: Delete

    private func deleteButton(_ plan: Plan) -> some View {
        PillButton(systemImage: "trash", label: "Delete \(plan.name)") {
            Haptics.shared.tick()
            confirmingDelete = true
        }
        .popover(isPresented: $confirmingDelete, arrowEdge: .bottom) {
            DeleteConfirmation(name: plan.name) {
                confirmingDelete = false
                onDone()
                withAnimation(Motion.deck) { store.delete(plan.id) }
                Feedback.play(.skip)
            }
            .presentationCompactAdaptation(.popover)
        }
    }
}

/// The small glass popover that grows out of the trash button.
private struct DeleteConfirmation: View {
    let name: String
    var onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Delete \(name.isEmpty ? "this plan" : name)?")
                    .font(.cadenceCallout)
                    .foregroundStyle(Color.ink)
                Text("Its weeks and check marks go with it.")
                    .font(.cadenceSubhead)
                    .foregroundStyle(Color.inkSecondary)
            }
            Button(role: .destructive, action: onDelete) {
                Text("Delete plan")
                    .font(.cadenceCallout)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
            }
            .buttonStyle(.glassProminent)
            .tint(.red)
        }
        .padding(16)
        .frame(width: 240)
    }
}

private struct PillButton: View {
    var title: String?
    let systemImage: String
    var label: String?
    let action: () -> Void

    init(title: String, systemImage: String, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.label = title
        self.action = action
    }

    init(systemImage: String, label: String, action: @escaping () -> Void) {
        self.title = nil
        self.systemImage = systemImage
        self.label = label
        self.action = action
    }

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            if let title {
                // Icon then name, for the one action most likely wanted.
                HStack(spacing: 8) {
                    Image(systemName: systemImage)
                        .font(.system(size: 17, weight: .semibold))
                    Text(title)
                        .font(.cadenceBody)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .foregroundStyle(isEnabled ? Color.ink : Color.inkFaint)
                .padding(.horizontal, 14)
                .frame(height: 44)
                .contentShape(.rect)
            } else {
                PillIcon(systemName: systemImage)
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label ?? "")
    }
}

private struct PillIcon: View {
    let systemName: String
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(isEnabled ? Color.ink : Color.inkFaint)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}
