import SwiftUI

/// Setup and history for a scale: what it measures (a unit from a list, the system way) and
/// how finely (a precision from a list), then everything logged.
struct MetricEditor: View {
    let plan: Plan
    var onDelete: () -> Void

    @Environment(Store.self) private var store

    var body: some View {
        let entries = plan.records
            .compactMap { key, record in record.value.flatMap { value in Day(key: key).map { MetricPoint(day: $0, value: value) } } }
            .sorted { $0.day > $1.day }

        List {
            Section {
                Picker("Unit", selection: binding(\.unit)) {
                    Text("None").tag("")
                    // A unit typed in an earlier version stays selectable.
                    if !plan.unit.isEmpty && !ScaleUnits.contains(plan.unit) {
                        Text(plan.unit).tag(plan.unit)
                    }
                    ForEach(ScaleUnits.groups, id: \.title) { group in
                        Section(group.title) {
                            ForEach(group.units, id: \.self) { unit in
                                Text(unit).tag(unit)
                            }
                        }
                    }
                }
                Picker("Precision", selection: binding(\.step)) {
                    ForEach(ScaleUnits.precisions, id: \.self) { step in
                        Text(ScaleUnits.precisionTitle(step)).tag(step)
                    }
                    if !ScaleUnits.precisions.contains(plan.step) {
                        Text(ScaleUnits.precisionTitle(plan.step)).tag(plan.step)
                    }
                }
            } header: {
                // The icon and name are the page's one title, editable in place.
                VStack(alignment: .leading, spacing: 24) {
                    PlanTitleField(plan: plan)
                    SheetSectionHeader(text: "Setup")
                }
                .textCase(nil)
            }
            .pickerStyle(.menu)
            .font(.cadenceBodyMedium)
            .foregroundStyle(Color.ink)
            .tint(Color.inkSecondary)
            .listRowBackground(Color.surface)

            if entries.count >= 2 {
                Section {
                    MetricChart(points: Array(entries.prefix(60).reversed()))
                        .frame(height: 140)
                        .padding(.vertical, 8)
                } header: {
                    SheetSectionHeader(text: "Trend")
                }
                .listRowBackground(Color.surface)
            }

            Section {
                if entries.isEmpty {
                    Text("Nothing logged yet.")
                        .font(.cadenceSubhead)
                        .foregroundStyle(Color.inkSecondary)
                }
                ForEach(entries) { entry in
                    LabeledContent {
                        Text("\(plan.format(entry.value)) \(plan.unit)")
                            .font(.cadenceBody)
                            .monospacedDigit()
                            .foregroundStyle(Color.ink)
                    } label: {
                        Text(DayText.long(entry.day))
                            .font(.cadenceSubhead)
                            .foregroundStyle(Color.inkSecondary)
                    }
                }
                .onDelete { offsets in
                    for index in offsets where entries.indices.contains(index) {
                        store.setValue(plan.id, on: entries[index].day, value: nil)
                    }
                }
            } header: {
                SheetSectionHeader(text: "History")
            }
            .listRowBackground(Color.surface)

            Section {
                DeletePlanButton(plan: plan, onDelete: onDelete)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .background(Color.canvas)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<Plan, Value>) -> Binding<Value> {
        Binding(
            get: { plan[keyPath: keyPath] },
            set: { newValue in store.update(plan.id) { $0[keyPath: keyPath] = newValue } }
        )
    }
}

/// The units a scale can measure in, grouped the way a system picker groups them, and the
/// precisions its ruler can step by.
enum ScaleUnits {
    struct Group {
        let title: String
        let units: [String]
    }

    static let groups = [
        Group(title: "Weight", units: ["lb", "kg", "st"]),
        Group(title: "Body", units: ["%", "bpm"]),
        Group(title: "Time", units: ["min", "hr"]),
        Group(title: "Distance", units: ["mi", "km"]),
        Group(title: "Volume", units: ["oz", "cups", "ml", "L"]),
        Group(title: "Count", units: ["steps", "reps", "pages", "kcal"]),
    ]

    static func contains(_ unit: String) -> Bool {
        groups.contains { $0.units.contains(unit) }
    }

    static let precisions: [Double] = [1, 0.5, 0.25, 0.1, 0.01]

    static func precisionTitle(_ step: Double) -> String {
        switch step {
        case 1: "Whole numbers (1)"
        case 0.5: "Halves (0.5)"
        case 0.25: "Quarters (0.25)"
        case 0.1: "Tenths (0.1)"
        case 0.01: "Hundredths (0.01)"
        default: step.formatted()
        }
    }
}

/// Setup for a streak: just its icon and name, how it's going, and delete.
struct StreakEditor: View {
    let plan: Plan
    var onDelete: () -> Void

    @Environment(Store.self) private var store

    var body: some View {
        let today = store.today
        let streak = plan.streak(asOf: today)
        let last30 = (0..<30).map { today.adding(-$0) }
        let done = last30.filter { plan.status(on: $0) == .done }.count

        List {
            Section {
                LabeledContent("Current streak", value: streak == 1 ? "1 day" : "\(streak) days")
                LabeledContent("Last 30 days", value: "\(done) done")
            } header: {
                VStack(alignment: .leading, spacing: 24) {
                    PlanTitleField(plan: plan)
                    SheetSectionHeader(text: "Progress")
                }
                .textCase(nil)
            }
            .font(.cadenceBodyMedium)
            .foregroundStyle(Color.ink)
            .listRowBackground(Color.surface)

            Section {
                DeletePlanButton(plan: plan, onDelete: onDelete)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .background(Color.canvas)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Edits the text of a single day without touching the rest of the week's plan
/// ("Strength - A" became "Swim" just this Tuesday).
struct DayEditSheet: View {
    let planID: UUID
    let day: Day

    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var items: [String] = []
    @State private var loaded = false
    @FocusState private var focused: Int?

    var body: some View {
        NavigationStack {
            if let plan = store.plan(planID) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(DayText.long(day))
                            .font(.cadenceTitle)
                            .foregroundStyle(Color.ink)

                        VStack(spacing: 0) {
                            ForEach(items.indices, id: \.self) { index in
                                VStack(alignment: .leading, spacing: 8) {
                                    MonoLabel(text: label(plan, index))
                                    TextField("Nothing planned", text: $items[index], axis: .vertical)
                                        .font(.cadenceBody)
                                        .foregroundStyle(Color.ink)
                                        .lineLimit(1...6)
                                        .focused($focused, equals: index)
                                }
                                .padding(Metrics.cardPadding)
                                if index < items.count - 1 { Hairline() }
                            }
                        }
                        .cardSurface()

                        if plan.overrides[day.key] != nil {
                            Button {
                                store.setOverride(planID, on: day, items: nil)
                                Feedback.play(.uncheck)
                                dismiss()
                            } label: {
                                Label("Use the week's plan again", systemImage: "arrow.uturn.backward")
                                    .font(.cadenceSubhead)
                                    .foregroundStyle(Color.plum)
                            }
                            .buttonStyle(PressableStyle())
                        } else {
                            Text("Only this day changes. To change every week, edit the plan.")
                                .font(.cadenceSubhead)
                                .foregroundStyle(Color.inkSecondary)
                        }
                    }
                    .padding(Metrics.gutter)
                }
                .background(Color.canvas)
                // The date above is the title; the bar only holds Cancel and Save.
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save", systemImage: "checkmark") {
                            store.setOverride(planID, on: day, items: items)
                            Feedback.play(.check(step: 0))
                            dismiss()
                        }
                        .tint(Color.plum)
                    }
                }
                .onAppear {
                    guard !loaded else { return }
                    loaded = true
                    items = plan.items(on: day)
                    focused = 0
                }
            }
        }
    }

