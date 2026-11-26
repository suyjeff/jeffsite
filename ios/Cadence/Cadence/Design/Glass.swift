import SwiftUI

/// The check button in the corner of a Today card.
///
/// It is the visible half of the swipe: as a card is dragged toward "done", plum fills the
/// glass radially from the center and the check draws itself in, tracking the finger; toward
/// "not today" an ✕ draws in instead. Crossing the commit point pops it.
///
/// State changes play out as one small sequence, whichever way they were triggered:
/// - done: a squash (anticipation), an overshoot past full size (bounce), a ring rippling
///   outward, the check stroking on;
/// - cleared: the reverse: the check undraws and the fill drains back into the center;
/// - not today: the ✕ draws in two strokes and the button settles down a few points.
struct CheckButton: View {
    enum Look: Equatable {
        case open
        case done
        case skipped
    }

    var look: Look
    /// −1…1: how far a swipe has travelled toward skip (−) or done (+). 1 = armed.
    var swipe: CGFloat = 0
    /// Partially complete multi-column days show a ring segment.
    var fraction: CGFloat = 0
    var size: CGFloat = 48
    var voiceOverLabel: String
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var donePulse = 0
    @State private var clearPulse = 0
    @State private var skipPulse = 0

    private var towardDone: CGFloat { max(0, swipe).clamped(0, 1) }
    private var towardSkip: CGFloat { max(0, -swipe).clamped(0, 1) }
    private var armed: Bool { abs(swipe) >= 1 }

    // What each swipe will do on release, previewed as it travels:
    //   open:    right → done (fill + check draw in)   left → not today (✕ draws in)
    //   done:    right → undo (fill drains, check undraws)   left → not today (same, ✕ draws in)
    //   skipped: right → done (fill + check in, ✕ out)   left → undo (✕ undraws)

    /// 0…1: how much of the plum fill shows.
    private var fill: CGFloat {
        switch look {
        case .open: towardDone
        case .done: 1 - max(towardDone, towardSkip)
        case .skipped: towardDone
        }
    }

    /// 0…1: how much of the check is drawn.
    private var checkDrawn: CGFloat {
        switch look {
        case .open: towardDone
        case .done: 1 - max(towardDone, towardSkip)
        case .skipped: towardDone
        }
    }

    /// 0…1: how much of the ✕ is drawn.
    private var crossDrawn: CGFloat {
        switch look {
        case .open: towardSkip
        case .done: towardSkip
        case .skipped: 1 - max(towardDone, towardSkip)
        }
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                // Radial fill: grows from the center rather than fading, so it reads as
                // something filling up.
                Circle()
                    .fill(Color.plum)
                    .scaleEffect(max(fill, 0.001))
                    .opacity(fill > 0.001 ? 1 : 0)

                // AM / PM progress ring.
                Circle()
                    .trim(from: 0, to: look == .open ? fraction : 0)
                    .stroke(Color.onPlum.opacity(0.9), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(3)

                // Resting state: a quiet ghost of the check, so the button reads as one.
                CheckmarkShape()
                    .stroke(Color.onPlum.opacity(0.55), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                    .frame(width: 20, height: 20)
                    .opacity(look == .open && towardDone < 0.05 && towardSkip < 0.05 ? 1 : 0)

                // The live check: drawn by the swipe, or stroked on when the day completes.
                CheckmarkShape()
                    .trim(from: 0, to: checkDrawn)
                    .stroke(Color.onPlum, style: StrokeStyle(lineWidth: 2.8, lineCap: .round, lineJoin: .round))
                    .frame(width: 20, height: 20)

                // The ✕, drawn as two strokes one after the other.
                CrossShape()
                    .trim(from: 0, to: crossDrawn)
                    .stroke(Color.onPlum, style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
                    .frame(width: 15, height: 15)
            }
            .frame(width: size, height: size)
            // The fill may overshoot as it springs in; keep it inside the glass.
            .clipShape(.circle)
            .glassEffect(.regular.tint(Color.plum.opacity(look == .skipped ? 0.32 : 0.6)).interactive(), in: .circle)
            // Pops when a swipe crosses its commit point: the moment the detent fires.
            .scaleEffect(armed ? 1.14 : 1 + 0.06 * max(towardDone, towardSkip))
            .animation(reduceMotion ? nil : .spring(duration: 0.32, bounce: 0.5), value: armed)
            .modifier(CheckPulses(done: donePulse, clear: clearPulse, skip: skipPulse, enabled: !reduceMotion))
            .background {
                RippleRing(trigger: donePulse, enabled: !reduceMotion)
            }
            .frame(width: max(size, 44), height: max(size, 44))
            .contentShape(.circle)
        }
        .buttonStyle(SquashStyle())
        .onChange(of: look) { old, new in
            // Every path (tap, swipe, menu, another view) plays the same sequence.
            switch (old, new) {
            case (_, .done): donePulse += 1
            case (.done, _): clearPulse += 1
            case (_, .skipped): skipPulse += 1
            default: clearPulse += 1
            }
        }
        // Completing earns a bounce; clearing and skipping settle without one.
        .animation(
            reduceMotion ? .easeOut(duration: 0.15)
                : look == .done ? .spring(duration: 0.38, bounce: 0.35) : .spring(duration: 0.28, bounce: 0),
            value: look
        )
        .accessibilityLabel(voiceOverLabel)
        .accessibilityValue(look == .done ? "Done" : look == .skipped ? "Not today" : "Not done")
    }
}

/// The squash on touch-down: anticipation before the fill. 0.9 because the pop that
/// follows overshoots; a smaller press would make the overshoot read as a jump.
private struct SquashStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(configuration.isPressed ? .easeOut(duration: 0.1) : .spring(duration: 0.3, bounce: 0.4), value: configuration.isPressed)
    }
}

