import SwiftUI

enum ViewMode: String, CaseIterable, Identifiable {
    case today, week, month, scrolling

    var id: String { rawValue }

    /// The names from the design's view menu.
    var title: String {
        switch self {
        case .today: "Today"
        case .week: "Week"
        case .month: "Month"
        case .scrolling: "Scrolling"
        }
    }

    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

/// The header from the design: "Today ⌄" opens the view menu on the left; the round glass
/// button on the right holds everything else. Plans aren't listed here: you move between
/// them on the deck itself.
struct HeaderBar: View {
    let mode: ViewMode
    var onSelectMode: (ViewMode) -> Void
    let plans: [Plan]
    var frontID: UUID?
    var onSelectPlan: (UUID) -> Void
    var onOpenPlans: (PlansRoute) -> Void
    var onJumpToToday: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                Picker("View", selection: Binding(get: { mode }, set: onSelectMode)) {
                    ForEach(ViewMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(mode.title)
                        .font(.cadenceTitle)
                        .tracking(-0.2)
                        .foregroundStyle(Color.ink)
                        .contentTransition(.interpolate)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.inkSecondary)
                }
                .padding(.vertical, 10)
                .padding(.trailing, 20)
                .contentShape(.rect)
            }
            .accessibilityLabel("View: \(mode.title)")
            .accessibilityHint("Choose Today, Week, Month or Scrolling")

            Spacer(minLength: 8)

            MoreMenu(
                plans: plans,
                frontID: frontID,
                onSelectPlan: onSelectPlan,
                onOpenPlans: onOpenPlans,
                onJumpToToday: onJumpToToday
            )
        }
        .padding(.horizontal, Metrics.gutter - 2)
        .padding(.top, 13)
    }
}

/// The round button where the design's edit button sat: neutral glass (the one colored button
/// on screen is Create), opening a Liquid Glass menu that grows out of it.
struct MoreMenu: View {
    let plans: [Plan]
    var frontID: UUID?
    var onSelectPlan: (UUID) -> Void
    var onOpenPlans: (PlansRoute) -> Void
    /// Nil hides "Jump to today", for views already pinned to today.
    var onJumpToToday: (() -> Void)?

    @AppStorage(Prefs.soundsKey) private var soundsOn = true
    @AppStorage(Prefs.hapticsKey) private var hapticsOn = true

    var body: some View {
        Menu {
            Section {
                Button("Edit plan", systemImage: "square.and.pencil") { onOpenPlans(.edit(frontID)) }
                Button("All plans", systemImage: "list.bullet") { onOpenPlans(.edit(nil)) }
                Button("Select plans", systemImage: "checkmark.circle") { onOpenPlans(.select) }
            }
            if plans.count > 1 {
                // A way to any plan without the deck gestures (and for VoiceOver).
                Picker("Show plan", selection: Binding(get: { frontID }, set: { if let id = $0 { onSelectPlan(id) } })) {
                    ForEach(plans) { plan in
                        Text(plan.name.isEmpty ? "Untitled" : plan.name).tag(Optional(plan.id))
                    }
                }
                .pickerStyle(.menu)
            }
            if let onJumpToToday {
                Section {
                    Button("Jump to today", systemImage: "calendar") { onJumpToToday() }
                }
            }
            Section {
                Toggle(isOn: $soundsOn) { Label("Sounds", systemImage: "speaker.wave.2") }
                Toggle(isOn: $hapticsOn) { Label("Haptics", systemImage: "hand.tap") }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.ink)
                .frame(width: 40, height: 40)
                .glassEffect(.regular.interactive(), in: .circle)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .accessibilityLabel("More")
    }
}

/// Create, floating bottom right. The one strongly colored control in the app: prominent
/// Liquid Glass in deep plum, a little larger than the other round buttons, with a soft
/// plum glow underneath so it sits above the page rather than on it.
struct CreateButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Color.onPlumStrong)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .tint(Color.plumStrong)
        .shadow(color: Color.plumStrong.opacity(0.35), radius: 14, x: 0, y: 8)
        .accessibilityLabel("New plan")
    }
}

extension Int {
    func clamped(_ lower: Int, _ upper: Int) -> Int { Swift.min(Swift.max(self, lower), upper) }
}
