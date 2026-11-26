import SwiftUI

/// The top of every plan editor: the plan's icon (tap to choose another) and its name,
/// editable in place. The page's one title.
struct PlanTitleField: View {
    let plan: Plan

    @Environment(Store.self) private var store
    @State private var choosingIcon = false

    var body: some View {
        HStack(spacing: 14) {
            Button {
                Haptics.shared.tick()
                choosingIcon = true
            } label: {
                IconWell(symbol: plan.symbol)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Icon: \(PlanIcons.name(plan.symbol))")
            .accessibilityHint("Choose an icon for this plan")
            .popover(isPresented: $choosingIcon, arrowEdge: .top) {
                IconGrid(selection: plan.symbol) { symbol in
                    store.update(plan.id) { $0.icon = symbol }
                    choosingIcon = false
                }
                .presentationCompactAdaptation(.popover)
            }

            TextField("Name", text: Binding(
                get: { plan.name },
                set: { name in store.update(plan.id) { $0.name = name } }
            ))
            .font(.cadenceNumber(28))
            .tracking(-0.6)
            .foregroundStyle(Color.ink)
            .submitLabel(.done)
        }
    }
}

/// Every icon a plan can wear, in a grid. The current one is ringed.
struct IconGrid: View {
    let selection: String
    var onPick: (String) -> Void

    private let columns = Array(repeating: GridItem(.fixed(44), spacing: 6), count: 6)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 6) {
            ForEach(PlanIcons.all, id: \.self) { symbol in
                let selected = symbol == selection
                Button {
                    Haptics.shared.menuChoose()
                    onPick(symbol)
                } label: {
                    Image(systemName: symbol)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(selected ? Color.ink : Color.inkSecondary)
                        .frame(width: 44, height: 44)
                        .background(Color.ink.opacity(selected ? 0.1 : 0), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Color.ink.opacity(selected ? 0.35 : 0), lineWidth: 1.5)
                        }
                        .contentShape(.rect)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(PlanIcons.name(symbol))
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(14)
    }
}

/// "Delete plan", the same in every editor: a full-width Liquid Glass button in red, asking
/// first, since a plan takes its whole history with it.
struct DeletePlanButton: View {
    let plan: Plan
    var onDelete: () -> Void

    @Environment(Store.self) private var store
    @State private var confirming = false

    var body: some View {
        Button(role: .destructive) {
            confirming = true
        } label: {
            Label("Delete plan", systemImage: "trash")
                .font(.cadenceCallout)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
        }
        .buttonStyle(.glass)
        .tint(Color.danger)
        .confirmationDialog("Delete \(plan.name.isEmpty ? "this plan" : plan.name)?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Delete plan and its history", role: .destructive) {
                store.delete(plan.id)
                onDelete()
            }
        } message: {
            Text("Every day logged or checked off in this plan will be removed.")
        }
    }
}

/// The plan's icon on a flat well: a lighter step of the theme behind a darker glyph (the
/// other way round in dark mode).
struct IconWell: View {
    let symbol: String
    var size: CGFloat = 48

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.4, weight: .medium))
            .foregroundStyle(Color.iconInk)
            .frame(width: size, height: size)
            .background(Color.iconWell, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    }
}
