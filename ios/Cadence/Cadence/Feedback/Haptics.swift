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
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let notification = UINotificationFeedbackGenerator()

    private var lastSelection: CFTimeInterval = 0

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

    /// A crisp tap followed by a softer settle: "click… set".
    func check() {
        play([
            transient(at: 0, intensity: 1.0, sharpness: 0.65),
            transient(at: 0.075, intensity: 0.45, sharpness: 0.2),
        ], fallback: { self.rigid.impactOccurred(intensity: 1) })
    }

    func uncheck() {
        play([transient(at: 0, intensity: 0.5, sharpness: 0.35)],
             fallback: { self.light.impactOccurred(intensity: 0.6) })
    }

    func skip() {
        play([
            transient(at: 0, intensity: 0.6, sharpness: 0.1),
            continuous(at: 0, duration: 0.09, intensity: 0.25, sharpness: 0.05),
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
