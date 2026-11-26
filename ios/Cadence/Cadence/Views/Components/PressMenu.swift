import SwiftUI
import UIKit

// MARK: - Model

/// One row of a press menu.
struct MenuItem: Identifiable {
    enum Role {
        case normal
        /// Red. In a confirmation it becomes the filled button.
        case destructive
        /// Green: completing something.
        case success
    }

    let id: String
    var title: String
    var systemImage: String?
    var role: Role = .normal
    /// A check in the trailing edge (the current view, the front plan).
    var isChecked = false
    var isEnabled = true
    var action: () -> Void
}

/// A menu (or a small confirmation) to show, anchored to the control that opened it.
struct MenuRequest {
    enum Placement {
        /// Hangs below the anchor, leading edges aligned (the view title).
        case belowLeading
        /// Hangs below the anchor, trailing edges aligned (⋯).
        case belowTrailing
        /// Rises above the anchor, trailing edges aligned (Create).
        case aboveTrailing
        /// Rises above the anchor, centered on it (the focus pill).
        case aboveCenter
    }

    var anchor: CGRect
    var placement: Placement
    /// A confirmation's question and its consequence, shown above the rows.
    var title: String?
    var message: String?
    var sections: [[MenuItem]]
    /// Where a tail points, in window coordinates (an x for menus above the anchor).
    var tailX: CGFloat?
    /// Whether sliding onto a row and letting go chooses it. Off for confirmations, so a
    /// destructive row always takes a separate, deliberate tap.
    var choosesOnRelease = true

    var items: [MenuItem] { sections.flatMap { $0 } }
}

// MARK: - Controller

/// The one menu on screen. Triggers open it and stream the finger's position while it's down
/// (press, drag onto a row, release to choose, as with system menus); the panel reports where
/// its rows are. Lives in the environment so any control can open a menu over everything.
@MainActor
@Observable
final class MenuController {
    private(set) var request: MenuRequest?
    private(set) var highlighted: String?
    /// Bumps per menu, so each one is a fresh view with its own transition.
    private(set) var generation = 0

    @ObservationIgnored var rowFrames: [String: CGRect] = [:]
    @ObservationIgnored private var dragSelects = true

    var isOpen: Bool { request != nil }

    func open(_ request: MenuRequest, reduceMotion: Bool = false) {
        rowFrames = [:]
        highlighted = nil
        dragSelects = request.choosesOnRelease
        generation += 1
        Haptics.shared.menuOpen()
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.3, bounce: 0.16)) {
            self.request = request
        }
    }

    /// The finger moved while a press that opened this menu (or a touch on its panel) is down.
    func track(_ point: CGPoint, fromTrigger: Bool) {
        guard let request else { return }
        if fromTrigger && !dragSelects { return }
        let hit = request.items.first { item in
            item.isEnabled && (rowFrames[item.id]?.contains(point) ?? false)
        }?.id
        guard hit != highlighted else { return }
        highlighted = hit
        if hit != nil { Haptics.shared.menuSelection() }
    }

    /// The finger lifted. Over a row, that row is chosen; anywhere else the menu stays open
    /// for a tap.
    func release(fromTrigger: Bool) {
        guard let id = highlighted else { return }
        if fromTrigger && !dragSelects { return }
        choose(id)
    }

    /// A touch on the panel went away without lifting over a row (scrolled, cancelled).
    func clearHighlight() {
        highlighted = nil
    }

    func choose(_ id: String) {
        guard let item = request?.items.first(where: { $0.id == id }), item.isEnabled else { return }
        Haptics.shared.menuChoose()
        close()
        item.action()
    }

    func close() {
        guard request != nil else { return }
        highlighted = nil
        withAnimation(.easeOut(duration: 0.16)) { request = nil }
    }
}

extension EnvironmentValues {
    @Entry var menuController: MenuController? = nil
}

// MARK: - Trigger

extension View {
    /// Opens a menu from this control: on a tap, or on a short hold, after which sliding
    /// onto a row and letting go chooses it. A crisp tap on touch-down, a fuller one as the
    /// menu opens, a tick per row, and a click on choosing.
    func pressMenu(
        isEnabled: Bool = true,
        label: String,
        _ makeRequest: @escaping (CGRect) -> MenuRequest
    ) -> some View {
        modifier(PressMenuTrigger(isEnabled: isEnabled, label: label, makeRequest: makeRequest))
    }
}

private struct PressMenuTrigger: ViewModifier {
    var isEnabled: Bool
    let label: String
    let makeRequest: (CGRect) -> MenuRequest

    @Environment(\.menuController) private var menu
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var box = MenuFrameBox()
    @State private var pressed = false

