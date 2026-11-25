import SwiftUI

/// Opened from the pencil button. Lands directly in the editor for the plan at the front
/// of the deck; Back shows every plan, where they can be added, reordered and removed.
struct PlansSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var path: [UUID]
    @State private var showingTemplates = false
    @AppStorage(Prefs.soundsKey) private var soundsOn = true
    @AppStorage(Prefs.hapticsKey) private var hapticsOn = true

    init(startingAt planID: UUID?) {
        _path = State(initialValue: planID.map { [$0] } ?? [])
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    ForEach(store.plans) { plan in
                        NavigationLink(value: plan.id) {
                            PlanListRow(plan: plan, today: store.today)
                        }
                    }
                    .onMove { store.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { offsets in
                        for index in offsets.sorted(by: >) where store.plans.indices.contains(index) {
                            store.delete(store.plans[index].id)
                        }
                    }

                    Button {
                        showingTemplates = true
                    } label: {
                        Label("New plan", systemImage: "plus")
                            .font(.cadenceBody)
                            .foregroundStyle(Color.plum)
                    }
                } header: {
                    SheetSectionHeader(text: "Plans")
                } footer: {
                    Text("Tap a plan's name at the top, or pull its card down, to move between plans.")
                        .font(.cadenceSubhead)
                        .foregroundStyle(Color.inkMuted)
                }
                .listRowBackground(Color.surface)

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
                    Button("Done", systemImage: "checkmark") { dismiss() }
                        .tint(Color.plum)
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

private struct TemplatePicker: View {
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
