import SwiftUI

/// Where the plans sheet opens: straight into one plan's editor, on the list, or in
/// select mode for bulk changes.
enum PlansRoute: Identifiable, Equatable {
    case edit(UUID?)
    case select

    var id: String {
        switch self {
        case .edit(let id): "edit-\(id?.uuidString ?? "list")"
        case .select: "select"
        }
    }
}

/// Every plan in one list, where they can be edited, reordered, removed in bulk, or marked
/// done together. Opened from the ⋯ menu or the focus pill.
struct PlansSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var path: [UUID]
    @State private var editMode: EditMode
    @State private var selection: Set<UUID> = []
    @State private var showingTemplates = false
    @State private var confirmingBulkDelete = false
    @AppStorage(Prefs.soundsKey) private var soundsOn = true
    @AppStorage(Prefs.hapticsKey) private var hapticsOn = true

    init(route: PlansRoute) {
        switch route {
        case .edit(let id):
            _path = State(initialValue: id.map { [$0] } ?? [])
            _editMode = State(initialValue: .inactive)
        case .select:
            _path = State(initialValue: [])
            _editMode = State(initialValue: .active)
        }
    }

    private var selecting: Bool { editMode.isEditing }

    var body: some View {
        NavigationStack(path: $path) {
            List(selection: $selection) {
                Section {
                    ForEach(store.plans) { plan in
                        NavigationLink(value: plan.id) {
                            PlanListRow(plan: plan, today: store.today)
                        }
                    }
                    .onMove { store.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { offsets in
                        let ids = offsets.compactMap { store.plans.indices.contains($0) ? store.plans[$0].id : nil }
                        ids.forEach(store.delete)
                    }

                    if !selecting {
                        Button {
                            showingTemplates = true
                        } label: {
                            Label("New plan", systemImage: "plus")
                                .font(.cadenceBody)
                                .foregroundStyle(Color.plum)
                        }
                    }
                } header: {
                    SheetSectionHeader(text: "Plans")
                } footer: {
                    Text(selecting
                         ? "Select plans to mark today done or delete them together. Drag to reorder."
                         : "Tap a plan's name at the top of the screen to bring it forward. Hold the top of a card for its options.")
                        .font(.cadenceSubhead)
                        .foregroundStyle(Color.inkMuted)
                }
                .listRowBackground(Color.surface)

                if !selecting {
                    Section {
                        Toggle(isOn: $soundsOn) {
                            Label("Sounds", systemImage: "speaker.wave.2")
                        }
                        Toggle(isOn: $hapticsOn) {
                            Label("Haptics", systemImage: "hand.tap")
                        }
                    } header: {
                        SheetSectionHeader(text: "Feedback")
                    } footer: {
                        Text("Sounds follow the silent switch.")
                            .font(.cadenceSubhead)
                            .foregroundStyle(Color.inkMuted)
                    }
                    .font(.cadenceBodyMedium)
                    .tint(Color.plum)
                    .listRowBackground(Color.surface)
                }
            }
            .environment(\.editMode, $editMode)
            .scrollContentBackground(.hidden)
            .background(Color.canvas)
            .navigationTitle(selecting ? (selection.isEmpty ? "Select plans" : "\(selection.count) selected") : "Plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(selecting ? "Cancel" : "Select") {
                        withAnimation(Motion.standard) {
                            editMode = selecting ? .inactive : .active
                            selection.removeAll()
                        }
                    }
                    .font(.cadenceCallout)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                        .tint(Color.plum)
                }
                if selecting {
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button("Done today", systemImage: "checkmark.circle") {
                            markSelectedDone()
                        }
                        .disabled(selection.isEmpty)
                        Spacer()
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            confirmingBulkDelete = true
                        }
                        .disabled(selection.isEmpty)
                        .confirmationDialog(
                            "Delete \(selection.count) \(selection.count == 1 ? "plan" : "plans")?",
                            isPresented: $confirmingBulkDelete,
                            titleVisibility: .visible
                        ) {
                            Button("Delete with history", role: .destructive) { deleteSelected() }
                        } message: {
                            Text("Every week and check mark in them is removed.")
                        }
                    }
                }
            }
            .navigationDestination(for: UUID.self) { id in
                PlanEditor(planID: id, onDelete: {
                    path.removeAll()
                })
            }
            .sheet(isPresented: $showingTemplates) {
                TemplatePicker { template in
                    let plan = SeedData.template(template, today: store.today)
                    store.add(plan)
                    showingTemplates = false
                    path = [plan.id]
                }
                .presentationDetents([.medium, .large])
            }
        }
        .tint(Color.plum)
    }

    private func markSelectedDone() {
        var completed = 0
        for id in store.plans.map(\.id) where selection.contains(id) {
            guard let plan = store.plan(id), !plan.isMetric, plan.isPlanned(store.today),
                  plan.status(on: store.today) != .done else { continue }
            store.update(id) { $0.setDay(.done, on: store.today) }
            completed += 1
        }
        Feedback.play(completed > 0 ? .check(step: 0) : .disarmed)
        withAnimation(Motion.standard) {
            selection.removeAll()
            editMode = .inactive
        }
    }

    private func deleteSelected() {
        let ids = selection
        withAnimation(Motion.standard) {
            ids.forEach(store.delete)
            selection.removeAll()
            editMode = .inactive
        }
        Feedback.play(.skip)
    }
}

struct SheetSectionHeader: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.cadenceLabel)
            .foregroundStyle(Color.inkSecondary)
    }
}

private struct PlanListRow: View {
    let plan: Plan
    let today: Day

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: plan.isMetric ? "number" : plan.columnCount > 1 ? "square.split.2x1" : "list.bullet")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.plum)
                .frame(width: 30, height: 30)
                .background(Color.plum.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(plan.name)
                    .font(.cadenceBody)
                    .foregroundStyle(Color.ink)
                Text(subtitle)
                    .font(.cadenceCaption)
                    .foregroundStyle(Color.inkMuted)
            }
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        if plan.isMetric {
            if let value = plan.latestValue(onOrBefore: today) {
                return "LAST \(plan.format(value)) \(plan.unit.uppercased())"
            }
            return "DAILY NUMBER"
        }
        let progress = plan.progress(in: today.weekDays)
        let columns = plan.columnCount > 1 ? plan.columns.joined(separator: " / ").uppercased() + " · " : ""
        return "\(columns)\(progress.done)/\(progress.planned) THIS WEEK"
    }
}

struct TemplatePicker: View {
    var onPick: (PlanTemplate) -> Void

    var body: some View {
        NavigationStack {
            List(PlanTemplate.allCases) { template in
                Button {
                    Haptics.shared.tick()
                    onPick(template)
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: template.symbol)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color.plum)
                            .frame(width: 36, height: 36)
                            .background(Color.plum.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(template.title)
                                .font(.cadenceBody)
                                .foregroundStyle(Color.ink)
                            Text(template.detail)
                                .font(.cadenceSubhead)
                                .foregroundStyle(Color.inkSecondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .contentShape(.rect)
                }
                .buttonStyle(RowPressStyle())
                .listRowBackground(Color.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas)
            .navigationTitle("New plan")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
