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
        /// Rises above the anchor, trailing edges aligned.
        case aboveTrailing
        /// Rises above the anchor, leading edges aligned (a button at the bottom of a card).
        case aboveLeading
        /// Rises above the anchor, centered on it (the focus pill).
        case aboveCenter
    }

    var anchor: CGRect
    var placement: Placement
    /// A confirmation's question and its consequence, shown above the rows.
    var title: String?
    var message: String?
    var sections: [[MenuItem]]
    /// The x (in window coordinates) of the button that opened it: the panel grows from
    /// there, and a confirmation points its tail at it.
    var tailX: CGFloat?
    /// A small tail pointing at the button, for a confirmation tied to one button (Delete).
    var showsTail = false
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

    /// Where the finger is while it's down on the menu (or still down on the control that
    /// opened it). The panel leans and stretches toward it on a spring.
    private(set) var finger: CGPoint?

    @ObservationIgnored var rowFrames: [String: CGRect] = [:]
    @ObservationIgnored var panelFrame: CGRect = .zero
    @ObservationIgnored private var dragSelects = true

    var isOpen: Bool { request != nil }

    /// - Parameter held: opened by a hold (a fuller haptic) rather than a tap.
    func open(_ request: MenuRequest, held: Bool = false, reduceMotion: Bool = false) {
        rowFrames = [:]
        highlighted = nil
        finger = nil
        dragSelects = request.choosesOnRelease
        generation += 1
        Haptics.shared.menuOpen(held: held)
        // Opened many times a day, so quick: a 0.24s spring with just enough give.
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.24, bounce: 0.14)) {
            self.request = request
        }
    }

    /// The finger moved while a press that opened this menu (or a touch on its panel) is down.
    func track(_ point: CGPoint, fromTrigger: Bool) {
        guard let request else { return }
        finger = point
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
        finger = nil
        guard let id = highlighted else { return }
        if fromTrigger && !dragSelects { return }
        choose(id)
    }

    /// A touch on the panel went away without lifting over a row (scrolled, cancelled).
    func clearHighlight() {
        highlighted = nil
        finger = nil
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
        finger = nil
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
            .scaleEffect(pressed && !reduceMotion ? 0.86 : 1)
            .gesture(PressGesture(
                isEnabled: isEnabled,
                onPress: press,
                onOpen: { open(held: $0) },
                onTrack: { menu?.track($0, fromTrigger: true) },
                onRelease: { menu?.release(fromTrigger: true) },
                onCancel: { menu?.clearHighlight() }
            ))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { open(held: false) }
    }

    /// Pressing loads the control like a spring: it sinks slowly at first, then faster as
    /// the hold nears the point where the menu opens. Letting go early springs it back.
    private func press(_ isPressing: Bool) {
        if isPressing {
            withAnimation(.timingCurve(0.55, 0, 0.85, 0.4, duration: PressGesture.holdToOpen)) { pressed = true }
        } else if pressed {
            withAnimation(.spring(duration: 0.3, bounce: 0.3)) { pressed = false }
        }
    }

    /// The menu opens as the control pops back past its size, releasing the tension.
    private func open(held: Bool) {
        guard isEnabled, let menu else {
            withAnimation(.spring(duration: 0.3, bounce: 0.3)) { pressed = false }
            return
        }
        withAnimation(.spring(duration: 0.42, bounce: 0.5)) { pressed = false }
        menu.open(makeRequest(box.frame), held: held, reduceMotion: reduceMotion)
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
    /// Called with whether the press was held (or slid) rather than tapped.
    var onOpen: (Bool) -> Void
    var onTrack: (CGPoint) -> Void
    var onRelease: () -> Void
    /// The touch was taken away after the menu opened: let go of the highlight and the lean.
    var onCancel: () -> Void

    /// Long enough to feel the press load up and to tell a hold from a tap; short enough
    /// that holding never feels like waiting.
    static let holdToOpen: TimeInterval = 0.3

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
            Haptics.shared.holdBuild(duration: Self.holdToOpen)
            coordinator.scheduleOpen(after: Self.holdToOpen)
        case .changed:
            if coordinator.opened {
                onTrack(point)
            } else if hypot(point.x - coordinator.start.x, point.y - coordinator.start.y) > 8 {
                // Sliding away from the control: open now so the slide lands on a row.
                coordinator.openNow(held: true)
                onTrack(point)
            }
        case .ended:
            if coordinator.opened {
                onRelease()
            } else {
                coordinator.openNow(held: false)
            }
            coordinator.reset()
        case .cancelled, .failed:
            Haptics.shared.endHoldBuild()
            onPress(false)
            if coordinator.opened { onCancel() }
            coordinator.reset()
        default:
            break
        }
    }

    @MainActor
    final class Coordinator {
        var start: CGPoint = .zero
        var opened = false
        var onOpen: (Bool) -> Void = { _ in }
        private var pending: Task<Void, Never>?

        func scheduleOpen(after delay: TimeInterval) {
            pending?.cancel()
            pending = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(delay))
                guard !Task.isCancelled else { return }
                self?.openNow(held: true)
            }
        }

        func openNow(held: Bool) {
            pending?.cancel()
            pending = nil
            guard !opened else { return }
            opened = true
            onOpen(held)
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
        case .belowLeading, .aboveLeading: anchor.minX
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
        case .aboveLeading: .bottomLeading
        case .aboveCenter:
            UnitPoint(x: ((request.tailX ?? request.anchor.midX) - panelMinX) / Self.width, y: 1)
        }
        let exit = AnyTransition.opacity.combined(with: .scale(scale: 0.96, anchor: anchor))
            .animation(.easeOut(duration: 0.14))
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .scale(scale: 0.94, anchor: anchor).combined(with: .opacity),
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
            case .aboveTrailing, .aboveLeading, .aboveCenter:
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var highlightSpace
    @GestureState private var touching = false

    private let radius: CGFloat = 22
    private let tail: CGFloat = 9

    private var hasTail: Bool { request.showsTail && request.tailX != nil && request.placement == .aboveCenter }
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
        .onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .global)
        } action: { frame in
            // Only the resting frame: once the panel leans, its measured frame moves with it,
            // and leaning from that would feed back on itself.
            if menu?.finger == nil { menu?.panelFrame = frame }
        }
        // While the finger is down, the panel leans toward it and stretches a touch along that
        // axis, on a loose spring, so it feels like something held rather than drawn.
        .modifier(Lean(isEnabled: !reduceMotion))
        // The highlight glides from row to row instead of jumping.
        .animation(.spring(duration: 0.24, bounce: 0.22), value: menu?.highlighted)
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .updating($touching) { _, state, _ in state = true }
                .onChanged { value in menu?.track(value.location, fromTrigger: false) }
                .onEnded { _ in menu?.release(fromTrigger: false) }
        )
        .onChange(of: touching) { _, isTouching in
            // A touch on the panel that was taken away rather than lifted.
            if !isTouching { menu?.clearHighlight() }
        }
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
        // A floor, not a fixed height, so larger text sizes get taller rows.
        .padding(.vertical, 4)
        .frame(minHeight: prominent ? 46 : 44)
        .background {
            if prominent {
                Capsule()
                    .fill(Color.danger)
                    .brightness(highlighted ? -0.08 : 0)
                    .padding(.horizontal, 10)
            } else if highlighted {
                // Concentric with the panel: its radius less the inset.
                RoundedRectangle(cornerRadius: radius - 6, style: .continuous)
                    .fill(Color.ink.opacity(0.08))
                    .padding(.horizontal, 6)
                    .matchedGeometryEffect(id: "highlight", in: highlightSpace)
            }
        }
        .scaleEffect(prominent && highlighted ? 0.97 : 1)
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

