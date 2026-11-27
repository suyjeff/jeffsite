import SwiftUI

/// The Week card: header strip with progress and the week navigator, fixed at the top, then
/// one row per day, scrolling inside the card.
struct WeekCard: View {
    let plan: Plan
    @Binding var weekStart: Day
    var onEditValue: (UUID, Day) -> Void

    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.focusedKey) private var focusedKey
    @State private var direction = 1

    var body: some View {
        let days = weekStart.weekDays
        let progress = plan.progress(in: days)
        let isCurrent = weekStart == store.today.weekStart

        VStack(spacing: 0) {
            CardHeaderStrip(title: plan.name) {
                CountPill(done: progress.done, total: progress.planned)
                    .animation(Motion.snappy, value: progress.done)
            }
            // Hold the top of the card to lift the whole card.
            .liftsCardOnHold()

            PeriodBar(
                title: isCurrent ? "THIS WEEK" : DayText.weekRange(weekStart),
                onStep: { step(by: $0) }
            )

            // The header stays put; the days scroll inside the card. Pulling down at the top
            // (or up at the bottom) moves the whole deck instead.
            ScrollView {
                // A ZStack, not a stack: during the transition the outgoing and incoming
                // weeks overlap instead of stacking.
                ZStack(alignment: .top) {
                    weekBody(days)
                        .id(weekStart)
                        .transition(Motion.slide(direction, reduceMotion: reduceMotion))
                }
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .scrollDisabled(focusedKey != nil)
            // Room for "Back to this week" under the last day.
            .safeAreaPadding(.bottom, isCurrent ? 0 : 64)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.surface)
        .overlay(alignment: .bottom) {
            if !isCurrent {
                BackToToday(title: "Back to this week") { jump(to: store.today.weekStart) }
                    .padding(.bottom, 14)
                    .transition(BackToToday.transition(reduceMotion: reduceMotion))
            }
        }
        .animation(Motion.snappy, value: isCurrent)
    }

    private func weekBody(_ days: [Day]) -> some View {
        VStack(spacing: 0) {
            if plan.isMetric {
                let points = plan.points(in: days)
                if !points.isEmpty {
                    MetricChart(
                        points: points,
                        domain: MetricChart.domain(from: days[0], to: days[6]),
                        showsAxis: true,
                        highlight: store.today
                    )
                    .frame(height: 110)
                    .padding(.horizontal, Metrics.cardPadding)
                    .padding(.vertical, 16)
                    Hairline()
                }
            }
            ForEach(Array(days.enumerated()), id: \.element) { index, day in
                Group {
                    if plan.isMetric {
                        MetricRow(plan: plan, day: day, isToday: day == store.today, onEdit: onEditValue)
                    } else {
                        DayRow(plan: plan, day: day, isToday: day == store.today)
                    }
                }
                if index < days.count - 1 {
                    Hairline()
                }
            }
        }
        .background(Color.surface)
    }

    private func step(by delta: Int) {
        direction = delta
        withAnimation(Motion.page) {
            weekStart = weekStart.adding(7 * delta)
        }
    }

    private func jump(to target: Day) {
        direction = target > weekStart ? 1 : -1
        Feedback.play(.cycle)
        withAnimation(Motion.page) {
            weekStart = target
        }
    }
}

// MARK: - Routine row

/// One day of a schedule. Tap it to check it off (with AM / PM columns, tap each column);
/// hold it for the rest (skip, undo, edit this day). Sideways drags belong to the deck, which
/// moves between plans. A finished day settles a step darker, with its ✓ or ✕ by the weekday.
struct DayRow: View {
    let plan: Plan
    let day: Day
    var isToday: Bool
    var showsWeekday = true

    @Environment(Store.self) private var store
    @State private var flash = 0