    func body(content: Content) -> some View {
        content
            // Measured before the press scale, so menus line up with the control at rest.
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .global)
            } action: { [box] frame in
                box.frame = frame
            }
            .scaleEffect(pressed && !reduceMotion ? 0.92 : 1)
            .animation(pressed ? .easeOut(duration: 0.1) : .spring(duration: 0.3, bounce: 0.35), value: pressed)
            .gesture(PressGesture(
                isEnabled: isEnabled,
                onPress: { pressed = $0 },
                onOpen: open,
                onTrack: { menu?.track($0, fromTrigger: true) },
                onRelease: { menu?.release(fromTrigger: true) }
            ))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { open() }
    }

    private func open() {
        guard isEnabled, let menu else { return }
        menu.open(makeRequest(box.frame), reduceMotion: reduceMotion)
    }
}

private final class MenuFrameBox {
    var frame: CGRect = .zero
}

/// Touch-down to release, tracked by UIKit so the press registers the instant a finger lands
/// (SwiftUI's buttons wait to know it isn't a scroll). Opens after a short hold, as soon as
/// the finger starts sliding, or on release, whichever comes first.
private struct PressGesture: UIGestureRecognizerRepresentable {
    var isEnabled: Bool
    var onPress: (Bool) -> Void
    var onOpen: () -> Void
    var onTrack: (CGPoint) -> Void
    var onRelease: () -> Void

    /// Long enough that a tap reads as a tap; short enough that a hold feels immediate.
    static let holdToOpen: Duration = .milliseconds(160)

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = 0
        recognizer.allowableMovement = .greatestFiniteMagnitude
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        recognizer.isEnabled = isEnabled
        context.coordinator.onOpen = onOpen
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        let coordinator = context.coordinator
        let point = context.converter.location(in: .global)
        switch recognizer.state {
        case .began:
            coordinator.start = point
            coordinator.opened = false
            onPress(true)
            Haptics.shared.press()
            coordinator.scheduleOpen(after: Self.holdToOpen)
        case .changed:
            if coordinator.opened {
                onTrack(point)
            } else if hypot(point.x - coordinator.start.x, point.y - coordinator.start.y) > 8 {
                // Sliding away from the control: open now so the slide lands on a row.
                coordinator.openNow()
                onTrack(point)
            }
        case .ended:
            onPress(false)
            if coordinator.opened {
                onRelease()
            } else {
                coordinator.openNow()
            }
            coordinator.reset()
        case .cancelled, .failed:
            onPress(false)
            coordinator.reset()
        default:
            break
        }
    }

    @MainActor
    final class Coordinator {
        var start: CGPoint = .zero
        var opened = false
        var onOpen: () -> Void = {}
        private var pending: Task<Void, Never>?

        func scheduleOpen(after delay: Duration) {
            pending?.cancel()
            pending = Task { @MainActor [weak self] in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                self?.openNow()
            }
        }

        func openNow() {
            pending?.cancel()
            pending = nil
            guard !opened else { return }
            opened = true
            onOpen()
        }

        func reset() {
            pending?.cancel()
            pending = nil
        }
    }
}

// MARK: - Layer

/// Draws the open menu over everything, closing on a tap outside it.
struct MenuLayer: View {
    @Environment(\.menuController) private var menu
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let width: CGFloat = 250
    private let edge: CGFloat = 12
    private let gap: CGFloat = 8

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                if let menu, let request = menu.request {
                    Color.clear
                        .contentShape(.rect)
                        .onTapGesture { menu.close() }
                        .accessibilityLabel("Close menu")
                        .accessibilityAddTraits(.isButton)

                    let x = originX(request, width: proxy.size.width)
                    MenuPanel(request: request, panelMinX: x)
                        .id(menu.generation)
                        .frame(width: Self.width)
                        .modifier(Place(request: request, x: x, gap: gap))
                        .transition(transition(for: request, panelMinX: x))
                }
            }
        }
        .ignoresSafeArea()
    }

    private func originX(_ request: MenuRequest, width: CGFloat) -> CGFloat {
        let anchor = request.anchor
        let x: CGFloat = switch request.placement {
        case .belowLeading: anchor.minX - 6
        case .belowTrailing, .aboveTrailing: anchor.maxX - Self.width
        case .aboveCenter: anchor.midX - Self.width / 2
        }
        return x.clamped(edge, max(edge, width - Self.width - edge))
    }

    /// Grows out of the control: scaled from the corner (or tail) nearest it.
    private func transition(for request: MenuRequest, panelMinX: CGFloat) -> AnyTransition {
        let anchor: UnitPoint = switch request.placement {
        case .belowLeading: .topLeading
        case .belowTrailing: .topTrailing
        case .aboveTrailing: .bottomTrailing
        case .aboveCenter:
            UnitPoint(x: ((request.tailX ?? request.anchor.midX) - panelMinX) / Self.width, y: 1)
        }
        let exit = AnyTransition.opacity.combined(with: .scale(scale: 0.96, anchor: anchor))
            .animation(.easeOut(duration: 0.14))
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .scale(scale: 0.82, anchor: anchor).combined(with: .opacity),
            removal: exit
        )
    }

    /// Puts the panel's top below the anchor, or its bottom above it.
    private struct Place: ViewModifier {
        let request: MenuRequest
        let x: CGFloat
        let gap: CGFloat

        func body(content: Content) -> some View {
            switch request.placement {
            case .belowLeading, .belowTrailing:
                content.offset(x: x, y: request.anchor.maxY + gap)
            case .aboveTrailing, .aboveCenter:
                content
                    .frame(height: max(0, request.anchor.minY - gap), alignment: .bottom)
                    .offset(x: x)
            }
        }
    }
}

