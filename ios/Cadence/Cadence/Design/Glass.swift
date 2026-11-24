import SwiftUI

/// The round, plum-tinted Liquid Glass button from the design (edit, check).
/// The glass itself is interactive, so it flexes and catches light under the finger;
/// the hit area is padded out to 44pt even when the glass is smaller.
struct GlassIconButton: View {
    let systemName: String
    var size: CGFloat = 40
    var iconSize: CGFloat = 17
    var tintColor: Color = .plum
    var voiceOverLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(Color.onPlum)
                .frame(width: size, height: size)
                .glassEffect(.regular.tint(tintColor).interactive(), in: .circle)
                .frame(width: max(size, 44), height: max(size, 44))
                .contentShape(.circle)
        }
        .buttonStyle(BareButtonStyle())
        .accessibilityLabel(voiceOverLabel)
    }
}

/// The check button that sits in the corner of a Today card. It previews a swipe
/// (fills and grows as the card is dragged toward "done", turns into an ✕ toward "skip"),
/// and draws its check on when the day is completed.
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

    @State private var pop = 0

    private var towardDone: CGFloat { max(0, swipe).clamped(0, 1) }
    private var towardSkip: CGFloat { max(0, -swipe).clamped(0, 1) }

    /// Which glyph to show, accounting for an in-progress swipe.
    private var glyph: Look {
        if towardSkip > 0.3 { return look == .skipped ? .open : .skipped }
        if towardDone > 0.3 { return look == .done ? .open : .done }
        return look
    }

    private var solidFill: Double {
        switch look {
        case .done: Double(1 - towardSkip)
        case .skipped: 0
        case .open: Double(towardDone)
        }
    }

    var body: some View {
        Button {
            pop += 1
            action()
        } label: {
            ZStack {
                Circle()
                    .fill(Color.plum)
                    .opacity(solidFill)

                // Progress ring for AM/PM style days.
                Circle()
                    .trim(from: 0, to: look == .open ? fraction : 0)
                    .stroke(Color.onPlum.opacity(0.9), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(3)

                // Open: a resting check outline.
                Image(systemName: "checkmark")
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(Color.onPlum)
                    .opacity(glyph == .open ? 1 : 0)
                    .scaleEffect(glyph == .open ? 1 : 0.25)
                    .blur(radius: glyph == .open ? 0 : 4)

                // Done: the check strokes itself on.
                CheckmarkShape()
                    .trim(from: 0, to: glyph == .done ? 1 : 0)
                    .stroke(Color.onPlum, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
                    .frame(width: 20, height: 20)
                    .animation(glyph == .done ? .easeOut(duration: 0.26).delay(0.04) : .easeOut(duration: 0.12), value: glyph)

                // Skipped: an ✕.
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.onPlum)
                    .opacity(glyph == .skipped ? 1 : 0)
                    .scaleEffect(glyph == .skipped ? 1 : 0.25)
                    .blur(radius: glyph == .skipped ? 0 : 4)
            }
            .animation(Motion.icon, value: glyph)
            .frame(width: size, height: size)
            .glassEffect(.regular.tint(Color.plum.opacity(look == .skipped ? 0.35 : 0.6)).interactive(), in: .circle)
            .scaleEffect(1 + 0.1 * max(towardDone, towardSkip))
            .keyframeAnimator(initialValue: PopValues(), trigger: pop) { content, value in
                content.scaleEffect(value.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    CubicKeyframe(0.9, duration: 0.08)
                    SpringKeyframe(1.04, duration: 0.16, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.28, spring: .smooth)
                }
            }
            .frame(width: max(size, 44), height: max(size, 44))
            .contentShape(.circle)
        }
        .buttonStyle(BareButtonStyle())
        .accessibilityLabel(voiceOverLabel)
        .accessibilityValue(look == .done ? "Done" : look == .skipped ? "Skipped" : "Not done")
    }
}

struct PopValues: Sendable {
    var scale: CGFloat = 1
}
