import SwiftUI

/// The Week card: header strip with progress, the week navigator, then one row per day.
struct WeekCard: View {
    let plan: Plan
    @Binding var weekStart: Day
    var onEditDay: (UUID, Day) -> Void
    var onEditValue: (UUID, Day) -> Void

    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var direction = 1

    var body: some View {
        let days = weekStart.weekDays
        let progress = plan.progress(in: days)
        let isCurrent = weekStart == store.today.weekStart

        VStack(spacing: 0) {
            CardHeaderStrip(title: plan.name, planID: plan.id) {
                CountPill(done: progress.done, total: progress.planned)
                    .animation(Motion.snappy, value: progress.done)
            }

            PeriodBar(
                title: isCurrent ? "THIS WEEK" : DayText.weekRange(weekStart),
                isCurrent: isCurrent,
                onStep: { step(by: $0) },
                onReset: { jump(to: store.today.weekStart) }
            )

            // A ZStack, not the card's VStack: during the transition the outgoing and
            // incoming weeks overlap instead of stacking (which doubled the card's height).
            ZStack(alignment: .top) {
                weekBody(days)
                    .id(weekStart)
                    .transition(Motion.slide(direction, reduceMotion: reduceMotion))
            }
        }
        .cardSurface()
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
                        DayRow(plan: plan, day: day, isToday: day == store.today, onEditDay: onEditDay)
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

/// One day of a routine. A single column swipes as a whole row; with AM / PM columns,
/// each column is its own swipe target, side by side with a hairline between them.
struct DayRow: View {
    let plan: Plan
    let day: Day
    var isToday: Bool
    var showsWeekday = true
    var onEditDay: (UUID, Day) -> Void

    @Environment(Store.self) private var store
    @State private var flash = 0

    var body: some View {
        let items = plan.items(on: day)
        let status = plan.status(on: day)
        let doneCount = plan.plannedColumns(on: day).filter { plan.mark(on: day, column: $0) == .done }.count

        Group {
            if plan.columnCount <= 1 {
                SwipeCell(
                    isDone: status == .done,
                    isSkipped: status == .skipped,
                    isEnabled: !items[0].isEmpty,
                    onCommit: { commit($0, column: nil) }
                ) {
                    VStack(alignment: .leading, spacing: Metrics.labelGap) {
                        weekdayLabel(status: status)
                        itemText(items[0], finished: status == .done || status == .skipped)
                    }
                    .padding(.horizontal, Metrics.cardPadding)
                    .padding(.vertical, Metrics.rowVertical)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.surface)
                }
            } else {
                VStack(alignment: .leading, spacing: Metrics.labelGap) {
                    weekdayLabel(status: status)
                        .padding(.horizontal, Metrics.cardPadding)
                        .padding(.top, Metrics.rowVertical)
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(0..<plan.columnCount, id: \.self) { column in
                            let mark = plan.mark(on: day, column: column)
                            let text = items.indices.contains(column) ? items[column] : ""
                            SwipeCell(
                                isDone: mark == .done,
                                isSkipped: mark == .skipped,
                                isEnabled: !text.isEmpty,
                                onCommit: { commit($0, column: column) }
                            ) {
                                itemText(text, finished: mark != nil || status == .skipped)
                                    .padding(.leading, column == 0 ? Metrics.cardPadding : 16)
                                    .padding(.trailing, column == plan.columnCount - 1 ? Metrics.cardPadding : 16)
                                    .padding(.bottom, Metrics.rowVertical)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                                    .background(Color.surface)
                            }
                            if column < plan.columnCount - 1 {
                                Hairline(axis: .vertical)
                                    .padding(.bottom, Metrics.rowVertical)
                            }
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .background(Color.surface)
            }
        }
        .overlay {
            RowFlash(trigger: flash)
        }
        .onChange(of: doneCount) { old, new in
            if new > old { flash += 1 }
        }
        // Hold a row to lift it with its options (done, not today, edit this day).
        .liftOnHold(.day(plan.id, day, column: nil), key: FocusItem.dayKey(plan.id, day, nil))
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
                    color: isToday && !finished ? .ink : finished ? .inkMuted : .inkSecondary
                )
            } else {
                MonoLabel(
                    text: "\(DayText.shortWeekdays[day.weekdayIndex]) \(day.day)",
                    color: isToday && !finished ? .ink : finished ? .inkMuted : .inkSecondary
                )
            }
            Spacer(minLength: 8)
            StatusGlyph(status: status)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText(status: status))
    }