/// The glass panel: optional question, then rows in sections. A finger anywhere on it can
/// slide between rows; letting go over one chooses it.
private struct MenuPanel: View {
    let request: MenuRequest
    let panelMinX: CGFloat

    @Environment(\.menuController) private var menu

    private let radius: CGFloat = 22
    private let tail: CGFloat = 9

    private var hasTail: Bool { request.tailX != nil && request.placement == .aboveCenter }
    private var isConfirmation: Bool { request.title != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title = request.title {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.cadenceCallout)
                        .foregroundStyle(Color.ink)
                    if let message = request.message {
                        Text(message)
                            .font(.cadenceSubhead)
                            .foregroundStyle(Color.inkSecondary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 12)
                .accessibilityElement(children: .combine)
            }

            ForEach(Array(request.sections.enumerated()), id: \.offset) { index, section in
                if index > 0 {
                    Rectangle()
                        .fill(Color.ink.opacity(0.08))
                        .frame(height: 1)
                        .padding(.vertical, 4)
                        .padding(.horizontal, 16)
                }
                ForEach(section) { item in
                    row(item)
                }
            }
        }
        .padding(.vertical, isConfirmation ? 0 : 6)
        .padding(.bottom, isConfirmation ? 10 : 0)
        .padding(.bottom, hasTail ? tail : 0)
        .glassEffect(.regular, in: BubbleShape(radius: radius, tail: hasTail ? tail : 0, tailX: tailOffset))
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { value in menu?.track(value.location, fromTrigger: false) }
                .onEnded { _ in menu?.release(fromTrigger: false) }
        )
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { menu?.close() }
    }

    private var tailOffset: CGFloat {
        ((request.tailX ?? request.anchor.midX) - panelMinX).clamped(radius + tail, MenuLayer.width - radius - tail)
    }

    @ViewBuilder
    private func row(_ item: MenuItem) -> some View {
        let highlighted = menu?.highlighted == item.id
        let prominent = isConfirmation && item.role == .destructive
        let color: Color = !item.isEnabled ? .inkFaint
            : prominent ? .onDanger
            : item.role == .destructive ? .danger
            : item.role == .success ? .success
            : .ink

        HStack(spacing: 12) {
            if let symbol = item.systemImage, !prominent {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 22)
            }
            Text(item.title)
                .font(.cadenceBodyMedium)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if !prominent {
                Spacer(minLength: 8)
            }
            if item.isChecked {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity, alignment: prominent ? .center : .leading)
        .padding(.horizontal, 16)
        .frame(height: prominent ? 46 : 44)
        .background {
            if prominent {
                Capsule()
                    .fill(Color.danger)
                    .brightness(highlighted ? -0.08 : 0)
                    .padding(.horizontal, 10)
            } else {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.ink.opacity(highlighted ? 0.08 : 0))
                    .padding(.horizontal, 6)
            }
        }
        .scaleEffect(prominent && highlighted ? 0.97 : 1)
        .animation(.easeOut(duration: 0.08), value: highlighted)
        .contentShape(.rect)
        .onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .global)
        } action: { frame in
            menu?.rowFrames[item.id] = frame
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(item.isChecked ? [.isButton, .isSelected] : .isButton)
        .accessibilityRemoveTraits(item.isEnabled ? [] : .isButton)
        .accessibilityAction {
            if item.isEnabled { menu?.choose(item.id) }
        }
    }
}

/// A rounded rectangle with an optional tail on its bottom edge, so a panel rising from the
/// focus pill points at the button that opened it. One path, so the glass covers both.
struct BubbleShape: Shape {
    var radius: CGFloat
    var tail: CGFloat
    /// The tail's x within the shape.
    var tailX: CGFloat

    func path(in rect: CGRect) -> Path {
        let body = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height - tail)
        var path = Path(roundedRect: body, cornerRadius: radius, style: .continuous)
        guard tail > 0 else { return path }
        let x = rect.minX + tailX
        var point = Path()
        point.move(to: CGPoint(x: x - tail * 1.3, y: body.maxY - 0.5))
        point.addQuadCurve(to: CGPoint(x: x, y: rect.maxY), control: CGPoint(x: x - tail * 0.35, y: body.maxY + tail * 0.2))
        point.addQuadCurve(to: CGPoint(x: x + tail * 1.3, y: body.maxY - 0.5), control: CGPoint(x: x + tail * 0.35, y: body.maxY + tail * 0.2))
        point.closeSubpath()
        path.addPath(point)
        return path
    }
}
