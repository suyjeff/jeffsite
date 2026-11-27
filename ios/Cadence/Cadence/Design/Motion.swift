import SwiftUI

/// Motion vocabulary for the app. Springs everywhere something can be touched,
/// with no overshoot unless a gesture threw it (then a little bounce is earned).
///
/// Durations are perceptual: `spring(duration:)` sets how long the motion reads, so a
/// 0.28s spring is visually done in 0.28s instead of creeping through a long tail the way
/// a critically damped `response:` spring does.
enum Motion {
    /// Default UI change: no overshoot.
    static let standard = Animation.spring(duration: 0.3, bounce: 0)
    /// Small elements (pills, icons, selection capsules).
    static let snappy = Animation.spring(duration: 0.22, bounce: 0)
    /// Deck reshuffles: one card moving forward, another tucking behind.
    static let deck = Animation.spring(duration: 0.34, bounce: 0.08)
    /// Moving between views and periods (Today ↔ Week, this week ↔ next).
    static let page = Animation.spring(duration: 0.26, bounce: 0)
    /// Text and color settling after a check.
    static let settle = Animation.easeOut(duration: 0.2)
    /// Contextual icon swap: spring 0.3s, no bounce.
    static let icon = Animation.spring(duration: 0.3, bounce: 0)

    /// A completion mark popping in past full size. Reduce Motion gets a short fade instead.
    static func pop(reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.38, bounce: 0.4)
    }

    /// What arrives slides 20pt in from the side it's coming from and fades up; what leaves
    /// fades out in place, faster. Only transform and opacity animate (no blur on large
    /// views), so it stays on the compositor.
    static func slide(_ direction: Int, reduceMotion: Bool = false) -> AnyTransition {
        let exit = AnyTransition.opacity.animation(.easeOut(duration: 0.12))
        guard !reduceMotion else { return .asymmetric(insertion: .opacity, removal: exit) }
        let edge: CGFloat = direction >= 0 ? 20 : -20
        return .asymmetric(
            insertion: .offset(x: edge).combined(with: .opacity),
            removal: exit
        )
    }

    /// A card being drawn forward from the deck: it starts at the peeking position behind
    /// (narrower and 10pt higher) and comes to the front. The old card drops 12pt and fades.
    static func deckForward(reduceMotion: Bool = false) -> AnyTransition {
        let exit = AnyTransition.opacity.combined(with: .offset(y: 12)).animation(.easeOut(duration: 0.16))
        guard !reduceMotion else { return .asymmetric(insertion: .opacity, removal: .opacity) }
        return .asymmetric(
            insertion: .scale(scale: 1 - Metrics.deckScaleStep, anchor: .top)
                .combined(with: .offset(y: -Metrics.deckPeek))
                .combined(with: .opacity),
            removal: exit
        )
    }

    /// The previous card coming back, pushed up from below the page; the old one fades.
    static func deckBack(reduceMotion: Bool = false) -> AnyTransition {
        let exit = AnyTransition.opacity.animation(.easeOut(duration: 0.12))
        guard !reduceMotion else { return .asymmetric(insertion: .opacity, removal: .opacity) }
        return .asymmetric(
            insertion: .offset(y: 36).combined(with: .opacity),
            removal: exit
        )
    }

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
