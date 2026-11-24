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

    @State private var showingPlans = false
    @State private var dayEdit: DayTarget?
    @State private var valueEdit: DayTarget?
    @State private var celebrating = false

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(mode: $mode, plans: store.plans, frontID: $frontID) {
                showingPlans = true
            }

            ZStack {
                if store.plans.isEmpty {
                    EmptyDeck { showingPlans = true }
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.vertical, 14)
                        .transition(modeTransition)
                } else {
                    content
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.canvas.ignoresSafeArea())
        .overlay(alignment: .top) {
            if celebrating {
                AllDoneToast()
                    .padding(.top, 4)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.9, anchor: .top))
                    )
            }
        }
        .sheet(isPresented: $showingPlans) {
            PlansSheet(startingAt: store.plans.isEmpty ? nil : frontID)
        }
        .sheet(item: $dayEdit) { target in
            DayEditSheet(planID: target.planID, day: target.day)
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $valueEdit) { target in
            MetricEntrySheet(planID: target.planID, day: target.day)
                .presentationDetents([.height(340)])
        }
        .onAppear {
            Feedback.warmUp()
            if frontID == nil { frontID = UUID(uuidString: storedFrontID) }
            repairFront()
        }
        .onChange(of: store.plans.map(\.id)) { _, _ in repairFront() }
        .onChange(of: frontID) { _, newValue in storedFrontID = newValue?.uuidString ?? "" }
        .onChange(of: scenePhase) { _, phase in
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
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged).receive(on: RunLoop.main)) { _ in
            rollOverIfNeeded()
        }
        .onChange(of: store.allDoneToday) { wasDone, isDone in
            if isDone && !wasDone { celebrate() }
        }
        .tint(Color.plum)
    }

    @ViewBuilder
    private var content: some View {
        switch mode {
        case .today:
            TodayDeck(
                frontID: $frontID,
                onEditDay: editDay,
                onCreatePlan: { showingPlans = true }
            )
            .transition(modeTransition)
        case .week:
            PageDeck(frontID: $frontID) { plan in
                WeekCard(plan: plan, weekStart: $weekStart, onEditDay: editDay, onEditValue: editValue)
            }
            .transition(modeTransition)
        case .month:
            PageDeck(frontID: $frontID) { plan in
                MonthCard(plan: plan, month: $month, selected: $selectedDay, onEditDay: editDay, onEditValue: editValue)
            }
            .transition(modeTransition)
        case .scrolling:
            scrollingDeck
                .transition(modeTransition)
        }
    }

    private var modeTransition: AnyTransition {
        reduceMotion ? .opacity : AnyTransition(.blurReplace)
    }

    /// Scrolling mode: one tall card with the next one peeking above, like the deck.
    private var scrollingDeck: some View {
        ZStack(alignment: .top) {
            if store.plans.count > 1 {
                RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                    .fill(Color.surface)
                    .frame(height: 120)
                    .cardSurface()
                    .scaleEffect(1 - Metrics.deckScaleStep, anchor: .top)
                    .offset(y: -Metrics.deckPeek)
            }
            if let plan = store.plan(frontID) ?? store.plans.first {
                ScrollingCard(plan: plan, onEditDay: editDay, onEditValue: editValue)
                    .id(plan.id)
                    .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
            } else {
                EmptyDeck { showingPlans = true }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 14 + Metrics.deckPeek)
        .padding(.bottom, 14)
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