    var body: some View {
        let items = plan.items(on: day)
        let status = plan.status(on: day)
        let doneCount = plan.plannedColumns(on: day).filter { plan.mark(on: day, column: $0) == .done }.count

        Group {
            if plan.columnCount <= 1 {
                MarkCell(mark: plan.mark(on: day, section: nil), isEnabled: !items[0].isEmpty, onTap: { toggle(column: nil) }) {
                    VStack(alignment: .leading, spacing: Metrics.labelGap) {
                        weekdayLabel(status: status)
                        // A streak has nothing written: the day and its mark say it all.
                        if !plan.isStreak {
                            itemText(items[0], finished: status == .done || status == .skipped)
                        }
                    }
                    .padding(.horizontal, Metrics.cardPadding)
                    .padding(.vertical, Metrics.rowVertical)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                // Each column is a whole section of its own: its header (the weekday on the
                // first, the column's name and its ✓ or ✕ on each), then what's planned, with
                // the same padding as a single row. A column settles on its own; an empty one
                // follows the day, so a finished day settles whole.
                let dayMark = plan.mark(on: day, section: nil)
                HStack(alignment: .top, spacing: 0) {
                    ForEach(0..<plan.columnCount, id: \.self) { column in
                        let text = items.indices.contains(column) ? items[column] : ""
                        let planned = !text.isEmpty
                        let mark = planned ? plan.mark(on: day, section: column) : dayMark
                        MarkCell(mark: mark, isEnabled: planned, onTap: { toggle(column: column) }) {
                            VStack(alignment: .leading, spacing: Metrics.labelGap) {
                                columnHeader(column, mark: planned ? mark : nil, status: status)
                                itemText(text, finished: mark != nil)
                            }
                            .padding(.leading, column == 0 ? Metrics.cardPadding : 16)
                            .padding(.trailing, column == plan.columnCount - 1 ? Metrics.cardPadding : 16)
                            .padding(.vertical, Metrics.rowVertical)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        }
                        .accessibilityLabel("\(DayText.long(day)), \(plan.columns[column].isEmpty ? "column \(column + 1)" : plan.columns[column]), \(planned ? text : "nothing planned")")
                        if column < plan.columnCount - 1 {
                            Hairline(axis: .vertical)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .animation(Motion.settle, value: status)
            }
        }
        .overlay {
            RowFlash(trigger: flash)
        }
        .onChange(of: doneCount) { old, new in
            if new > old { flash += 1 }
        }
        // Hold a row to lift it with its options (done, skip, edit this day).
        .liftsOnHold(.day(plan.id, day, column: nil), key: FocusItem.dayKey(plan.id, day, nil)) {
            [planID = plan.id, day, isToday, showsWeekday] in
            LivePlan(id: planID) { plan in
                DayRow(plan: plan, day: day, isToday: isToday, showsWeekday: showsWeekday)
            }
        }
        .accessibilityActions {
            if plan.isPlanned(day) {
                Button(status == .skipped ? "Unskip" : "Skip") { skip() }
            }
        }
        .id(day.key)
    }

    private func weekdayLabel(status: DayStatus) -> some View {
        let finished = status == .done || status == .skipped
        return HStack(spacing: 8) {
            if isToday {
                Circle()
                    .fill(Color.plum)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            if showsWeekday {
                MonoLabel(
                    text: DayText.weekdays[day.weekdayIndex],
                    color: isToday && !finished ? .ink : .inkSecondary
                )
            } else {
                MonoLabel(
                    text: "\(DayText.shortWeekdays[day.weekdayIndex]) \(day.day)",
                    color: isToday && !finished ? .ink : .inkSecondary
                )
            }
            Spacer(minLength: 8)
            StatusGlyph(status: status)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText(status: status))
    }

    /// A column's header: the weekday (with today's dot) on the first column, then the
    /// column's name and its mark on every column.
    private func columnHeader(_ column: Int, mark: Mark?, status: DayStatus) -> some View {
        let finished = status == .done || status == .skipped
        return HStack(spacing: 6) {
            if column == 0 {
                if isToday {
                    Circle()
                        .fill(Color.plum)
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                }
                MonoLabel(
                    text: showsWeekday ? DayText.weekdays[day.weekdayIndex] : "\(DayText.shortWeekdays[day.weekdayIndex]) \(day.day)",
                    color: isToday && !finished ? .ink : .inkSecondary
                )
            }
            Spacer(minLength: 4)
            if !plan.columns[column].isEmpty {
                MonoLabel(text: plan.columns[column].uppercased(), style: .cadenceCaption)
            }
            StatusBadge(mark: mark, size: 16)
        }
        .accessibilityHidden(true)
    }

    private func itemText(_ text: String, finished: Bool) -> some View {
        Text(text.isEmpty ? "—" : text)
            .font(.cadenceBody)
            .tracking(-0.2)
            .foregroundStyle(finished || text.isEmpty ? Color.inkSecondary : Color.ink)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(Motion.settle, value: finished)
    }

    private func toggle(column: Int?) {
        let change = withAnimation(Motion.settle) {
            if let column { return store.toggleColumn(plan.id, on: day, column: column) }
            if plan.status(on: day) == .skipped { return store.toggleSkipped(plan.id, on: day) }
            return store.toggleDone(plan.id, on: day)
        }
        Feedback.play(for: change, step: column ?? 0)
    }

    private func skip() {
        let change = withAnimation(Motion.settle) { store.toggleSkipped(plan.id, on: day) }
        Feedback.play(for: change)
    }

    private func accessibilityText(status: DayStatus) -> String {
        let name = DayText.long(day)
        switch status {
        case .done: return "\(name), done"
        case .skipped: return "\(name), skipped"
        case .partial(let done, let total): return "\(name), \(done) of \(total) done"
        case .pending: return isToday ? "\(name), today" : name
        case .empty: return "\(name), nothing planned"
        }
    }
}

/// A day's mark beside its weekday: the green ✓ or red ✕ badge when finished, a half-filled
/// circle when partly done, nothing while open.
struct StatusGlyph: View {
    let status: DayStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            StatusBadge(mark: status == .done ? .done : status == .skipped ? .skipped : nil, size: 18)
            Image(systemName: "circle.lefthalf.filled")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.inkMuted)
                .opacity(isPartial ? 1 : 0)
                .scaleEffect(isPartial || reduceMotion ? 1 : 0.25)
                .blur(radius: isPartial || reduceMotion ? 0 : 4)
                .animation(Motion.icon, value: isPartial)
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }

    private var isPartial: Bool {
        if case .partial = status { return true }
        return false
    }
}

/// A tappable part of a row; it settles a step darker once marked. A tap gesture rather than a
/// Button: a Button keeps the touch while the finger moves, and SwiftUI makes the deck's
/// sideways drag wait for it, so a swipe that started on a row would never switch plans. A tap
/// lets go the moment the finger moves.
struct MarkCell<Content: View>: View {
    var mark: Mark?
    var isEnabled: Bool
    var onTap: () -> Void
    @ViewBuilder var content: Content

    @Environment(\.focusedKey) private var focusedKey

    var body: some View {
        content
            .background(mark != nil ? Color.settled : Color.surface)
            .animation(Motion.settle, value: mark)
            .contentShape(.rect)
            .onTapGesture {
                // The release that ends a hold isn't a tap.
                guard isEnabled, focusedKey == nil else { return }
                onTap()
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(isEnabled ? .isButton : [])
            .accessibilityValue(!isEnabled ? "Nothing planned" : mark == .done ? "Done" : mark == .skipped ? "Skipped" : "Not done")
            .accessibilityActions {
                if isEnabled {
                    Button("Check off") { onTap() }
                }
            }
    }
}

/// Renders `content` with the plan as it is in the store right now (nothing once deleted),
/// so a lifted copy of a row changes the moment it's acted on.
struct LivePlan<Content: View>: View {
    let id: UUID
    @ViewBuilder var content: (Plan) -> Content
    @Environment(Store.self) private var store

    var body: some View {
        if let plan = store.plan(id) {
            content(plan)
        }
    }
}

/// A soft green wash across a row the moment something in it is completed.
struct RowFlash: View {
    var trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Color.success
            .keyframeAnimator(initialValue: 0.0, trigger: trigger) { [reduceMotion] view, opacity in
                view.opacity(reduceMotion ? 0 : opacity)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(0.1, duration: 0.08)
                    CubicKeyframe(0, duration: 0.5)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

// MARK: - Metric row

struct MetricRow: View {
    let plan: Plan
    let day: Day
    var isToday: Bool
    var showsWeekday = true
    var onEdit: (UUID, Day) -> Void

    @Environment(Store.self) private var store
    @Environment(\.focusedKey) private var focusedKey

    var body: some View {
        let value = plan.value(on: day)
        let status = plan.status(on: day)
        let isFuture = day > store.today

        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    if isToday {
                        Circle().fill(Color.plum).frame(width: 6, height: 6)
                    }
                    MonoLabel(
                        text: showsWeekday ? DayText.weekdays[day.weekdayIndex] : "\(DayText.shortWeekdays[day.weekdayIndex]) \(day.day)",
                        color: isToday ? .ink : .inkSecondary
                    )
                }
                // That day's note, if it has one.
                if let note = plan.note(on: day) {
                    Text(note)
                        .font(.cadenceSubhead)
                        .foregroundStyle(Color.ink)
                        .lineLimit(2)
                }
            }
            Spacer()
            if let value {
                HStack(alignment: .center, spacing: 4) {
                    Text(plan.format(value))
                        .font(.cadenceBody)
                        .monospacedDigit()
                        .foregroundStyle(Color.ink)
                        .contentTransition(.numericText(value: value))
                    Text(plan.unit)
                        .font(.cadenceCaption)
                        .foregroundStyle(Color.inkSecondary)
                    StatusBadge(mark: .done, size: 18)
                        .padding(.leading, 6)
                }
            } else if status == .skipped {
                StatusBadge(mark: .skipped, size: 18)
            } else if !isFuture {
                Text("Log")
                    .font(.cadenceSubhead)
                    .foregroundStyle(Color.ink)
            }
        }
        .padding(.horizontal, Metrics.cardPadding)
        .padding(.vertical, Metrics.rowVertical)
        .background(value != nil || status == .skipped ? Color.settled : Color.surface)
        .contentShape(.rect)
        .onTapGesture {
            // The release that ends a hold isn't a tap.
            guard !isFuture, focusedKey == nil else { return }
            Haptics.shared.tick()
            onEdit(plan.id, day)
        }
        // Hold to lift it with its options (log, skip, clear).
        .liftsOnHold(.day(plan.id, day, column: nil), key: FocusItem.dayKey(plan.id, day, nil), isEnabled: !isFuture) {
            [planID = plan.id, day, isToday, showsWeekday] in
            LivePlan(id: planID) { plan in
                MetricRow(plan: plan, day: day, isToday: isToday, showsWeekday: showsWeekday, onEdit: { _, _ in })
            }
        }
        .accessibilityAddTraits(isFuture ? [] : .isButton)
        .id(day.key)
        .accessibilityLabel("\(DayText.long(day)), \(value.map { "\(plan.format($0)) \(plan.unit)" } ?? "not logged")\(plan.note(on: day).map { ", \($0)" } ?? "")")
    }
}

/// Rows highlight on touch-down (instantly), not on release.
struct RowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                Color.ink.opacity(configuration.isPressed ? 0.04 : 0)
                    .allowsHitTesting(false)
            }
            .animation(configuration.isPressed ? nil : .easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

// While the deck drags a card, its content doesn't change; comparing the inputs lets SwiftUI
// skip rebuilding every row on every frame. Store changes still arrive through observation.
extension WeekCard: Equatable {
    static func == (lhs: WeekCard, rhs: WeekCard) -> Bool {
        lhs.plan == rhs.plan && lhs.weekStart == rhs.weekStart
    }
}
