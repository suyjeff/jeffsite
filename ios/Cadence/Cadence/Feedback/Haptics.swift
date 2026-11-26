import CoreHaptics
import UIKit

/// Haptics tuned per moment. Core Haptics for the shaped patterns (check, all done),
/// UIKit generators for the simple detents, which are already well tuned and cheap.
@MainActor
final class Haptics {
    static let shared = Haptics()

    private var engine: CHHapticEngine?
    private let supportsCoreHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    private let selection = UISelectionFeedbackGenerator()
    private let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private let soft = UIImpactFeedbackGenerator(style: .soft)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let notification = UINotificationFeedbackGenerator()

    private var lastSelection: CFTimeInterval = 0
    private var holdPlayer: (any CHHapticAdvancedPatternPlayer)?
    private var tensionPlayer: (any CHHapticAdvancedPatternPlayer)?

    private init() {
        makeEngine()
        prepare()
    }

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: Prefs.hapticsKey) }

    /// Warms the Taptic Engine so the first event of a gesture lands on time.
    func prepare() {
        selection.prepare()
        rigid.prepare()
        soft.prepare()
        light.prepare()
        medium.prepare()
    }

    // MARK: Simple detents

    /// Ruler steps and other high-frequency ticks. Throttled so a fast fling
    /// reads as texture instead of a buzz.
    func tick() {
        guard isEnabled else { return }
        let now = CACurrentMediaTime()
        guard now - lastSelection > 0.028 else { return }
        lastSelection = now
        selection.selectionChanged()
        selection.prepare()
    }

    /// Crossing a swipe's commit point.
    func detent(intensity: CGFloat = 0.85) {
        guard isEnabled else { return }
        rigid.impactOccurred(intensity: intensity)
        rigid.prepare()
    }

    /// A held card or row lifting into focus: one crisp, solid tap on the frame it pops.
    func lift() {
        guard isEnabled else { return }
        medium.impactOccurred(intensity: 0.9)
        medium.prepare()
    }

    /// Touch-down on anything that opens a menu: small and crisp, before anything moves.
    func press() {
        guard isEnabled else { return }
        rigid.impactOccurred(intensity: 0.45)
        rigid.prepare()
    }

    /// While a press is held toward opening a menu: a faint hum that tightens as the hold
    /// goes on, like a spring being loaded. Stopped by `endHoldBuild()` or by the release.
    func holdBuild(duration: TimeInterval) {
        endHoldBuild()
        guard isEnabled, let engine else { return }
        let event = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.5),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.25),
            ],
            relativeTime: 0,
            duration: duration
        )
        let ramp = CHHapticParameterCurve(
            parameterID: .hapticIntensityControl,
            controlPoints: [
                .init(relativeTime: 0, value: 0.05),
                .init(relativeTime: duration * 0.6, value: 0.22),
                .init(relativeTime: duration, value: 0.5),
            ],
            relativeTime: 0
        )
        do {
            try engine.start()
            let pattern = try CHHapticPattern(events: [event], parameterCurves: [ramp])
            let player = try engine.makeAdvancedPlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            holdPlayer = player
        } catch {
            holdPlayer = nil
        }
    }

    func endHoldBuild() {
        try? holdPlayer?.stop(atTime: CHHapticTimeImmediate)
        holdPlayer = nil
    }

    /// A drag loading up toward a commit (pulling a card down): a low hum whose strength
    /// follows `progress` 0…1, set every frame by `setTension`. Silent until the first update.
    func beginTension() {
        endTension()
        guard isEnabled, let engine else { return }
        let event = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.6),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.18),
            ],
            relativeTime: 0,
            duration: 30
        )
        do {
            try engine.start()
            let player = try engine.makeAdvancedPlayer(with: CHHapticPattern(events: [event], parameters: []))
            try player.sendParameters([CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: 0, relativeTime: 0)], atTime: CHHapticTimeImmediate)
            try player.start(atTime: CHHapticTimeImmediate)
            tensionPlayer = player
        } catch {
            tensionPlayer = nil
        }
    }

    /// 0…1. Eased in, so the first stretch of a pull is barely felt and the last is firm.
    func setTension(_ progress: Double) {
        guard let tensionPlayer else { return }
        let p = min(max(progress, 0), 1)
        let value = Float(0.04 + 0.6 * p * p)
        try? tensionPlayer.sendParameters(
            [CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: value, relativeTime: 0)],
            atTime: CHHapticTimeImmediate
        )
    }

    func endTension() {
        try? tensionPlayer?.stop(atTime: CHHapticTimeImmediate)
        tensionPlayer = nil
    }

    /// A card popping out of the stack and the next one opening: a crisp lift, then the
    /// weight of the new card landing.
    func pop() {
        endTension()
        play([
            transient(at: 0, intensity: 0.75, sharpness: 0.7),
            transient(at: 0.07, intensity: 0.9, sharpness: 0.3),
            continuous(at: 0.075, duration: 0.06, intensity: 0.3, sharpness: 0.15),
        ], fallback: { self.medium.impactOccurred(intensity: 0.9) })
    }

    /// A card thrown sideways landing in the stack.
    func toss() {
        play([
            transient(at: 0, intensity: 0.7, sharpness: 0.35),
            continuous(at: 0.005, duration: 0.05, intensity: 0.25, sharpness: 0.15),
        ], fallback: { self.soft.impactOccurred(intensity: 0.8) })
    }

    /// A menu opening under the finger: the hold lets go in one solid, round thunk.
    func menuOpen() {
        endHoldBuild()
        play([
            transient(at: 0, intensity: 1.0, sharpness: 0.5),
            continuous(at: 0.005, duration: 0.05, intensity: 0.35, sharpness: 0.2),
        ], fallback: { self.medium.impactOccurred(intensity: 1) })
    }

    /// Moving onto another row of an open menu. Not throttled like `tick`: rows are tall
    /// enough that every change is deliberate.
    func menuSelection() {
        guard isEnabled else { return }
        selection.selectionChanged()
        selection.prepare()
    }

    /// Choosing a menu row.
    func menuChoose() {
        guard isEnabled else { return }
        light.impactOccurred(intensity: 0.75)
        light.prepare()
    }

    /// Backing out of a commit point: lighter than arming it.
    func release() {
        guard isEnabled else { return }
        light.impactOccurred(intensity: 0.45)
        light.prepare()
    }

    func thud(intensity: CGFloat = 0.7) {
        guard isEnabled else { return }
        soft.impactOccurred(intensity: intensity)
        soft.prepare()
    }

    // MARK: Shaped patterns

    /// "Da-ding", felt: a lighter tap, then the main hit 85 ms later on the second note,
    /// with a short ring under it. Lands on the same beats as check.wav.
    /// `rate` is the sound's playback rate: a pitched-up check plays faster, so its second
    /// strike comes sooner and the second tap moves with it.
    func check(rate: Double = 1) {
        let beat = 0.085 / max(rate, 0.5)
        play([
            transient(at: 0, intensity: 0.6, sharpness: 0.5),
            transient(at: beat, intensity: 1.0, sharpness: 0.8),
            continuous(at: beat + 0.005, duration: 0.11, intensity: 0.28, sharpness: 0.35),
        ], fallback: { self.rigid.impactOccurred(intensity: 1) })
    }

    /// "Ding-da", the reverse: stronger first, softer and duller second, no ring.
    func uncheck() {
        play([
            transient(at: 0, intensity: 0.7, sharpness: 0.6),
            transient(at: 0.075, intensity: 0.38, sharpness: 0.25),
        ], fallback: { self.light.impactOccurred(intensity: 0.6) })
    }

    /// Skip: two soft, dull thuds falling away. Never sharp, so it never reads as an error.
    func skip() {
        play([
            transient(at: 0, intensity: 0.62, sharpness: 0.12),
            transient(at: 0.09, intensity: 0.42, sharpness: 0.05),
            continuous(at: 0.09, duration: 0.07, intensity: 0.18, sharpness: 0.02),
        ], fallback: { self.soft.impactOccurred(intensity: 0.8) })
    }

    /// Three rising taps and a swell: reserved for finishing everything today.
    func celebrate() {
        play([
            transient(at: 0.0, intensity: 0.55, sharpness: 0.4),
            transient(at: 0.075, intensity: 0.7, sharpness: 0.5),
            transient(at: 0.15, intensity: 0.85, sharpness: 0.6),
            transient(at: 0.225, intensity: 1.0, sharpness: 0.7),
            continuous(at: 0.24, duration: 0.35, intensity: 0.35, sharpness: 0.2),
        ], fallback: { self.notification.notificationOccurred(.success) })
    }

    // MARK: Engine

    private func makeEngine() {
        guard supportsCoreHaptics else { return }
        do {
            let engine = try CHHapticEngine()
            engine.playsHapticsOnly = true
            engine.isAutoShutdownEnabled = true
            engine.resetHandler = { [weak engine] in
                try? engine?.start()
            }
            try engine.start()
            self.engine = engine
        } catch {
            engine = nil
        }
    }

    private func play(_ events: [CHHapticEvent], fallback: () -> Void) {
        guard isEnabled else { return }
        guard let engine else {
            fallback()
            return
        }
        do {
            try engine.start()
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            fallback()
        }
    }

    private func transient(at time: TimeInterval, intensity: Float, sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time
        )
    }

    private func continuous(at time: TimeInterval, duration: TimeInterval, intensity: Float, sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time,
            duration: duration
        )
    }
}
