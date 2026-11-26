import SwiftUI

/// Settings and history for a daily-number plan.
struct MetricEditor: View {
    let plan: Plan
    var onDelete: () -> Void

    @Environment(Store.self) private var store
    @State private var confirmingDelete = false

    private let steps: [Double] = [0.1, 0.5, 1]

    var body: some View {
        let entries = plan.records
            .compactMap { key, record in record.value.flatMap { value in Day(key: key).map { MetricPoint(day: $0, value: value) } } }
            .sorted { $0.day > $1.day }

        List {
            Section {
                LabeledContent("Unit") {
                    TextField("lb", text: binding(\.unit))
                        .multilineTextAlignment(.trailing)
                        .textInputAutocapitalization(.never)
                }
                Picker("Ruler step", selection: binding(\.step)) {
                    ForEach(steps, id: \.self) { step in
                        Text(step.formatted(.number.precision(.fractionLength(step < 1 ? 1 : 0)))).tag(step)
                    }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)
            } header: {
                // The name is the page's one title, editable in place like the routine editor.
                VStack(alignment: .leading, spacing: 20) {
                    TextField("Name", text: binding(\.name))
                        .font(.cadenceNumber(28))
                        .tracking(-0.6)
                        .foregroundStyle(Color.ink)
                        .submitLabel(.done)
                    SheetSectionHeader(text: "Setup")
                }
                .textCase(nil)
            }
            .font(.cadenceBodyMedium)
            .foregroundStyle(Color.ink)
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
                    Text("Nothing logged yet. Scrub the ruler on the Today card, then tap the check.")
                        .font(.cadenceSubhead)
                        .foregroundStyle(Color.inkSecondary)
                }
                ForEach(entries) { entry in
                    HStack {
                        Text(DayText.long(entry.day))
                            .font(.cadenceSubhead)
                            .foregroundStyle(Color.inkSecondary)
                        Spacer()
                        Text("\(plan.format(entry.value)) \(plan.unit)")
                            .font(.cadenceBody)
                            .monospacedDigit()
                            .foregroundStyle(Color.ink)
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
                Button("Delete plan", systemImage: "trash", role: .destructive) {
                    confirmingDelete = true
                }
                .font(.cadenceCallout)
            }
            .listRowBackground(Color.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Color.canvas)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Delete \(plan.name)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete plan and its history", role: .destructive) {
                store.delete(plan.id)
                onDelete()
            }
        }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<Plan, Value>) -> Binding<Value> {
        Binding(
            get: { plan[keyPath: keyPath] },
            set: { newValue in store.update(plan.id) { $0[keyPath: keyPath] = newValue } }
        )
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
    @State private var loaded = false

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

                HStack(spacing: 12) {
                    if plan.value(on: day) != nil {
                        Button {
                            store.setValue(planID, on: day, value: nil)
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
                        store.setValue(planID, on: day, value: value)
                        Feedback.play(.log)
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
                loaded = true
            }
        }
    }
}
