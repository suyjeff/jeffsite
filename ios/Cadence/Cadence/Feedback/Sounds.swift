import AVFoundation
import QuartzCore

enum Prefs {
    static let soundsKey = "soundsEnabled"
    static let hapticsKey = "hapticsEnabled"

    static func registerDefaults() {
        UserDefaults.standard.register(defaults: [soundsKey: true, hapticsKey: true])
    }
}

/// Short UI sounds, preloaded so they fire on the same frame as the visual change.
/// Uses the ambient category: respects the silent switch and mixes with music.
@MainActor
final class Sounds {
    static let shared = Sounds()

    enum Effect: String, CaseIterable {
        case tick, threshold, check, uncheck, skip, complete, card, log
    }

    private var pools: [Effect: [AVAudioPlayer]] = [:]
    private var cursors: [Effect: Int] = [:]
    private var lastTick: CFTimeInterval = 0

    private init() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)

        for effect in Effect.allCases {
            guard let url = Bundle.main.url(forResource: effect.rawValue, withExtension: "wav") else { continue }
            // Ticks overlap during a fast fling, so they get more voices.
            let voices = effect == .tick ? 5 : 2
            pools[effect] = (0..<voices).compactMap { _ in
                let player = try? AVAudioPlayer(contentsOf: url)
                player?.enableRate = true
                player?.prepareToPlay()
                return player
            }
        }
    }

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: Prefs.soundsKey) }

    /// - Parameters:
    ///   - volume: 0…1 on top of the file's own (already quiet) level.
    ///   - pitch: playback rate; 1 is the recorded pitch. Small variations keep repeats organic.
    func play(_ effect: Effect, volume: Float = 1, pitch: Float = 1) {
        guard isEnabled, let pool = pools[effect], !pool.isEmpty else { return }
        if effect == .tick {
            let now = CACurrentMediaTime()
            guard now - lastTick > 0.035 else { return }
            lastTick = now
        }
        let index = (cursors[effect] ?? 0) % pool.count
        cursors[effect] = index + 1
        let player = pool[index]
        // No stop(): it would undo prepareToPlay and add latency. Rewinding restarts a voice
        // that is still ringing.
        player.currentTime = 0
        player.volume = volume
        player.rate = pitch
        player.play()
    }
}
