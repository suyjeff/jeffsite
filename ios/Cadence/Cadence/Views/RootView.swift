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

    @State private var menu = MenuController()
    @State private var plansRoute: PlansRoute?
    @State private var path: [RootPage] = []
    @AppStorage(Palette.storageKey) private var palette: Palette = .mauve
    @State private var focus: FocusItem?
    /// Closing has begun: a card lifted in place starts settling home right away.
    @State private var focusReleased = false
    /// Where the header ends, in window coordinates. Below it is where cards scroll, and
    /// where a lifted card's cut in the focus backdrop may reach.
    @State private var headerBottom: CGFloat = 0
    @State private var dayEdit: DayTarget?
    @State private var valueEdit: DayTarget?
    @State private var celebrating = false
    /// +1 when moving down the view menu (Today → Week → Month), −1 when moving up.
    @State private var modeDirection = 1

    // The body is assembled in stages. As one long modifier chain it outgrew what the Swift
    // type checker will solve ("failed to produce diagnostic"); each stage checks on its own.
    var body: some View {
        withLifecycle(withSheets(navigation))
            .environment(\.menuController, menu)
    }

    /// The main screen, with Settings pushed over it as a full page.
    private var navigation: some View {
        NavigationStack(path: $path) {
            withOverlays(screen)
                // Colors resolve against the theme when drawn; a new theme redraws the page.
                .id(palette)
                .toolbarVisibility(.hidden, for: .navigationBar)
                .navigationDestination(for: RootPage.self) { page in
                    switch page {
                    case .settings: SettingsView()
                    }
                }
        }
    }

    /// The current view, with the header above it.
    private var screen: some View {
        ZStack {
            if store.plans.isEmpty {
                EmptyDeck(addMenu: addMenu)
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.top, 14)
                    .padding(.bottom, Metrics.deckBottom)
                    .transition(modeTransition)
            } else {
                content
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .top, spacing: 0) {
            HeaderBar(
                mode: mode,
                viewMenu: viewMenu,
                moreMenu: moreMenu,
                addMenu: addMenu
            )
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.frame(in: .global).maxY
            } action: { bottom in
                headerBottom = bottom
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

    private var contentArea: CGRect {
        CGRect(x: -10_000, y: headerBottom, width: 20_000, height: 20_000)
    }

    private var toastTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.9, anchor: .top))
    }

    /// The focus layer (held items and their options), the "All done" toast, and any open
    /// menu above all of them.
    private func withOverlays(_ base: some View) -> some View {
        base
            .overlay {
                if let focus {
                    FocusLayer(
                        item: focus,
                        contentArea: contentArea,
                        actions: FocusActions(
                            editPlan: { plansRoute = .plan($0) },
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
            .overlay {
                MenuLayer()
            }
    }

    private func withSheets(_ base: some View) -> some View {
        base
            .sheet(item: $plansRoute) { route in
                PlansSheet(route: route)
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
            .onChange(of: focus == nil) { _, isClosed in
                if isClosed { menu.close() }
            }
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
            menu.close()
            store.saveNow()
        default:
            break
        }
    }

    // MARK: Menus

    /// "Today ⌄": the three views.
    private func viewMenu(_ anchor: CGRect) -> MenuRequest {
        MenuRequest(
            anchor: anchor,
            placement: .belowLeading,
            sections: [ViewMode.allCases.map { option in
                MenuItem(id: option.rawValue, title: option.title, isChecked: option == mode) {
                    selectMode(option)
                }
            }]
        )
    }

    /// ⋯: the front plan, every plan (to switch to one directly), and settings.
    private func moreMenu(_ anchor: CGRect) -> MenuRequest {
        var sections: [[MenuItem]] = []
        var plans: [MenuItem] = []
        if let front = store.plan(frontID) ?? store.plans.first {
            plans.append(MenuItem(id: "edit", title: "Edit plan", systemImage: "square.and.pencil") {
                plansRoute = .plan(front.id)
            })
        }
        plans.append(MenuItem(id: "plans", title: "All plans", systemImage: "square.stack") {
            plansRoute = .list
        })
        sections.append(plans)

        if (2...6).contains(store.plans.count) {
            // A way straight to any plan, without the deck gestures (and for VoiceOver). Past a
            // handful the menu would outgrow the screen; All plans lists them instead.
            let front = (store.plan(frontID) ?? store.plans.first)?.id
            sections.append(store.plans.map { plan in
                MenuItem(id: "show-\(plan.id.uuidString)", title: plan.name.isEmpty ? "Untitled" : plan.name, systemImage: plan.symbol, isChecked: plan.id == front) {
                    selectPlan(plan.id)
                }
            })
        }

        if mode != .today && !isOnCurrentPeriod {
            sections.append([MenuItem(id: "jump", title: "Jump to today", systemImage: "calendar.badge.clock") {
                jumpToToday()
            }])
        }

        sections.append([MenuItem(id: "settings", title: "Settings", systemImage: "gearshape") {
            path.append(.settings)
        }])
        return MenuRequest(anchor: anchor, placement: .belowTrailing, sections: sections)
    }

    /// +: the three kinds of plan. Choosing one makes it, brings it to the front and opens
    /// it to name, pick an icon and write.
    private func addMenu(_ anchor: CGRect) -> MenuRequest {
        MenuRequest(
            anchor: anchor,
            // From the header it hangs below +; from the empty card's button it rises above.
            placement: store.plans.isEmpty && anchor.midY > headerBottom + 40 ? .aboveLeading : .belowTrailing,
            sections: [PlanTemplate.allCases.map(templateItem)]
        )
    }

    private func templateItem(_ template: PlanTemplate) -> MenuItem {
        MenuItem(id: template.rawValue, title: template.title, systemImage: template.symbol) {
            createPlan(template)
        }
    }

    private var isOnCurrentPeriod: Bool {
        switch mode {
        case .today: true
        case .week: weekStart == store.today.weekStart
        case .month: month == store.today.monthStart && selectedDay == store.today
        }
    }

    // MARK: Actions

    private func createPlan(_ template: PlanTemplate) {
        let plan = SeedData.template(template, today: store.today)
        withAnimation(Motion.deck) {
            store.add(plan)
            frontID = plan.id
        }
        Feedback.play(.check(step: 0))
        // Let the menu finish closing before the sheet rises.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(120))
            plansRoute = .plan(plan.id)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch mode {
        case .today:
            PlanDeck(frontID: $frontID, cardsScroll: false) { plan, slot in
                TodayCard(plan: plan, revision: store.revision, day: store.today, isFront: slot.isFront)
                    .equatable()
                    // Hold anywhere on the card to lift it into focus; a two-part card lifts
                    // the part you're holding instead.
                    .liftsCardOnHold(isEnabled: plan.kind != .routine || plan.columnCount <= 1)
            }
            .transition(modeTransition)
        case .week:
            PlanDeck(frontID: $frontID, cardsScroll: true) { plan, _ in
                WeekCard(plan: plan, weekStart: $weekStart, onEditValue: editValue)
                    .equatable()
            }
            .transition(modeTransition)
        case .month:
            PlanDeck(frontID: $frontID, cardsScroll: true) { plan, _ in
                MonthCard(plan: plan, month: $month, selected: $selectedDay, onEditValue: editValue)
                    .equatable()
            }
            .transition(modeTransition)
        }
    }

    private var modeTransition: AnyTransition {
        Motion.slide(modeDirection, reduceMotion: reduceMotion)
    }

    private func selectMode(_ newMode: ViewMode) {
        guard newMode != mode else { return }
        modeDirection = newMode.order > mode.order ? 1 : -1
        withAnimation(Motion.page) {
            mode = newMode
        }
    }

    private func selectPlan(_ id: UUID) {
        guard id != frontID else { return }
        Feedback.play(.cycle)
        withAnimation(Motion.deck) { frontID = id }
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

/// Pages pushed over the main screen.
enum RootPage: Hashable {
    case settings
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
                Circle().fill(Color.success)
                CheckmarkShape()
                    .trim(from: 0, to: drawn ? 1 : 0)
                    .stroke(Color.onSuccess, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
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
