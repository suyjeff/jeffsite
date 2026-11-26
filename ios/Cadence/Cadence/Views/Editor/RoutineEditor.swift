import SwiftUI

struct PlanEditor: View {
    let planID: UUID
    var onDelete: () -> Void

    @Environment(Store.self) private var store

    var body: some View {
        if let plan = store.plan(planID) {
            switch plan.kind {
            case .routine: RoutineEditor(plan: plan, onDelete: onDelete)
            case .metric: MetricEditor(plan: plan, onDelete: onDelete)
            }
        } else {
            ContentUnavailableView("Plan deleted", systemImage: "trash")
        }
    }
}

/// The week, written like a sheet: a row per day, a column per routine slot (AM / PM),
/// every cell editable in place. Arrows in the keyboard bar walk between cells.
///
/// A week you edit gets its own copy and carries forward until a later week changes it,
/// so writing next week's block never rewrites last week's history.
struct RoutineEditor: View {
    let plan: Plan
    var onDelete: () -> Void

    @Environment(Store.self) private var store
    @State private var weekStart: Day = .today.weekStart
    @State private var direction = 1
    @State private var confirmingDelete = false
    @FocusState private var focus: Cell?

    struct Cell: Hashable {
        var weekday: Int
        var column: Int
    }

    var body: some View {
        let resolved = plan.resolvedWeek(weekStart)
        let isOwn = plan.hasOwnWeek(weekStart)

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                TextField("Plan name", text: nameBinding)
                    .font(.cadenceNumber(28))
                    .tracking(-0.6)
                    .foregroundStyle(Color.ink)
                    .submitLabel(.done)
                    .padding(.horizontal, 4)

                VStack(spacing: 0) {
                    PeriodBar(
                        title: weekStart == store.today.weekStart ? "THIS WEEK · \(DayText.weekRange(weekStart))" : DayText.weekRange(weekStart),
                        isCurrent: weekStart == store.today.weekStart,
                        onStep: { step($0) },
                        onReset: { jump(to: store.today.weekStart) }
                    )
                    .background(Color.canvas)

                    ZStack(alignment: .top) {
                        grid(resolved.plan)
                            .background(Color.surface)
                            .id(weekStart)
                            .transition(Motion.slide(direction))
                    }
                }
                .cardSurface()

                sourceNote(isOwn: isOwn, source: resolved.source)

                actions(isOwn: isOwn, hasEarlier: resolved.source != nil || weekHasEarlier)

                columnsEditor

                Button(role: .destructive) {
                    confirmingDelete = true
                } label: {
                    Label("Delete plan", systemImage: "trash")
                        .font(.cadenceCallout)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                }
                .buttonStyle(.glass)
                .tint(.red)
                .padding(.top, 8)
                .confirmationDialog("Delete \(plan.name)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                    Button("Delete plan and its history", role: .destructive) {
                        store.delete(plan.id)
                        onDelete()
                    }
                } message: {
                    Text("Every week and every check mark in this plan will be removed.")
                }
            }
            .padding(.horizontal, Metrics.gutter - 4)
            .padding(.vertical, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.canvas)
        // The editable name above is the page's title; a second one in the bar would repeat it.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Button { move(-1) } label: { Image(systemName: "chevron.up") }
                    .accessibilityLabel("Previous cell")
                Button { move(1) } label: { Image(systemName: "chevron.down") }
                    .accessibilityLabel("Next cell")
                Spacer()
                if let focus, plan.columnCount >= 1 {
                    Button("Same every day") {
                        let text = plan.resolvedWeek(weekStart).plan.text(weekday: focus.weekday, column: focus.column)
                        store.fillWeek(plan.id, week: weekStart, column: focus.column, text: text)
                        Feedback.play(.check(step: 0))
                    }
                    .font(.cadenceCallout)
                }
                Button("Done") { focus = nil }
                    .font(.cadenceCallout)
            }
        }
    }

    // MARK: Grid

    private func grid(_ week: WeekPlan) -> some View {
        VStack(spacing: 0) {
            if plan.columnCount > 1 {
                HStack(spacing: 0) {
                    Color.clear.frame(width: 64)
                    ForEach(0..<plan.columnCount, id: \.self) { column in
                        Hairline(axis: .vertical)
                        Text(plan.columns[column].isEmpty ? "COLUMN \(column + 1)" : plan.columns[column].uppercased())
                            .font(.cadenceCaption)
                            .foregroundStyle(Color.inkSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .background(Color.canvas)
                Hairline()
            }

            ForEach(0..<7, id: \.self) { weekday in
                let day = weekStart.adding(weekday)
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(DayText.shortWeekdays[weekday])
                            .font(.cadenceCaption)
                            .foregroundStyle(day == store.today ? Color.ink : Color.inkSecondary)
                        Text("\(day.day)")
                            .font(.cadenceMicro)
                            .foregroundStyle(Color.inkMuted)
                    }
                    .frame(width: 64, alignment: .leading)
                    .padding(.leading, 16)
                    .frame(width: 64, alignment: .leading)

                    ForEach(0..<plan.columnCount, id: \.self) { column in
                        Hairline(axis: .vertical)
                        cellField(weekday: weekday, column: column, text: week.text(weekday: weekday, column: column))
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                if weekday < 6 { Hairline() }
            }
        }
    }

    private func cellField(weekday: Int, column: Int, text: String) -> some View {
        let cell = Cell(weekday: weekday, column: column)
        let isFocused = focus == cell
        return TextField(
            "",
            text: Binding(
                get: { text },
                set: { store.setCell(plan.id, week: weekStart, weekday: weekday, column: column, text: $0) }
            ),
            prompt: Text("—").foregroundStyle(Color.inkFaint),
            axis: .vertical
        )
        .font(.cadenceCallout)
        .foregroundStyle(Color.ink)
        .lineLimit(1...6)
        .focused($focus, equals: cell)
        .padding(.horizontal, 12)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .topLeading)
        .background(isFocused ? Color.plum.opacity(0.05) : Color.clear)
        .overlay {
            // Spreadsheet selection ring.
            Rectangle()
                .strokeBorder(Color.plum, lineWidth: 1.5)
                .opacity(isFocused ? 1 : 0)
        }
        .contentShape(.rect)
        .onTapGesture { focus = cell }
        .animation(Motion.snappy, value: isFocused)
    }

    // MARK: Pieces

    private var weekHasEarlier: Bool {
        plan.weeks.keys.contains { $0 < weekStart.key }
    }

    @ViewBuilder
    private func sourceNote(isOwn: Bool, source: Day?) -> some View {
        let text: String = {
            if isOwn { return "Written for this week. It repeats each week after until you change one." }
            if let source { return "Repeating the week of \(source.date.formatted(.dateTime.month(.abbreviated).day())). Type anywhere to give this week its own plan." }
            return "Nothing written yet. Type in any cell to start."
        }()
        Text(text)
            .font(.cadenceSubhead)
            .foregroundStyle(Color.inkSecondary)
            .padding(.horizontal, 4)
            .contentTransition(.opacity)
            .animation(Motion.settle, value: text)
    }

    private func actions(isOwn: Bool, hasEarlier: Bool) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ActionChip(title: "Copy last week", symbol: "doc.on.doc") {
                    store.copyPreviousWeek(plan.id, into: weekStart)
                    Feedback.play(.check(step: 0))
                }
                if isOwn && hasEarlier {
                    ActionChip(title: "Repeat previous", symbol: "arrow.uturn.backward") {
                        store.revertWeek(plan.id, week: weekStart)
                        Feedback.play(.uncheck)
                    }
                }
                ActionChip(title: "Clear week", symbol: "eraser") {
                    store.clearWeek(plan.id, week: weekStart)
                    Feedback.play(.skip)
                }
            }
            .padding(.horizontal, 4)
        }
        .scrollIndicators(.hidden)
    }

    private var columnsEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            SheetSectionHeader(text: "Columns")
                .padding(.horizontal, 4)
            VStack(spacing: 0) {
                ForEach(0..<plan.columnCount, id: \.self) { index in
                    HStack {
                        TextField(
                            "Column \(index + 1)",
                            text: Binding(
                                get: { plan.columns.indices.contains(index) ? plan.columns[index] : "" },
                                set: { newValue in
                                    var columns = plan.columns
                                    guard columns.indices.contains(index) else { return }
                                    columns[index] = newValue
                                    store.setColumns(plan.id, columns)
                                }
                            ),
                            prompt: Text(plan.columnCount == 1 ? "Unnamed (one column)" : "Column \(index + 1)")
                        )
                        .font(.cadenceBodyMedium)
                        .foregroundStyle(Color.ink)
                        if plan.columnCount > 1 {
                            Button {
                                var columns = plan.columns
                                columns.remove(at: index)
                                withAnimation(Motion.standard) { store.setColumns(plan.id, columns) }
                                Feedback.play(.skip)
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .font(.system(size: 18))
                                    .foregroundStyle(Color.inkMuted)
                                    .frame(width: 44, height: 44)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(PressableStyle())
                            .accessibilityLabel("Remove column \(index + 1)")
                        }
                    }
                    .padding(.leading, 16)
                    .frame(minHeight: 48)
                    Hairline()
                }
                Button {
                    var columns = plan.columns
                    if columns.count == 1 && columns[0].isEmpty { columns = ["AM", "PM"] } else { columns.append("") }
                    withAnimation(Motion.standard) { store.setColumns(plan.id, columns) }
                    Feedback.play(.check(step: 1))
                } label: {
                    Label("Add column", systemImage: "plus")
                        .font(.cadenceCallout)
                        .foregroundStyle(Color.plum)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .frame(height: 48)
                        .contentShape(.rect)
                }
                .buttonStyle(RowPressStyle())
            }
            .cardSurface(radius: 16, elevated: false)
        }
    }

    private var nameBinding: Binding<String> {
        Binding(
            get: { plan.name },
            set: { newValue in store.update(plan.id) { $0.name = newValue } }
        )
    }

    // MARK: Navigation

    private func step(_ delta: Int) {
        focus = nil
        direction = delta
        withAnimation(Motion.page) { weekStart = weekStart.adding(7 * delta) }
    }

    private func jump(to target: Day) {
        focus = nil
        direction = target > weekStart ? 1 : -1
        withAnimation(Motion.page) { weekStart = target }
    }

    private func move(_ delta: Int) {
        let columns = plan.columnCount
        let current = focus ?? Cell(weekday: 0, column: 0)
        let linear = current.weekday * columns + current.column + delta
        let total = 7 * columns
        let wrapped = (linear % total + total) % total
        focus = Cell(weekday: wrapped / columns, column: wrapped % columns)
        Haptics.shared.tick()
    }
}

struct ActionChip: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.cadenceSubhead)
                .foregroundStyle(Color.ink)
                .padding(.horizontal, 14)
                .frame(height: 40)
                .glassEffect(.regular.interactive(), in: .capsule)
                .frame(height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(BareButtonStyle())
    }
}
