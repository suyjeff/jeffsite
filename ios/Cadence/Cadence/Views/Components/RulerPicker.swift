import SwiftUI

/// A horizontal ruler you scrub to set a number. It tracks the finger 1:1, keeps the
/// fling's momentum after release (UIScrollView's deceleration), then settles onto the
/// nearest step with a critically damped spring. Every step it crosses ticks: a haptic
/// detent and a very quiet click.
struct RulerPicker: View {
    @Binding var value: Double
    var step: Double
    var range: ClosedRange<Double>
    /// Points between two steps.
    var spacing: CGFloat = 9
    /// What the ruler sets, for VoiceOver ("Weight").
    var label = "Value"
    /// Called with true when the ruler starts moving (finger or momentum), false once it rests.
    var onScrubbing: (Bool) -> Void = { _ in }

    private enum Phase { case idle, dragging, coasting, settling }

    /// Continuous position, in steps from zero.
    @State private var position: Double = 0
    @State private var dragOrigin: Double?
    @State private var velocity: Double = 0
    @State private var phase: Phase = .idle
    @State private var lastFrame: Date?
    @State private var settleTarget: Double = 0
    @State private var lastIndex: Int = 0
    @State private var didSetUp = false

    private var lowerIndex: Double { (range.lowerBound / step).rounded() }
    private var upperIndex: Double { (range.upperBound / step).rounded() }

    var body: some View {
        TimelineView(.animation(paused: phase == .idle || phase == .dragging)) { timeline in
            Canvas { context, size in
                draw(in: &context, size: size)
            }
            .onChange(of: timeline.date) { _, now in
                advance(to: now)
            }
        }
        .frame(height: 66)
        .mask {
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: 0.2),
                    .init(color: .black, location: 0.8),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
        .overlay(alignment: .top) {
            // The reading line.
            Capsule()
                .fill(Color.plum)
                .frame(width: 3, height: 38)
                .offset(y: -2)
                .allowsHitTesting(false)
        }
        .contentShape(.rect)
        .gesture(scrub)
        .onChange(of: phase == .idle) { _, isIdle in
            onScrubbing(!isIdle)
        }
        .onAppear {
            guard !didSetUp else { return }
            didSetUp = true
            position = value / step
            lastIndex = Int(position.rounded())
        }
        .onChange(of: value) { _, newValue in
            // Follow outside changes (another day selected, value cleared) when at rest.
            guard phase == .idle else { return }
            let target = newValue / step
            if abs(target - position) > 0.5 {
                position = target
                lastIndex = Int(target.rounded())
            }
        }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(value.formatted(.number.precision(.fractionLength(0...3))))
        .accessibilityAdjustableAction { direction in
            let delta: Double = direction == .increment ? 1 : -1
            position = (position.rounded() + delta).clamped(lowerIndex...upperIndex)
            commitIndex()
        }
    }

    // MARK: Gesture

    private var scrub: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                if dragOrigin == nil {
                    // Catch it mid-flight: start from where it is right now.
                    dragOrigin = position
                    phase = .dragging
                    velocity = 0
                    Haptics.shared.prepare()
                }
                let raw = (dragOrigin ?? position) - Double(drag.translation.width / spacing)
                position = edgeResisted(raw)
                commitIndex()
            }
            .onEnded { drag in
                dragOrigin = nil
                lastFrame = nil
                velocity = -Double(drag.velocity.width / spacing)
                if position < lowerIndex || position > upperIndex || abs(velocity) < 4 {
                    beginSettling()
                } else {
                    phase = .coasting
                }
            }
    }

    /// Past either end the ruler resists instead of stopping dead.
    private func edgeResisted(_ raw: Double) -> Double {
        if raw < lowerIndex {
            return lowerIndex - Double(Motion.resist(CGFloat(lowerIndex - raw), dimension: 30))
        }
        if raw > upperIndex {
            return upperIndex + Double(Motion.resist(CGFloat(raw - upperIndex), dimension: 30))
        }
        return raw
    }

    // MARK: Physics

    private func beginSettling() {
        let nudge = velocity * 0.04
        settleTarget = (position + nudge).rounded().clamped(lowerIndex...upperIndex)
        phase = .settling
    }

    private func advance(to now: Date) {
        guard phase == .coasting || phase == .settling else { return }
        let dt = min(max(now.timeIntervalSince(lastFrame ?? now), 0), 1.0 / 30)
        lastFrame = now
        guard dt > 0 else { return }

        switch phase {
        case .coasting:
            // Between UIScrollView's normal (0.998) and fast (0.99) deceleration: a fling
            // still travels, but the ruler comes to rest quickly enough to read.
            velocity *= pow(0.995, dt * 1000)
            position += velocity * dt
            if position <= lowerIndex || position >= upperIndex {
                position = position.clamped(lowerIndex...upperIndex)
                velocity = 0
                beginSettling()
            } else if abs(velocity) < 10 {
                beginSettling()
            }
        case .settling:
            // Critically damped spring, response 0.2s: a quick, firm click into the step.
            let omega = 2 * Double.pi / 0.2
            let acceleration = -omega * omega * (position - settleTarget) - 2 * omega * velocity
            velocity += acceleration * dt
            position += velocity * dt
            if abs(position - settleTarget) < 0.002 && abs(velocity) < 0.05 {
                position = settleTarget
                velocity = 0
                phase = .idle
            }
        default:
            break
        }
        commitIndex()
    }

    /// Publishes the value and ticks whenever the reading line crosses a step.
    private func commitIndex() {
        let index = Int(position.rounded().clamped(lowerIndex...upperIndex))
        guard index != lastIndex else { return }
        lastIndex = index
        Feedback.play(.tick)
        let places = Double(stepDecimals)
        let factor = pow(10, places)
        value = (Double(index) * step * factor).rounded() / factor
    }

    private var stepDecimals: Int {
        var places = 0
        var scaled = step
        while places < 3 && abs(scaled.rounded() - scaled) > 0.000_1 {
            scaled *= 10
            places += 1
        }
        return places
    }

    // MARK: Drawing

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let center = size.width / 2
        let halfSpan = Double(size.width / 2 / spacing) + 2
        let first = Int((position - halfSpan).rounded(.down))
        let last = Int((position + halfSpan).rounded(.up))
        let majorEvery = 10
        let minorColor = Color.inkFaint
        let majorColor = Color.inkMuted
        let labelColor = Color.inkSecondary

        for index in first...last {
            guard Double(index) >= lowerIndex, Double(index) <= upperIndex else { continue }
            let x = center + CGFloat(Double(index) - position) * spacing
            let isMajor = index % majorEvery == 0
            let isMid = index % (majorEvery / 2) == 0
            let height: CGFloat = isMajor ? 26 : isMid ? 18 : 11
            let rect = CGRect(x: x - 0.75, y: 2, width: 1.5, height: height)
            context.fill(Path(roundedRect: rect, cornerRadius: 0.75), with: .color(isMajor ? majorColor : minorColor))

            if isMajor {
                let label = (Double(index) * step).formatted(.number.precision(.fractionLength(0)))
                context.draw(
                    Text(label).font(.cadenceMicro).foregroundStyle(labelColor),
                    at: CGPoint(x: x, y: 44),
                    anchor: .top
                )
            }
        }
    }
}
