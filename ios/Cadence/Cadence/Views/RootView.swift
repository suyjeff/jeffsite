import Combine
import SwiftUI

struct RootView: View {
    @Environment(Store.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @AppStorage("viewMode") private var mode: ViewMode = .today
    @AppStorage("frontPlan") private var storedFrontID = ""
    @State private var frontID: UUID?
    @State private var weekStart: Day = .today.weekStart
    @State private var month: Day = .today.monthStart
    @State private var selectedDay: Day = .today

    @State private var plansRoute: PlansRoute?
    @State private var creating = false
    /// Set when a new plan is created, so its editor opens once the template sheet is gone.
    @State private var createdPlan: UUID?
    @State private var focus: FocusItem?
    /// Closing has begun: a card lifted in place starts settling home right away.
    @State private var focusReleased = false
    /// Where the views sit below the header, in window coordinates (for the focus cut).
    @State private var contentArea: CGRect = .infinite
    @Namespace private var createTransition
    @State private var dayEdit: DayTarget?
    @State private var valueEdit: DayTarget?
    @State private var celebrating = false
    /// +1 when moving down the view menu (Today → Week → Month → Scrolling), −1 when moving up.
    @State private var modeDirection = 1

    // The body is assembled in stages. As one long modifier chain it outgrew what the Swift
    // type checker will solve ("failed to produce diagnostic"); each stage checks on its own.
    var body: some View {
        withLifecycle(withSheets(withOverlays(screen)))
    }

    /// Header, the current view, and the bottom bar.
    private var screen: some View {
        VStack(spacing: 0) {
            HeaderBar(
                mode: mode,
                onSelectMode: selectMode,
                plans: store.plans,
                frontID: frontID,
                onSelectPlan: selectPlan,
                onOpenPlans: { plansRoute = $0 },
                onJumpToToday: jumpToTodayAction
            )

            ZStack {
                if store.plans.isEmpty {
                    EmptyDeck { creating = true }
                        .matchedTransitionSource(id: "create", in: createTransition)
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.vertical, 14)
                        .transition(modeTransition)
                } else {
                    content
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { frame in
                contentArea = frame
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .environment(\.focusedKey, liftedKey)
        .environment(\.requestFocus, FocusRequest { item in
            focusReleased = false
            focus = item
        })
    }

    /// The key views see as lifted. A card lifted in place lets go as soon as closing starts,
    /// so it settles while the blur clears; a row's copy hides the original until it's gone.
    private var liftedKey: String? {
        guard let focus else { return nil }
        if focus.liftsInPlace && focusReleased { return nil }
        return focus.key
    }

    /// Create floats bottom right, over the page.
    private var createButton: some View {
        CreateButton { creating = true }
            .matchedTransitionSource(id: "create", in: createTransition)
            .padding(.trailing, Metrics.gutter - 4)
            .padding(.bottom, 6)
    }

    /// "Jump to today" only where it changes something: Week and Month.
    private var jumpToTodayAction: (() -> Void)? {
        guard mode == .week || mode == .month else { return nil }
        return { jumpToToday() }
    }

    private var toastTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.9, anchor: .top))
    }

    /// The focus layer (held items and their options) and the "All done" toast.
    private func withOverlays(_ base: some View) -> some View {
        base
            .overlay(alignment: .bottomTrailing) {
                if !store.plans.isEmpty {
                    createButton
                }
            }
            .overlay {
                if let focus {
                    FocusLayer(
                        item: focus,
                        contentArea: contentArea,
                        actions: FocusActions(
                            editPlan: { plansRoute = .edit($0) },
                            editDay: editDay,
                            editValue: editValue
                        ),
                        onRelease: { focusReleased = true },
                        onDismiss: {
                            self.focus = nil
                            focusReleased = false
                        }
                    )
                    .id(focus.key)
                }
            }
            .overlay(alignment: .top) {
                if celebrating {
                    AllDoneToast()
                        .padding(.top, 4)
                        .transition(toastTransition)
                }
            }
    }

    private func withSheets(_ base: some View) -> some View {
        base
            .sheet(item: $plansRoute) { route in
                PlansSheet(route: route)
            }
            .sheet(isPresented: $creating, onDismiss: openCreatedPlan) {
                TemplatePicker(onPick: createPlan)
                    .presentationDetents([.medium, .large])
                    .navigationTransition(.zoom(sourceID: "create", in: createTransition))
            }
            .sheet(item: $dayEdit) { target in
                DayEditSheet(planID: target.planID, day: target.day)
                    .presentationDetents([.medium, .large])
            }
            .sheet(item: $valueEdit) { target in
                MetricEntrySheet(planID: target.planID, day: target.day)
                    .presentationDetents([.height(340)])
            }
    }

    private func withLifecycle(_ base: some View) -> some View {
        base
            .onAppear {
                Feedback.warmUp()
                if frontID == nil { frontID = UUID(uuidString: storedFrontID) }
                repairFront()
            }
            .onChange(of: store.plans.map(\.id)) { _, _ in repairFront() }
            .onChange(of: frontID) { _, newValue in storedFrontID = newValue?.uuidString ?? "" }
            .onChange(of: scenePhase) { _, phase in handle(phase) }
            .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged).receive(on: RunLoop.main)) { _ in
                rollOverIfNeeded()
            }
            .onChange(of: store.allDoneToday) { wasDone, isDone in
                if isDone && !wasDone { celebrate() }
            }
            .tint(Color.plum)
    }

    private func handle(_ phase: ScenePhase) {
        switch phase {
        case .active:
            rollOverIfNeeded()
            Haptics.shared.prepare()
        case .background:
            store.saveNow()
        default:
            break
        }
    }

    private func createPlan(_ template: PlanTemplate) {
        let plan = SeedData.template(template, today: store.today)
        store.add(plan)
        Feedback.play(.check(step: 0))
        createdPlan = plan.id
        creating = false
    }

    @ViewBuilder
    private var content: some View {
        switch mode {
        case .today:
            TodayDeck(
                frontID: $frontID,
                onCreatePlan: { creating = true }
            )
            .transition(modeTransition)
        case .week:
            PageDeck(frontID: $frontID) { plan in
                WeekCard(plan: plan, weekStart: $weekStart, onEditValue: editValue)
            }
            .transition(modeTransition)
        case .month:
            PageDeck(frontID: $frontID) { plan in
                MonthCard(plan: plan, month: $month, selected: $selectedDay, onEditValue: editValue)
            }
            .transition(modeTransition)
        case .scrolling:
            scrollingDeck
                .transition(modeTransition)
        }
    }

    private var modeTransition: AnyTransition {
        Motion.slide(modeDirection, reduceMotion: reduceMotion)
    }

    private func selectMode(_ newMode: ViewMode) {
        guard newMode != mode else { return }
        modeDirection = newMode.order > mode.order ? 1 : -1
        Haptics.shared.tick()
        withAnimation(Motion.page) { mode = newMode }
    }

    private func selectPlan(_ id: UUID) {
        guard id != frontID else { return }
        Feedback.play(.cycle)
        withAnimation(Motion.deck) { frontID = id }
    }

    /// Scrolling mode: one tall card with the next one peeking above, like the deck.
    private var scrollingDeck: some View {
        ZStack(alignment: .top) {
            if store.plans.count > 1 {
                DeckPeek {
                    let next = store.plans[((store.index(of: frontID) ?? 0) + 1) % store.plans.count]
                    selectPlan(next.id)
                }
            }
            if let plan = store.plan(frontID) ?? store.plans.first {
                ScrollingCard(plan: plan, onEditValue: editValue)
                    .id(plan.id)
                    .transition(Motion.deckForward(reduceMotion: reduceMotion))
            } else {
                EmptyDeck { creating = true }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 14 + Metrics.deckPeek)
        .padding(.bottom, Metrics.createClearance)
    }

    /// After creating, bring the new plan to the front and open its sheet to write it.
    private func openCreatedPlan() {
        guard let id = createdPlan else { return }
        createdPlan = nil
        withAnimation(Motion.deck) { frontID = id }
        plansRoute = .edit(id)
    }

    private func jumpToToday() {
        let today = store.today
        withAnimation(Motion.page) {
            weekStart = today.weekStart
            month = today.monthStart
            selectedDay = today
        }
        Feedback.play(.cycle)
    }

    private func editDay(_ planID: UUID, _ day: Day) {
        dayEdit = DayTarget(planID: planID, day: day)
    }

    private func editValue(_ planID: UUID, _ day: Day) {
        valueEdit = DayTarget(planID: planID, day: day)
    }

    private func repairFront() {
        if store.plan(frontID) == nil {
            frontID = store.plans.first?.id
        }
    }

    /// Past midnight: move "today" and pull the week/month views along if they were on the current period.
    private func rollOverIfNeeded() {
        let previous = store.today
        store.refreshToday()
        let now = store.today
        guard now != previous else { return }
        if weekStart == previous.weekStart { weekStart = now.weekStart }
        if month == previous.monthStart { month = now.monthStart }
        if selectedDay == previous { selectedDay = now }
    }

    private func celebrate() {
        // Let the check's own sound land first, then the chord.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            Feedback.play(.allDone)
            withAnimation(reduceMotion ? Motion.standard : .spring(response: 0.45, dampingFraction: 0.78)) {
                celebrating = true
            }
            try? await Task.sleep(for: .seconds(2.4))
            withAnimation(.easeOut(duration: 0.22)) {
                celebrating = false
            }
        }
    }
}

struct DayTarget: Identifiable {
    let planID: UUID
    let day: Day
    var id: String { planID.uuidString + day.key }
}

/// A Liquid Glass capsule that drops in when everything planned today is done.
private struct AllDoneToast: View {
    @State private var drawn = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Color.plum)
                CheckmarkShape()
                    .trim(from: 0, to: drawn ? 1 : 0)
                    .stroke(Color.onPlum, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                    .frame(width: 12, height: 12)
            }
            .frame(width: 24, height: 24)
            Text("All done for today")
                .font(.cadenceCallout)
                .foregroundStyle(Color.ink)
        }
        .padding(.leading, 8)
        .padding(.trailing, 16)
        .frame(height: 44)
        .glassEffect(.regular, in: .capsule)
        .onAppear {
            withAnimation(.easeOut(duration: 0.3).delay(0.12)) { drawn = true }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}
