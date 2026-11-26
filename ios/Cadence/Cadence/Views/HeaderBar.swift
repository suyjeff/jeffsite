import SwiftUI

enum ViewMode: String, CaseIterable, Identifiable {
    // Raw values are persisted; "scrolling" keeps its old key and is shown as "All".
    case today, week, month, scrolling

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .week: "Week"
        case .month: "Month"
        case .scrolling: "All"
        }
    }

    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

/// Top of the screen: what you're looking at. Each plan is a tab named in full, so switching
/// is one tap and you can always see where you are. The row scrolls sideways when the names
/// don't fit, and the next name fades out past the edge to show there's more.
struct HeaderBar: View {
    let plans: [Plan]
    let today: Day
    var frontID: UUID?
    var onSelectPlan: (UUID) -> Void
    var onOpenPlans: (PlansRoute) -> Void
    var onJumpToToday: () -> Void

    @Namespace private var selection

    var body: some View {
        HStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 2) {
                        ForEach(plans) { plan in
                            tab(plan)
                                .id(plan.id)
                        }
                    }
                    // The first tab's text sits on the same 24pt edge as the cards below.
                    .padding(.leading, Metrics.gutter - 12)
                    .padding(.trailing, 16)
                }
                .scrollIndicators(.hidden)
                .mask {
                    HStack(spacing: 0) {
                        Color.black
                        LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: 24)
                    }
                }
                .onChange(of: frontID) { _, id in
                    guard let id else { return }
                    withAnimation(Motion.standard) { proxy.scrollTo(id, anchor: .center) }
                }
                .onAppear {
                    if let frontID { proxy.scrollTo(frontID, anchor: .center) }
                }
            }

            MoreMenu(
                frontID: frontID,
                onOpenPlans: onOpenPlans,
                onJumpToToday: onJumpToToday
            )
        }
        .padding(.trailing, Metrics.gutter - 2)
        .padding(.top, 13)
        .animation(Motion.snappy, value: frontID)
    }

    private func tab(_ plan: Plan) -> some View {
        let active = plan.id == frontID
        return Button {
            guard !active else { return }
            onSelectPlan(plan.id)
        } label: {
            HStack(spacing: 7) {
                StatusDot(status: plan.status(on: today))
                Text(plan.name.isEmpty ? "Untitled" : plan.name)
                    .font(.cadenceTitle)
                    .tracking(-0.2)
                    .foregroundStyle(active ? Color.ink : Color.inkMuted)
                    .lineLimit(1)
                    .fixedSize()
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background {
                if active {
                    Capsule()
                        .fill(Color.plum.opacity(0.1))
                        .matchedGeometryEffect(id: "selection", in: selection)
                }
            }
            .frame(height: 44)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .accessibilityValue(statusText(plan.status(on: today)))
        .accessibilityHint(active ? "" : "Shows \(plan.name)")
    }

    private func statusText(_ status: DayStatus) -> String {
        switch status {
        case .done: "Done today"
        case .skipped: "Not today"
        case .partial(let done, let total): "\(done) of \(total) done today"
        case .pending: "To do today"
        case .empty: "Nothing today"
        }
    }
}

/// Today's state of a plan, at tab size: a ring still to do, half-filled when partly done,
/// solid plum when done (it pops in), faint when skipped or nothing is planned.
struct StatusDot: View {
    let status: DayStatus

    var body: some View {
        let fraction: CGFloat = {
            switch status {
            case .done: return 1
            case .partial(let done, let total): return total > 0 ? CGFloat(done) / CGFloat(total) : 0
            default: return 0
            }
        }()
        ZStack {
            Circle()
                .strokeBorder(ringColor, lineWidth: 1.5)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(Color.plum, style: StrokeStyle(lineWidth: 3.5))
                .rotationEffect(.degrees(-90))
                .padding(1.75)
            Circle()
                .fill(Color.plum)
                .scaleEffect(status == .done ? 1 : 0.2)
                .opacity(status == .done ? 1 : 0)
            Circle()
                .fill(Color.inkFaint)
                .opacity(status == .skipped ? 1 : 0)
        }
        .frame(width: 8, height: 8)
        .animation(status == .done ? .spring(duration: 0.4, bounce: 0.55) : Motion.snappy, value: status)
        .accessibilityHidden(true)
    }

    private var ringColor: Color {
        switch status {
        case .pending, .partial: .inkMuted
        case .done: .plum
        case .skipped, .empty: .inkFaint
        }
    }
}

/// The ⋯ in the top corner: secondary actions and settings, in a Liquid Glass menu that
/// grows out of the button. Neutral glass on purpose: the one colored button on screen is
/// Create, so the primary action is never in doubt.
struct MoreMenu: View {
    var frontID: UUID?
    var onOpenPlans: (PlansRoute) -> Void
    var onJumpToToday: () -> Void

    @AppStorage(Prefs.soundsKey) private var soundsOn = true
    @AppStorage(Prefs.hapticsKey) private var hapticsOn = true

    var body: some View {
        Menu {
            Section {
                Button("Edit this plan", systemImage: "square.and.pencil") { onOpenPlans(.edit(frontID)) }
                Button("All plans", systemImage: "list.bullet") { onOpenPlans(.edit(nil)) }
                Button("Select plans", systemImage: "checkmark.circle") { onOpenPlans(.select) }
            }
            Section {
                Button("Jump to today", systemImage: "calendar") { onJumpToToday() }
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

/// The floating Create button, bottom right. The only strongly colored control in the app.
struct CreateButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.onPlumStrong)
                .frame(width: 48, height: 48)
                .glassEffect(.regular.tint(Color.plumStrong).interactive(), in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("New plan")
    }
}

/// Bottom of the screen: how much time you're looking at. A floating Liquid Glass bar in the
/// thumb zone. The plum lens follows your finger the moment you touch, so you can slide
/// across modes with a detent on each, and the view changes when you let go.
struct ModeBar: View {
    var mode: ViewMode
    var onSelect: (ViewMode) -> Void

    @State private var hover: ViewMode?
    /// Each segment's frame in the bar's own space. Hit-testing against measured frames
    /// stays correct in right-to-left layouts, where the segments run the other way.
    @State private var frames: [ViewMode: CGRect] = [:]
    @Namespace private var lens

    private let inset: CGFloat = 4
    private let space = "modeBar"

    var body: some View {
        let shown = hover ?? mode

        HStack(spacing: 0) {
            ForEach(ViewMode.allCases) { item in
                Text(item.title)
                    .font(.cadenceCallout)
                    .foregroundStyle(item == shown ? Color.onPlum : Color.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .background {
                        if item == shown {
                            Capsule()
                                .fill(Color.plum)
                                .matchedGeometryEffect(id: "lens", in: lens)
                        }
                    }
                    .onGeometryChange(for: CGRect.self) { proxy in
                        proxy.frame(in: .named("modeBar"))
                    } action: { frame in
                        frames[item] = frame
                    }
                    .accessibilityElement()
                    .accessibilityLabel(item.title)
                    .accessibilityAddTraits(item == mode ? [.isButton, .isSelected] : .isButton)
                    .accessibilityAction { onSelect(item) }
            }
        }
        .padding(inset)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular, in: .capsule)
        .contentShape(.capsule)
        .coordinateSpace(.named(space))
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named(space))
                .onChanged { value in
                    let target = segment(at: value.location.x)
                    if target != shown { Haptics.shared.tick() }
                    hover = target
                }
                .onEnded { value in
                    let target = segment(at: value.location.x)
                    hover = nil
                    if target != mode { onSelect(target) }
                }
        )
        .animation(Motion.snappy, value: shown)
    }

    /// The segment under the finger, or the nearest one when the finger slides past the ends.
    private func segment(at x: CGFloat) -> ViewMode {
        guard !frames.isEmpty else { return mode }
        if let hit = frames.first(where: { x >= $0.value.minX && x < $0.value.maxX }) {
            return hit.key
        }
        return frames.min { abs($0.value.midX - x) < abs($1.value.midX - x) }?.key ?? mode
    }
}

extension Int {
    func clamped(_ lower: Int, _ upper: Int) -> Int { Swift.min(Swift.max(self, lower), upper) }
}
