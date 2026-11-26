import Foundation

/// One call per moment: the sound and the haptic always fire together, on the same frame
/// as the state change that caused them.
@MainActor
enum Feedback {
    enum Event {
        /// A ruler step.
        case tick
        /// A swipe crossed its commit point.
        case armed
        /// A swipe backed out of its commit point.
        case disarmed
        /// A day (or a column) checked off. `step` raises the pitch for AM → PM.
        case check(step: Int)
        case uncheck
        case skip
        /// A metric value saved.
        case log
        /// Cycled to another plan without marking anything.
        case cycle
        /// The front card popped out of the stack and went to the back (a pull).
        case pop
        /// The front card was thrown sideways to another plan.
        case toss
        /// Everything planned today is done.
        case allDone
    }

    static func play(_ event: Event) {
        let haptics = Haptics.shared
        let sounds = Sounds.shared
        switch event {
        case .tick:
            haptics.tick()
            sounds.play(.tick, volume: 0.55, pitch: Float.random(in: 0.96...1.04))
        case .armed:
            haptics.detent()
            sounds.play(.threshold, volume: 0.8)
        case .disarmed:
            haptics.release()
        case .check(let step):
            let rate = 1 + Float(min(step, 3)) * 0.12
            haptics.check(rate: Double(rate))
            sounds.play(.check, pitch: rate)
        case .uncheck:
            haptics.uncheck()
            sounds.play(.uncheck, volume: 0.8)
        case .skip:
            haptics.skip()
            sounds.play(.skip)
        case .log:
            haptics.check()
            sounds.play(.log)
        case .cycle:
            haptics.thud(intensity: 0.55)
            sounds.play(.card, volume: 0.9, pitch: Float.random(in: 0.97...1.03))
        case .pop:
            haptics.pop()
            sounds.play(.card, volume: 0.95, pitch: Float.random(in: 1.02...1.06))
        case .toss:
            haptics.toss()
            sounds.play(.card, volume: 0.85, pitch: Float.random(in: 0.96...1.0))
        case .allDone:
            haptics.celebrate()
            sounds.play(.complete)
        }
    }

    /// Maps a store change to its feedback.
    static func play(for change: Store.Change?, step: Int = 0) {
        guard let change else { return }
        switch change {
        case .completed, .progressed: play(.check(step: step))
        case .cleared: play(.uncheck)
        case .skipped: play(.skip)
        case .logged: play(.log)
        }
    }

    /// Touch the singletons early so audio buffers and the haptic engine are warm
    /// before the first gesture.
    static func warmUp() {
        _ = Sounds.shared
        Haptics.shared.prepare()
    }
}
