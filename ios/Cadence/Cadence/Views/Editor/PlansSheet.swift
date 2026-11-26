import SwiftUI

/// What the plans sheet opens on: one plan's editor, or the list of every plan.
enum PlansRoute: Identifiable, Equatable {
    case plan(UUID)
    case list

    var id: String {
        switch self {
        case .plan(let id): "plan-\(id.uuidString)"
        case .list: "list"
        }
    }
}

/// A page inside the plans sheet.
enum PlansPage: Hashable {
    case list
    case plan(UUID)
}

/// Editing plans. Opened on one plan, its editor is the whole sheet: ✓ closes it, and the
/// button opposite leads to every plan. Opened on the list, each plan opens its editor.
struct PlansSheet: View {
    let route: PlansRoute

    @Environment(\.dismiss) private var dismiss
    @State private var path: [PlansPage] = []

    var body: some View {
        NavigationStack(path: $path) {
            root
                .navigationDestination(for: PlansPage.self) { page in
                    switch page {
                    case .list:
                        PlansList(path: $path, rootPlanID: rootPlanID, onClose: close)
                    case .plan(let id):
                        editor(id, isRoot: false)
                    }
                }
        }
        .tint(Color.plum)
    }

    @ViewBuilder
    private var root: some View {
        switch route {
        case .plan(let id):
            editor(id, isRoot: true)
        case .list:
            PlansList(path: $path, rootPlanID: nil, onClose: close)
        }
    }

    private var rootPlanID: UUID? {
        if case .plan(let id) = route { return id }
        return nil
    }

    private func editor(_ id: UUID, isRoot: Bool) -> some View {
        PlanEditor(planID: id, onDelete: {
            if isRoot {
                close()
            } else if !path.isEmpty {
                path.removeLast()
            }
        })
        .toolbar {
            if isRoot {
                ToolbarItem(placement: .topBarLeading) {
                    Button("All plans", systemImage: "square.stack") {
                        path.append(.list)
                    }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", systemImage: "checkmark", action: close)
            }
        }
    }

    private func close() {
        dismiss()
    }
}

/// Every plan, in deck order. Tap one to open it; swipe right to mark today done, left to
/// delete; Edit to reorder.
private struct PlansList: View {
    @Binding var path: [PlansPage]
    /// The plan the sheet was opened on, if any. Deleting it closes the sheet rather than
    /// leaving an empty editor underneath.
    var rootPlanID: UUID?
    var onClose: () -> Void

    @Environment(Store.self) private var store
    /// A plan swiped to delete, waiting for confirmation (it takes its history with it).
    @State private var pendingDelete: Plan?

    var body: some View {
        List {
            Section {
                ForEach(store.plans) { plan in
                    NavigationLink(value: PlansPage.plan(plan.id)) {
                        PlanListRow(plan: plan, today: store.today)
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        if canMarkDone(plan) {
                            Button("Done today", systemImage: "checkmark") { markDone(plan) }
                                .tint(Color.success)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        // No destructive role: that would remove the row before it's confirmed.
                        Button("Delete", systemImage: "trash") { pendingDelete = plan }
                            .tint(Color.danger)
                    }
                }
                .onMove { store.move(fromOffsets: $0, toOffset: $1) }

                Menu {
                    ForEach(PlanTemplate.allCases) { template in
                        Button(template.title, systemImage: template.symbol) { create(template) }
                    }
                } label: {
                    Label("New plan", systemImage: "plus")
                        .font(.cadenceBody)
                        .foregroundStyle(Color.plum)
                }
            }
            .listRowBackground(Color.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Color.canvas)
        .navigationTitle("Plans")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                EditButton()
                    .font(.cadenceCallout)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", systemImage: "checkmark", action: onClose)
            }
        }
        .confirmationDialog(
            "Delete \(pendingDelete?.name ?? "plan")?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { plan in
            Button("Delete plan", role: .destructive) {
                withAnimation(Motion.standard) { store.delete(plan.id) }
                Feedback.play(.skip)
                pendingDelete = nil
                if plan.id == rootPlanID { onClose() }
            }
        } message: { _ in
            Text("Its weeks and check marks are deleted too.")
        }
    }

    private func canMarkDone(_ plan: Plan) -> Bool {
        !plan.isMetric && plan.isPlanned(store.today) && plan.status(on: store.today) != .done
    }

    private func markDone(_ plan: Plan) {
        let change = withAnimation(Motion.standard) {
            store.toggleDone(plan.id, on: store.today)
        }
        Feedback.play(for: change)
    }

    private func create(_ template: PlanTemplate) {
        let plan = SeedData.template(template, today: store.today)
        withAnimation(Motion.standard) { store.add(plan) }
        Feedback.play(.check(step: 0))
        path.append(.plan(plan.id))
    }
}

/// Sounds and haptics, out of the way of everyday use. Opened from ⋯.
struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Prefs.soundsKey) private var soundsOn = true
    @AppStorage(Prefs.hapticsKey) private var hapticsOn = true

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle(isOn: $soundsOn) {
                        Label("Sounds", systemImage: "speaker.wave.2")
                    }
                    Toggle(isOn: $hapticsOn) {
                        Label("Haptics", systemImage: "hand.tap")
                    }
                } footer: {
                    Text("Sounds follow the silent switch.")
                        .font(.cadenceSubhead)
                        .foregroundStyle(Color.inkSecondary)
                }
                .font(.cadenceBodyMedium)
                .listRowBackground(Color.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
            // Turning one on plays it, so you know what you've turned on.
            .onChange(of: soundsOn) { _, isOn in
                if isOn { Sounds.shared.play(.check) }
            }
            .onChange(of: hapticsOn) { _, isOn in
                if isOn { Haptics.shared.check() }
            }
        }
        .tint(Color.plum)
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
                    .foregroundStyle(Color.inkSecondary)
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
