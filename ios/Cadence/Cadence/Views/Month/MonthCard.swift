import SwiftUI

/// The Month card: progress strip, month navigator and weekday names (pinned while the page
/// scrolls), a calendar where every day shows its state, then the rest of the selected day's
/// week as swipeable rows.
struct MonthCard: View {
    let plan: Plan
    @Binding var month: Day
    @Binding var selected: Day
    var onEditValue: (UUID, Day) -> Void

    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @State private var direction = 1

    var body: some View {
        let days = month.monthDays
        let progress = plan.progress(in: days.filter { $0 <= store.today })
        let isCurrent = month == store.today.monthStart
        let restOfWeek = (selected.weekdayIndex...6).map { selected.weekStart.adding($0) }

        StickyCard {
            CardHeaderStrip(title: plan.name) {
                CountPill(done: progress.done, total: progress.planned)
                    .animation(Motion.snappy, value: progress.done)
            }
            // Hold the top of the card to lift the whole card.
            .liftsCardOnHold()

            PeriodBar(
                title: DayText.monthTitle(month),
                unit: "month",
                isCurrent: isCurrent,
                onStep: { step(by: $0) },
                onReset: { jumpToToday() }
            )

            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { index in
                    Text(DayText.shortWeekdays[index])
                        .font(.cadenceLabel)
                        .foregroundStyle(Color.inkSecondary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 16)
            .padding(.bottom, 8)
            .accessibilityHidden(true)
        } content: {
            // Overlap the outgoing and incoming months instead of stacking them.
            ZStack(alignment: .top) {
                CalendarGrid(plan: plan, month: month, selected: $selected, today: store.today)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 16)
                    .background(Color.surface)
                    .id(month)
                    .transition(Motion.slide(direction, reduceMotion: reduceMotion))
            }
            .gesture(HorizontalPan { phase in
                if case .ended(let translation, let velocity) = phase,
                   abs(translation) > 60 || abs(velocity) > 600 {
                    // Swiping toward the leading edge goes forward in time (mirrors in RTL).
                    let forward = (translation < 0) == (layoutDirection == .leftToRight)
                    step(by: forward ? 1 : -1)
                }
            })

            if plan.isMetric {
                let points = plan.points(in: days)
                if points.count >= 2 {
                    Hairline()
                    MetricChart(
                        points: points,
                        domain: MetricChart.domain(from: days[0], to: days[days.count - 1]),
                        highlight: selected
                    )
                    .frame(height: 96)
                    .padding(.horizontal, Metrics.cardPadding)
                    .padding(.vertical, 16)
                }
            }

            Hairline()

            VStack(spacing: 0) {
                ForEach(Array(restOfWeek.enumerated()), id: \.element) { index, day in
                    Group {
                        if plan.isMetric {
                            MetricRow(plan: plan, day: day, isToday: day == store.today, onEdit: onEditValue)
                        } else {
                            DayRow(plan: plan, day: day, isToday: day == store.today)
                        }
                    }
                    if index < restOfWeek.count - 1 {
                        Hairline()
                    }
                }
            }
            .animation(Motion.page, value: selected)
        }
        .focusableCard(plan.id)
    }

    private func step(by delta: Int) {
        direction = delta
        withAnimation(Motion.page) {
            month = month.addingMonths(delta)
            selected = month == store.today.monthStart ? store.today : month
        }
    }

    private func jumpToToday() {
        direction = store.today.monthStart > month ? 1 : -1
        Feedback.play(.cycle)
        withAnimation(Motion.page) {
            month = store.today.monthStart
            selected = store.today
        }
    }
}

private struct CalendarGrid: View {
    let plan: Plan
    let month: Day
    @Binding var selected: Day
    let today: Day

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var body: some View {
        let lead = month.monthStart.weekdayIndex
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(0..<lead, id: \.self) { _ in
                Color.clear.frame(height: 44)
            }
            ForEach(month.monthDays) { day in
                DayCell(
                    plan: plan,
                    day: day,
                    isToday: day == today,
                    isSelected: day == selected,
                    isFuture: day > today
                )
                .onTapGesture {
                    guard day != selected else { return }
                    Haptics.shared.tick()
                    withAnimation(Motion.snappy) { selected = day }
                }
            }
        }
    }
}

/// One calendar day: plum disc when done, a ring arc when partly done, a slash when skipped,
/// a hairline ring when something is planned, plain faint number when nothing is.
private struct DayCell: View {
    let plan: Plan
    let day: Day
    let isToday: Bool
    let isSelected: Bool
    let isFuture: Bool

    var body: some View {
        let status = plan.status(on: day)
        let done = status == .done
        let fraction: CGFloat = {
            if case .partial(let d, let t) = status, t > 0 { return CGFloat(d) / CGFloat(t) }
            return 0
        }()

        ZStack {
            Circle()
                .fill(isSelected && !done ? Color.canvas : Color.clear)
            Circle()
                .fill(Color.plum)
                .scaleEffect(done ? 1 : 0.5)
                .opacity(done ? 1 : 0)
            Circle()
                .strokeBorder(ringColor(status), lineWidth: isToday ? 1.5 : 1)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(Color.plum, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(1)
            Text("\(day.day)")
                .font(.cadenceCallout)
                .monospacedDigit()
                .foregroundStyle(numberColor(status))
            if status == .skipped {
                Capsule()
                    .fill(Color.inkMuted)
                    .frame(width: 18, height: 1.5)
                    .rotationEffect(.degrees(-45))
            }
            // Today is marked by shape, not only by the ring's color.
            if isToday {
                Circle()
                    .fill(done ? Color.onPlum : Color.plum)
                    .frame(width: 4, height: 4)
                    .offset(y: 12)
            }
        }
        .frame(width: 38, height: 38)
        .frame(maxWidth: .infinity)
        .frame(height: 44)
        .contentShape(.rect)
        .animation(Motion.snappy, value: status)
        .animation(Motion.snappy, value: isSelected)
        .accessibilityElement()
        .accessibilityLabel(isToday ? "Today, \(DayText.long(day))" : DayText.long(day))
        .accessibilityValue(statusText(status))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func ringColor(_ status: DayStatus) -> Color {
        if isToday { return .plum }
        switch status {
        case .pending, .partial: return isFuture ? .clear : .hairline
        default: return .clear
        }
    }

    private func numberColor(_ status: DayStatus) -> Color {
        switch status {
        case .done: return .onPlumText
        case .empty, .skipped: return .inkSecondary
        default: return isFuture ? .inkSecondary : .ink
        }
    }

    private func statusText(_ status: DayStatus) -> String {
        switch status {
        case .done: "Done"
        case .skipped: "Skipped"
        case .partial(let done, let total): "\(done) of \(total) done"
        case .pending: isFuture ? "Planned" : "Not done"
        case .empty: "Nothing planned"
        }
    }
}