    private func itemText(_ text: String, finished: Bool) -> some View {
        Text(text.isEmpty ? "—" : text)
            .font(.cadenceBody)
            .tracking(-0.2)
            .foregroundStyle(finished || text.isEmpty ? Color.inkFaint : Color.ink)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(Motion.settle, value: finished)
    }

    private func commit(_ direction: SwipeDirection, column: Int?) {
        let change = withAnimation(Motion.settle) {
            if let column {
                return store.toggleColumn(plan.id, on: day, column: column, mark: direction == .done ? .done : .skipped)
            }
            return direction == .done ? store.toggleDone(plan.id, on: day) : store.toggleSkipped(plan.id, on: day)
        }
        Feedback.play(for: change, step: column ?? 0)
    }

    private func accessibilityText(status: DayStatus) -> String {
        let name = DayText.long(day)
        switch status {
        case .done: return "\(name), done"
        case .skipped: return "\(name), not today"
        case .partial(let done, let total): return "\(name), \(done) of \(total) done"
        case .pending: return isToday ? "\(name), today" : name
        case .empty: return "\(name), nothing planned"
        }
    }
}

/// ✓ for done, ✕ for skipped, a half-filled circle for partly done. Contextual icon swap:
/// scale 0.25 → 1, opacity, 4px blur, spring 0.3s with no bounce.
struct StatusGlyph: View {
    let status: DayStatus

    var body: some View {
        ZStack {
            glyph("checkmark", visible: status == .done)
            glyph("xmark", visible: status == .skipped)
            glyph("circle.lefthalf.filled", visible: isPartial, size: 12)
        }
        .foregroundStyle(Color.inkMuted)
        .frame(width: 16, height: 16)
        // Completing pops the check in past full size; other changes cross-fade without bounce.
        .animation(status == .done ? .spring(duration: 0.4, bounce: 0.55) : Motion.icon, value: status)
        .accessibilityHidden(true)
    }

    private var isPartial: Bool {
        if case .partial = status { return true }
        return false
    }

    private func glyph(_ name: String, visible: Bool, size: CGFloat = 14) -> some View {
        Image(systemName: name)
            .font(.system(size: size, weight: .medium))
            .opacity(visible ? 1 : 0)
            .scaleEffect(visible ? 1 : 0.25)
            .blur(radius: visible ? 0 : 4)
    }
}

/// A soft plum wash across a row the moment something in it is completed.
struct RowFlash: View {
    var trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Color.plum
            .keyframeAnimator(initialValue: 0.0, trigger: trigger) { view, opacity in
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

    var body: some View {
        let value = plan.value(on: day)
        let status = plan.status(on: day)
        let isFuture = day > store.today

        HStack(alignment: .firstTextBaseline) {
            HStack(spacing: 8) {
                if isToday {
                    Circle().fill(Color.plum).frame(width: 6, height: 6)
                }
                MonoLabel(
                    text: showsWeekday ? DayText.weekdays[day.weekdayIndex] : "\(DayText.shortWeekdays[day.weekdayIndex]) \(day.day)",
                    color: isToday ? .ink : .inkSecondary
                )
            }
            Spacer()
            if let value {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(plan.format(value))
                        .font(.cadenceBody)
                        .monospacedDigit()
                        .foregroundStyle(Color.ink)
                        .contentTransition(.numericText(value: value))
                    Text(plan.unit)
                        .font(.cadenceCaption)
                        .foregroundStyle(Color.inkSecondary)
                }
            } else {
                Text(status == .skipped ? "Not today" : isFuture ? "" : "Log")
                    .font(.cadenceSubhead)
                    .foregroundStyle(status == .skipped ? Color.inkFaint : Color.plum)
            }
        }
        .padding(.horizontal, Metrics.cardPadding)
        .padding(.vertical, Metrics.rowVertical)
        .background(Color.surface)
        .contentShape(.rect)
        .onTapGesture {
            guard !isFuture else { return }
            Haptics.shared.tick()
            onEdit(plan.id, day)
        }
        // Hold to lift it with its options (log, not today, clear).
        .liftOnHold(.day(plan.id, day, column: nil), key: FocusItem.dayKey(plan.id, day, nil), isEnabled: !isFuture)
        .accessibilityAddTraits(isFuture ? [] : .isButton)
        .id(day.key)
        .accessibilityLabel("\(DayText.long(day)), \(value.map { "\(plan.format($0)) \(plan.unit)" } ?? "not logged")")
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