/// The panel's give under the finger. Inside the panel it drifts a few points toward the
/// finger; past its edge it follows with rubber-band resistance and stretches up to 4% along
/// that axis, anchored on the far side. A loose spring (it trails and settles with a little
/// wobble) makes the motion read as weight. Lifting the finger springs it back.
private struct Lean: ViewModifier {
    var isEnabled: Bool

    /// Read here, not in the panel, so a moving finger re-renders only this modifier and not
    /// every row of the menu.
    @Environment(\.menuController) private var menu

    private var finger: CGPoint? { isEnabled ? menu?.finger : nil }
    private var frame: CGRect { menu?.panelFrame ?? .zero }

    func body(content: Content) -> some View {
        let lean = lean
        content
            .scaleEffect(x: lean.scale.width, y: lean.scale.height, anchor: lean.anchor)
            .offset(lean.offset)
            .animation(
                finger == nil ? .spring(duration: 0.45, bounce: 0.4) : .interactiveSpring(response: 0.28, dampingFraction: 0.6),
                value: finger
            )
    }

    private var lean: (offset: CGSize, scale: CGSize, anchor: UnitPoint) {
        guard let finger, frame.width > 0, frame.height > 0 else { return (.zero, CGSize(width: 1, height: 1), .center) }
        // How far past each edge the finger is (zero inside).
        let overX = finger.x < frame.minX ? finger.x - frame.minX : finger.x > frame.maxX ? finger.x - frame.maxX : 0
        let overY = finger.y < frame.minY ? finger.y - frame.minY : finger.y > frame.maxY ? finger.y - frame.maxY : 0
        // Inside: a gentle drift toward the finger from the center.
        let driftX = (finger.x - frame.midX) / frame.width * 4
        let driftY = (finger.y - frame.midY) / frame.height * 4
        let offset = CGSize(
            width: driftX + Motion.resist(overX, dimension: 160) * 0.22,
            height: driftY + Motion.resist(overY, dimension: 220) * 0.22
        )
        let stretchX = 1 + min(abs(overX) / 1500, 0.04)
        let stretchY = 1 + min(abs(overY) / 2000, 0.04)
        let anchor = UnitPoint(x: overX > 0 ? 0 : overX < 0 ? 1 : 0.5, y: overY > 0 ? 0 : overY < 0 ? 1 : 0.5)
        return (offset, CGSize(width: stretchX, height: stretchY), anchor)
    }
}