    private func label(_ plan: Plan, _ index: Int) -> String {
        let column = plan.columns.indices.contains(index) ? plan.columns[index] : ""
        return column.isEmpty ? plan.name.uppercased() : "\(plan.name.uppercased()) · \(column.uppercased())"
    }
}

/// Sets a metric value for any past day, with the same ruler as the Today card.
struct MetricEntrySheet: View {
    let planID: UUID
    let day: Day

    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var value: Double = 0
    @State private var note = ""
    @State private var loaded = false
    /// Where the ruler started. Saving a day with no value logs one only if the ruler moved.
    @State private var startValue: Double?
    @FocusState private var noteFocused: Bool

    var body: some View {
        if let plan = store.plan(planID) {
            VStack(spacing: 18) {
                VStack(spacing: 6) {
                    MonoLabel(text: "\(plan.name.uppercased()) · \(DayText.long(day).uppercased())")
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(plan.format(value))
                            .font(.cadenceNumber(52))
                            .tracking(-1.5)
                            .monospacedDigit()
                            .foregroundStyle(Color.ink)
                            .contentTransition(.numericText(value: value))
                            .animation(Motion.snappy, value: value)
                        Text(plan.unit)
                            .font(.cadenceLabel)
                            .foregroundStyle(Color.inkSecondary)
                    }
                }
                .padding(.top, 28)

                if loaded {
                    RulerPicker(value: $value, step: plan.step, range: 0...max(1000, value * 3), label: plan.name)
                }

                // A note for this day only ("after a long run"); it never repeats to other days.
                TextField("Add a note", text: $note, axis: .vertical)
                    .font(.cadenceBodyMedium)
                    .foregroundStyle(Color.ink)
                    .lineLimit(1...3)
                    .focused($noteFocused)
                    .submitLabel(.done)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.hairline, lineWidth: 1)
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .accessibilityLabel("Note for \(DayText.long(day))")

                HStack(spacing: 12) {
                    if plan.value(on: day) != nil {
                        Button {
                            store.setValue(planID, on: day, value: nil)
                            store.setNote(planID, on: day, note: note)
                            Feedback.play(.uncheck)
                            dismiss()
                        } label: {
                            Text("Clear")
                                .font(.cadenceCallout)
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                        }
                        .buttonStyle(.glass)
                    }
                    Button {
                        // Opened just to write a note on an unlogged day: keep it a note.
                        let moved = startValue.map { abs(value - $0) > plan.step / 2 } ?? true
                        if plan.value(on: day) != nil || moved {
                            store.setValue(planID, on: day, value: value)
                            Feedback.play(.log)
                        } else {
                            Haptics.shared.menuChoose()
                        }
                        store.setNote(planID, on: day, note: note)
                        dismiss()
                    } label: {
                        Text("Save")
                            .font(.cadenceCallout)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Color.plum)
                }
                .padding(.horizontal, Metrics.gutter)
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .onAppear {
                guard !loaded else { return }
                value = store.draft(for: plan, on: day)
                startValue = value
                note = plan.note(on: day) ?? ""
                loaded = true
            }
        }
    }
}
