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
    var frontID: UUID?
    var onSelectPlan: (UUID) -> Void
    var onEdit: () -> Void

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

            GlassIconButton(systemName: "square.and.pencil", voiceOverLabel: "Edit plans", action: onEdit)
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
            Text(plan.name.isEmpty ? "Untitled" : plan.name)
                .font(.cadenceTitle)
                .tracking(-0.2)
                .foregroundStyle(active ? Color.ink : Color.inkMuted)
                .lineLimit(1)
                .fixedSize()
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
        .accessibilityHint(active ? "" : "Shows \(plan.name)")
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
        .frame(maxWidth: 320)
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
        .padding(.horizontal, Metrics.gutter)
        .padding(.bottom, 4)
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