/// A rounded rectangle with an optional tail on its bottom edge, so a confirmation rising from
/// the focus pill points at the button that opened it. Drawn as one outline (the tail is part
/// of the bottom edge, not a second shape laid over it), so the glass has no seam.
struct BubbleShape: Shape {
    var radius: CGFloat
    var tail: CGFloat
    /// The tail's x within the shape.
    var tailX: CGFloat

    func path(in rect: CGRect) -> Path {
        let body = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height - tail)
        guard tail > 0 else {
            return Path(roundedRect: body, cornerRadius: radius, style: .continuous)
        }
        let r = min(radius, body.height / 2, body.width / 2)
        let x = (rect.minX + tailX).clamped(body.minX + r + tail * 1.6, body.maxX - r - tail * 1.6)
        let base = tail * 1.5
        var path = Path()
        path.move(to: CGPoint(x: body.minX + r, y: body.minY))
        path.addLine(to: CGPoint(x: body.maxX - r, y: body.minY))
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.minY), tangent2End: CGPoint(x: body.maxX, y: body.minY + r), radius: r)
        path.addLine(to: CGPoint(x: body.maxX, y: body.maxY - r))
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.maxX - r, y: body.maxY), radius: r)
        // The tail, folded into the bottom edge with soft shoulders and a rounded tip.
        path.addLine(to: CGPoint(x: x + base, y: body.maxY))
        path.addCurve(
            to: CGPoint(x: x + tail * 0.25, y: rect.maxY - 1),
            control1: CGPoint(x: x + base * 0.55, y: body.maxY),
            control2: CGPoint(x: x + tail * 0.5, y: rect.maxY - 2)
        )
        path.addQuadCurve(to: CGPoint(x: x - tail * 0.25, y: rect.maxY - 1), control: CGPoint(x: x, y: rect.maxY + 0.5))
        path.addCurve(
            to: CGPoint(x: x - base, y: body.maxY),
            control1: CGPoint(x: x - tail * 0.5, y: rect.maxY - 2),
            control2: CGPoint(x: x - base * 0.55, y: body.maxY)
        )
        path.addLine(to: CGPoint(x: body.minX + r, y: body.maxY))
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY - r), radius: r)
        path.addLine(to: CGPoint(x: body.minX, y: body.minY + r))
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.minY), tangent2End: CGPoint(x: body.minX + r, y: body.minY), radius: r)
        path.closeSubpath()
        return path
    }
}
