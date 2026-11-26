import SwiftUI

// MARK: - Model

/// Something a long-press lifted into focus: a whole plan (from the top of its card) or one
/// day of a plan (a row, or one column of a row).
struct FocusItem: Equatable {
    enum Kind: Equatable {
        case plan(UUID)
        case day(UUID, Day, column: Int?)
    }

    let kind: Kind
    /// Where the original sits on screen, in window coordinates.
    let frame: CGRect
    /// Identifies the original so it can hide while its lifted copy is on screen.
    let key: String

    var planID: UUID {
        switch kind {
        case .plan(let id), .day(let id, _, _): id
        }
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

/// Lifts the enclosing `liftOnHold` view now, without the hold: for a visible ⋯ inside it.
struct LiftNow {
    var handler: () -> Void = {}
    func callAsFunction() { handler() }
}

extension EnvironmentValues {
    /// The key of the item currently lifted, so the original can step aside.
    @Entry var focusedKey: String? = nil
    @Entry var requestFocus = FocusRequest()
    @Entry var liftNow = LiftNow()
}

// MARK: - Holding to lift

extension View {
    /// Long-press lifts this view into the focus layer with an options pill.
    /// While the finger holds, it eases down to 0.97 (anticipation); a detent marks the lift.
    func liftOnHold(_ kind: FocusItem.Kind, key: String, isEnabled: Bool = true) -> some View {
        modifier(LiftOnHold(kind: kind, key: key, isEnabled: isEnabled))
    }
}

private struct LiftOnHold: ViewModifier {
    let kind: FocusItem.Kind
    let key: String
    var isEnabled: Bool

    @Environment(\.focusedKey) private var focusedKey
    @Environment(\.requestFocus) private var requestFocus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var frame: CGRect = .zero
    @State private var pressing = false

    func body(content: Content) -> some View {
        content
            .environment(\.liftNow, LiftNow {
                Haptics.shared.detent(intensity: 0.6)
                requestFocus(FocusItem(kind: kind, frame: frame, key: key))
            })
            // The squash starts after a beat, so a scroll that merely begins here never flickers.
            .scaleEffect(pressing && !reduceMotion ? 0.97 : 1)
            .animation(pressing ? .easeOut(duration: 0.3).delay(0.1) : .spring(duration: 0.25, bounce: 0), value: pressing)
            .opacity(focusedKey == key ? 0 : 1)
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { newFrame in
                frame = newFrame
            }
            .onLongPressGesture(minimumDuration: 0.4, maximumDistance: 10) {
                guard isEnabled else { return }
                pressing = false
                Haptics.shared.detent(intensity: 0.75)
                requestFocus(FocusItem(kind: kind, frame: frame, key: key))
            } onPressingChanged: { isPressing in
                pressing = isEnabled && isPressing
            }
            .accessibilityAction(named: "Options") {
                requestFocus(FocusItem(kind: kind, frame: frame, key: key))
            }
    }
}

// MARK: - Card headers

/// The top of a card as a handle: content on the left, a quiet ⋯ on the right. Holding
/// anywhere on it, or tapping ⋯, lifts the plan with its options pill. The ⋯ is the visible
/// cue that the long-press exists.
struct FocusableHeader<Content: View>: View {
    let planID: UUID
    var minHeight: CGFloat = 60
    var background: Color = .clear
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 8) {
            content
            FocusMoreButton()
        }
        .padding(.leading, Metrics.cardPadding)
        // The ⋯ hit area is 44pt wide; this lands its glyph on the 24pt content edge.
        .padding(.trailing, Metrics.cardPadding - 16)
        .frame(minHeight: minHeight)
        .background(background)
        .contentShape(.rect)
        .liftOnHold(.plan(planID), key: FocusItem.planKey(planID))
    }
}

struct FocusMoreButton: View {
    @Environment(\.liftNow) private var liftNow

    var body: some View {
        Button {
            liftNow()
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.inkMuted)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Plan options")
    }
}

// MARK: - The focus layer

/// What the focus layer can ask the root to do.
struct FocusActions {
    var editPlan: (UUID) -> Void
    var editDay: (UUID, Day) -> Void
    var editValue: (UUID, Day) -> Void
}

/// Dims the screen, lifts a copy of the held item where it was, and floats the options
/// pill beneath it (or above, if there's no room).
///
/// Choreography, one motion: the dim fades in while the item lifts (scale 1 → 1.03, shadow
/// deepens); 50 ms later the pill scales in from the item's edge. Dismissal reverses it,
/// shorter: pill first, then the item settles home and the dim clears.
struct FocusLayer: View {
    let item: FocusItem
    let actions: FocusActions
    var onDismiss: () -> Void