/// The three state-change sequences, as keyframes on scale and a small vertical settle.
private struct CheckPulses: ViewModifier {
    var done: Int
    var clear: Int
    var skip: Int
    var enabled: Bool

    func body(content: Content) -> some View {
        if enabled {
            content
                .keyframeAnimator(initialValue: PopValues(), trigger: done) { view, value in
                    view.scaleEffect(value.scale)
                } keyframes: { _ in
                    KeyframeTrack(\.scale) {
                        CubicKeyframe(0.86, duration: 0.07)                      // squash
                        SpringKeyframe(1.18, duration: 0.16, spring: .snappy)      // overshoot
                        SpringKeyframe(0.97, duration: 0.14, spring: .smooth)      // follow-through
                        SpringKeyframe(1.0, duration: 0.2, spring: .smooth)
                    }
                }
                .keyframeAnimator(initialValue: PopValues(), trigger: clear) { view, value in
                    view.scaleEffect(value.scale)
                } keyframes: { _ in
                    KeyframeTrack(\.scale) {
                        CubicKeyframe(0.9, duration: 0.08)
                        SpringKeyframe(1.0, duration: 0.24, spring: .smooth)
                    }
                }
                .keyframeAnimator(initialValue: PopValues(), trigger: skip) { view, value in
                    view.scaleEffect(value.scale).offset(y: value.drop)
                } keyframes: { _ in
                    KeyframeTrack(\.scale) {
                        CubicKeyframe(0.92, duration: 0.09)
                        SpringKeyframe(1.0, duration: 0.26, spring: .smooth)
                    }
                    KeyframeTrack(\.drop) {
                        CubicKeyframe(3, duration: 0.09)
                        SpringKeyframe(0, duration: 0.26, spring: .smooth)
                    }
                }
        } else {
            content
        }
    }
}

/// A plum ring that ripples out from the button when a day completes.
private struct RippleRing: View {
    var trigger: Int
    var enabled: Bool

    var body: some View {
        Circle()
            .stroke(Color.plum, lineWidth: 2)
            .keyframeAnimator(initialValue: RingValues(), trigger: trigger) { [enabled] view, value in
                view.scaleEffect(value.scale).opacity(enabled ? value.opacity : 0)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    LinearKeyframe(1, duration: 0.07)
                    CubicKeyframe(1.9, duration: 0.5)
                }
                KeyframeTrack(\.opacity) {
                    LinearKeyframe(0, duration: 0.07)
                    LinearKeyframe(0.55, duration: 0.03)
                    CubicKeyframe(0, duration: 0.47)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// An ✕ as one path: the first stroke, then the second, so `trim` draws them in order.
struct CrossShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        return path
    }
}

struct PopValues: Sendable {
    var scale: CGFloat = 1
    var drop: CGFloat = 0
}

struct RingValues: Sendable {
    var scale: CGFloat = 1
    var opacity: Double = 0
}
