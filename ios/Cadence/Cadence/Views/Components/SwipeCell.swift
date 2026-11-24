import SwiftUI
import UIKit

/// A horizontal pan that only begins when the finger is clearly moving sideways, so rows
/// inside a vertical ScrollView keep scrolling normally. SwiftUI's DragGesture would claim
/// vertical drags too and freeze the scroll view.
struct HorizontalPan: UIGestureRecognizerRepresentable {
    enum Phase {
        case changed(translation: CGFloat)
        case ended(translation: CGFloat, velocity: CGFloat)
        case cancelled
    }

    var isEnabled = true
    var onPhase: (Phase) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        recognizer.isEnabled = isEnabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let translation = recognizer.translation(in: recognizer.view).x
        switch recognizer.state {
        case .began, .changed:
            onPhase(.changed(translation: translation))
        case .ended:
            onPhase(.ended(translation: translation, velocity: recognizer.velocity(in: recognizer.view).x))
        case .cancelled, .failed:
            onPhase(.cancelled)
        default:
            break
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y) * 1.2
        }

        /// Let a scroll view's pan wait for ours to fail, so a sideways swipe never scrolls.
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            otherGestureRecognizer.view is UIScrollView && otherGestureRecognizer is UIPanGestureRecognizer
        }
    }
}

/// A row (or one column of a row) you swipe to mark: right for done, left for "not today".
///
/// The content tracks the finger 1:1 with rubber-banding past the commit point. Behind it,
/// the action icon grows with the drag and snaps solid when armed (with a detent). On release
/// the row springs home carrying the finger's velocity, and the mark lands on the same frame
/// as its sound.
struct SwipeCell<Content: View>: View {
    var isDone: Bool
    var isSkipped: Bool
    var isEnabled = true
    var onCommit: (SwipeDirection) -> Void
    @ViewBuilder var content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var offset: CGFloat = 0
    @State private var armed = false

    private let commitDistance: CGFloat = 84

    var body: some View {
        content
            .offset(x: offset)
            .background(alignment: .leading) {
                ActionGlyph(
                    systemName: isDone ? "arrow.uturn.backward" : "checkmark",
                    progress: max(0, offset) / commitDistance,
                    armed: armed && offset > 0
                )
                .padding(.leading, 18)
            }
            .background(alignment: .trailing) {
                ActionGlyph(
                    systemName: isSkipped ? "arrow.uturn.backward" : "xmark",
                    progress: max(0, -offset) / commitDistance,
                    armed: armed && offset < 0,
                    muted: true
                )
                .padding(.trailing, 18)
            }
            .background {
                Color.plum.opacity(0.05 * Double(min(abs(offset) / commitDistance, 1)))
            }
            .clipped()
            .contentShape(.rect)
            .gesture(HorizontalPan(isEnabled: isEnabled) { phase in
                handle(phase)
            })
            .accessibilityActions {
                if isEnabled {
                    Button(isDone ? "Mark not done" : "Mark done") { onCommit(.done) }
                    Button(isSkipped ? "Undo not today" : "Not today") { onCommit(.skip) }
                }
            }
    }

    private func handle(_ phase: HorizontalPan.Phase) {
        switch phase {
        case .changed(let translation):
            offset = Motion.rubberband(translation, limit: commitDistance * 1.15)
            let isArmed = abs(translation) >= commitDistance
            if isArmed != armed {
                armed = isArmed
                Feedback.play(isArmed ? .armed : .disarmed)
            }
        case .ended(let translation, let velocity):
            let flick = abs(velocity) > 700 && abs(translation) > 24 && (velocity > 0) == (translation > 0)
            let commit = abs(translation) >= commitDistance || flick
            if commit {
                onCommit(translation > 0 ? .done : .skip)
            }
            armed = false
            let animation = reduceMotion
                ? Motion.standard
                : Motion.release(velocity: velocity, distance: -offset, duration: 0.42, bounce: commit ? 0.2 : 0.1)
            withAnimation(animation) { offset = 0 }
        case .cancelled:
            armed = false
            withAnimation(Motion.standard) { offset = 0 }
        }
    }
}

enum SwipeDirection {
    case done
    case skip
}

/// The icon revealed behind a swiping row. Scales up with the drag; fills when armed.
private struct ActionGlyph: View {
    let systemName: String
    let progress: CGFloat
    let armed: Bool
    var muted = false

    var body: some View {
        let p = progress.clamped(0, 1)
        Image(systemName: systemName)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(armed ? Color.onPlum : Color.plum)
            .frame(width: 30, height: 30)
            .background {
                Circle()
                    .fill(armed ? (muted ? Color.inkMuted : Color.plum) : Color.clear)
                Circle()
                    .strokeBorder((muted ? Color.inkMuted : Color.plum).opacity(armed ? 0 : 0.5), lineWidth: 1.5)
            }
            .scaleEffect(0.6 + 0.4 * p + (armed ? 0.08 : 0))
            .opacity(Double(p))
            .animation(Motion.snappy, value: armed)
            .accessibilityHidden(true)
    }
}