    @Environment(Store.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lifted = false
    @State private var pillShown = false
    @State private var pillSize: CGSize = CGSize(width: 260, height: 56)

    private let gap: CGFloat = 12
    private let previewMaxHeight: CGFloat = 280

    var body: some View {
        GeometryReader { proxy in
            let safe = proxy.safeAreaInsets
            let size = proxy.size
            let layout = placement(in: size, safe: safe)

            ZStack(alignment: .topLeading) {
                Color.black
                    .opacity(lifted ? (colorScheme == .dark ? 0.45 : 0.2) : 0)
                    .contentShape(.rect)
                    .onTapGesture { dismiss() }
                    .accessibilityLabel("Close options")
                    .accessibilityAddTraits(.isButton)

                FocusPreview(item: item)
                    .frame(width: item.frame.width, height: layout.previewHeight, alignment: .top)
                    .clipShape(RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                    .background {
                        RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                            .fill(Color.surface)
                            .shadow(color: Color.cardShadow.opacity(lifted ? 0.28 : 0.12), radius: lifted ? 18 : 7, y: lifted ? 14 : 7)
                    }
                    .scaleEffect(lifted && !reduceMotion ? 1.03 : 1)
                    .offset(x: item.frame.minX, y: lifted ? layout.previewY : item.frame.minY)
                    .allowsHitTesting(false)

                FocusPill(item: item, actions: actions, onDone: dismiss)
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { pillSize = $0 }
                    .scaleEffect(pillShown ? 1 : (reduceMotion ? 1 : 0.8), anchor: layout.pillBelow ? .top : .bottom)
                    .opacity(pillShown ? 1 : 0)
                    .offset(x: layout.pillX, y: layout.pillY + (pillShown || reduceMotion ? 0 : (layout.pillBelow ? -8 : 8)))
            }
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.34, bounce: 0.22)) {
                lifted = true
            }
            withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.32, bounce: 0.28).delay(0.05)) {
                pillShown = true
            }
        }
    }

    private struct Placement {
        var previewY: CGFloat
        var previewHeight: CGFloat
        var pillX: CGFloat
        var pillY: CGFloat
        var pillBelow: Bool
    }

    /// Below the item if it fits; otherwise lift the item up until it does; for an item at
    /// the very top with no room either way, the pill goes above.
    private func placement(in size: CGSize, safe: EdgeInsets) -> Placement {
        let height = min(item.frame.height, previewMaxHeight)
        let top = safe.top + 8
        let bottom = size.height - safe.bottom - 8
        var y = item.frame.minY
        let needed = height + gap + pillSize.height
        if y + needed > bottom {
            y = max(top, bottom - needed)
        }
        let below = y + needed <= bottom
        let pillY = below ? y + height + gap : max(top, y - gap - pillSize.height)
        let centered = item.frame.midX - pillSize.width / 2
        let pillX = min(max(centered, Metrics.gutter - 8), size.width - pillSize.width - (Metrics.gutter - 8))
        return Placement(previewY: y, previewHeight: height, pillX: pillX, pillY: pillY, pillBelow: below)
    }

    private func dismiss() {
        withAnimation(.easeOut(duration: 0.12)) { pillShown = false }
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.26, bounce: 0)) { lifted = false }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(240))
            onDismiss()
        }
    }
}

// MARK: - Lifted copies

/// The lifted copy of the held item: the same type, set and spacing as where it came from.
private struct FocusPreview: View {
    let item: FocusItem
    @Environment(Store.self) private var store

    var body: some View {
        if let plan = store.plan(item.planID) {
            switch item.kind {
            case .plan:
                let progress = plan.progress(in: store.today.weekDays)
                HStack {
                    MonoLabel(text: plan.name.uppercased())
                    Spacer(minLength: 12)
                    if !plan.isMetric {
                        CountPill(done: progress.done, total: progress.planned)
                    }
                }
                .padding(.horizontal, Metrics.cardPadding)
                .frame(maxHeight: .infinity)
            case .day(_, let day, let column):
                DayPreview(plan: plan, day: day, column: column, today: store.today)
            }
        }
    }
}

private struct DayPreview: View {
    let plan: Plan
    let day: Day
    let column: Int?
    let today: Day

    var body: some View {
        let items = plan.items(on: day)
        let status = plan.status(on: day)
        VStack(alignment: .leading, spacing: Metrics.labelGap) {
            HStack(spacing: 8) {
                if day == today {
                    Circle().fill(Color.plum).frame(width: 6, height: 6)
                }
                MonoLabel(text: label(items: items))
                Spacer(minLength: 8)
                StatusGlyph(status: status)
            }
            if plan.isMetric {
                Text(plan.value(on: day).map { "\(plan.format($0)) \(plan.unit)" } ?? "Not logged")
                    .font(.cadenceBody)
                    .foregroundStyle(Color.ink)
            } else {
                Text(text(items: items).isEmpty ? "Nothing planned" : text(items: items))
                    .font(.cadenceBody)
                    .tracking(-0.2)
                    .foregroundStyle(Color.ink)
                    .lineLimit(6)
            }
        }
        .padding(.horizontal, Metrics.cardPadding)
        .padding(.vertical, Metrics.rowVertical)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func label(items: [String]) -> String {
        var parts = [day == today ? "TODAY" : DayText.weekdays[day.weekdayIndex]]
        if let column, plan.columns.indices.contains(column), !plan.columns[column].isEmpty {
            parts.append(plan.columns[column].uppercased())
        }
        return parts.joined(separator: " · ")
    }

    private func text(items: [String]) -> String {
        if let column { return items.indices.contains(column) ? items[column] : "" }
        return items.filter { !$0.isEmpty }.joined(separator: "\n")
    }
}

// MARK: - The options pill

/// A Liquid Glass pill: the most likely action named in full, the rest as icons, delete
/// behind a confirmation popover and anything else under ⋯.
private struct FocusPill: View {
    let item: FocusItem
    let actions: FocusActions
    var onDone: () -> Void

    @Environment(Store.self) private var store
    @State private var confirmingDelete = false

    var body: some View {
        if let plan = store.plan(item.planID) {
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

        deleteButton(plan)

        Menu {
            if plan.isMetric || plan.isPlanned(today) {
                Button(status == .skipped ? "Undo not today" : "Not today", systemImage: status == .skipped ? "arrow.uturn.backward" : "xmark") {
                    let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: today) }
                    Feedback.play(for: change)
                    onDone()
                }
            }
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
                Text("Delete")
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
