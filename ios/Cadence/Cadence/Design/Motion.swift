import SwiftUI

/// Motion vocabulary for the app. Springs everywhere something can be touched,
/// critically damped unless a gesture threw it (then a little bounce is earned).
enum Motion {
    /// Default UI change: no overshoot.
    static let standard = Animation.spring(response: 0.38, dampingFraction: 1)
    /// Snappy state change for small elements (pills, icons).
    static let snappy = Animation.spring(response: 0.28, dampingFraction: 1)
    /// Deck reshuffles: one card moving forward, another tucking behind.
    static let deck = Animation.spring(response: 0.42, dampingFraction: 0.88)
    /// Text and color settling after a check.
    static let settle = Animation.easeOut(duration: 0.22)
    /// Contextual icon swap: spring 0.3s, no bounce.
    static let icon = Animation.spring(duration: 0.3, bounce: 0)

    /// Release of a drag: hands the finger's velocity to the spring so there is no seam.
    /// `velocity` is in points per second along the axis; `distance` is what's left to travel.
    static func release(velocity: CGFloat, distance: CGFloat, duration: Double = 0.42, bounce: Double = 0) -> Animation {
        let relative = abs(distance) < 0.5 ? 0 : Double(velocity / distance)
        return .interpolatingSpring(duration: duration, bounce: bounce, initialVelocity: min(max(relative, -40), 40))
    }

    /// Where a flick would come to rest (Apple's projection, a snappy deceleration).
    static func project(_ velocity: CGFloat, decelerationRate: CGFloat = 0.99) -> CGFloat {
        (velocity / 1000) * decelerationRate / (1 - decelerationRate)
    }

    /// Progressive resistance past `limit`: the further you pull, the less it follows.
    static func rubberband(_ offset: CGFloat, limit: CGFloat, constant: CGFloat = 0.55) -> CGFloat {
        let magnitude = abs(offset)
        guard magnitude > limit else { return offset }
        let over = magnitude - limit
        let damped = (over * limit * constant) / (limit + constant * over)
        return (limit + damped) * (offset < 0 ? -1 : 1)
    }

    /// Resistance from the very first point (for directions that don't lead anywhere).
    static func resist(_ offset: CGFloat, dimension: CGFloat, constant: CGFloat = 0.55) -> CGFloat {
        let magnitude = abs(offset)
        let damped = (magnitude * dimension * constant) / (dimension + constant * magnitude)
        return damped * (offset < 0 ? -1 : 1)
    }
}

extension CGFloat {
    func clamped(_ lower: CGFloat, _ upper: CGFloat) -> CGFloat { Swift.min(Swift.max(self, lower), upper) }
}

extension Double {
    func clamped(_ range: ClosedRange<Double>) -> Double { Swift.min(Swift.max(self, range.lowerBound), range.upperBound) }
}

/// Subtle press feedback: 0.96 scale, 120ms ease-out in, spring back out.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(configuration.isPressed ? .easeOut(duration: 0.12) : Motion.snappy, value: configuration.isPressed)
    }
}

/// No visual of its own: for buttons whose label already reacts (interactive glass).
struct BareButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
    }
}
