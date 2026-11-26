import SwiftUI

/// "Scrolling": every day as one continuous sheet, the way the plan lives in a spreadsheet.
/// Week strips pin to the top while their days scroll beneath; opens on today.
struct ScrollingCard: View {
    let plan: Plan
    var onEditDay: (UUID, Day) -> Void
    var onEditValue: (UUID, Day) -> Void

    @Environment(Store.self) private var store

    private let weeksBack = 26
    private let weeksAhead = 12

    var body: some View {
        let today = store.today
        let weeks = (-weeksBack...weeksAhead).map { today.weekStart.adding($0 * 7) }

        VStack(spacing: 0) {
            CardHeaderStrip(title: plan.name, planID: plan.id) {
                let progress = plan.progress(in: today.weekDays)
                CountPill(done: progress.done, total: progress.planned)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ForEach(weeks, id: \.self) { weekStart in
                            Section {
                                ForEach(Array(weekStart.weekDays.enumerated()), id: \.element) { index, day in
                                    row(day)
                                    if index < 6 { Hairline() }
                                }
                            } header: {
                                WeekStrip(plan: plan, weekStart: weekStart, isCurrent: weekStart == today.weekStart)
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .task(id: plan.id) {
                    // Wait one turn so the lazy stack has laid out before jumping.
                    await Task.yield()
                    proxy.scrollTo(today.weekStart, anchor: .top)
                }
                .overlay(alignment: .bottomTrailing) {
                    Button {
                        Haptics.shared.tick()
                        withAnimation(Motion.standard) {
                            proxy.scrollTo(today.weekStart, anchor: .top)
                        }
                    } label: {
                        Text("TODAY")
                            .font(.cadenceCaption)
                            .foregroundStyle(Color.ink)
                            .padding(.horizontal, 14)
                            .frame(height: 36)
                            .glassEffect(.regular.interactive(), in: .capsule)
                            .frame(height: 44)
                            .padding(12)
                            .contentShape(.rect)
                    }
                    .buttonStyle(BareButtonStyle())
                    .accessibilityLabel("Scroll to today")
                }
            }
        }
        .cardSurface()
    }

    @ViewBuilder
    private func row(_ day: Day) -> some View {
        if plan.isMetric {
            MetricRow(plan: plan, day: day, isToday: day == store.today, showsWeekday: false, onEdit: onEditValue)
        } else {
            DayRow(plan: plan, day: day, isToday: day == store.today, showsWeekday: false, onEditDay: onEditDay)
        }
    }
}

private struct WeekStrip: View {
    let plan: Plan
    let weekStart: Day
    let isCurrent: Bool

    var body: some View {
        let progress = plan.progress(in: weekStart.weekDays)
        HStack {
            MonoLabel(text: isCurrent ? "THIS WEEK" : DayText.weekRange(weekStart), color: isCurrent ? .ink : .inkSecondary)
            Spacer()
            if progress.planned > 0 {
                CountPill(done: progress.done, total: progress.planned)
            }
        }
        .padding(.horizontal, Metrics.cardPadding)
        .padding(.vertical, 8)
        .frame(minHeight: 41)
        .background(Color.canvas)
        .overlay(alignment: .bottom) { Hairline() }
        .overlay(alignment: .top) { Hairline() }
    }
}
