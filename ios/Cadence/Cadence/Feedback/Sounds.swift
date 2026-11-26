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
    /// The ruler's tick fires dozens of times a second while scrubbing. It plays from a
    /// buffer scheduled on an audio-engine node: cheap, never blocking the main thread the
    /// way `AVAudioPlayer.play()` can, and at media volume like every other sound.
    private let engine = AVAudioEngine()
    private let tickNode = AVAudioPlayerNode()
    private var tickBuffer: AVAudioPCMBuffer?
    private var cursors: [Effect: Int] = [:]
    private var lastTick: CFTimeInterval = 0

    private init() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)

        if let url = Bundle.main.url(forResource: Effect.tick.rawValue, withExtension: "wav"),
           let file = try? AVAudioFile(forReading: url),
           let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
           (try? file.read(into: buffer)) != nil {
            tickBuffer = buffer
            engine.attach(tickNode)
            engine.connect(tickNode, to: engine.mainMixerNode, format: buffer.format)
            startTickEngine()
        }

        for effect in Effect.allCases where effect != .tick {
            guard let url = Bundle.main.url(forResource: effect.rawValue, withExtension: "wav") else { continue }
            let voices = 2
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
        guard isEnabled else { return }
        if effect == .tick {
            let now = CACurrentMediaTime()
            guard now - lastTick > 0.035, let tickBuffer else { return }
            lastTick = now
            if !engine.isRunning { startTickEngine() }
            tickNode.volume = volume
            tickNode.scheduleBuffer(tickBuffer, at: nil, options: .interrupts, completionHandler: nil)
            return
        }
        guard let pool = pools[effect], !pool.isEmpty else { return }
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

    /// (Re)starts the tick engine; the system stops it on interruptions and route changes.
    private func startTickEngine() {
        do {
            try engine.start()
            tickNode.play()
        } catch {
            // No ticks this time; the next tick tries again.
        }
    }
}
