import SwiftUI

/// The mark on anything finished: a green ✓ when done, a red ✕ when skipped, nothing while
/// open. Shape and color together, so the state never rests on color alone. Swaps like a
/// contextual icon: scale 0.25 → 1, opacity and a 4pt blur, with a little pop for done.
struct StatusBadge: View {
    let mark: Mark?
    var size: CGFloat = 22

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            glyph("checkmark.circle.fill", fill: .success, on: .onSuccess, visible: mark == .done)
            glyph("xmark.circle.fill", fill: .danger, on: .onDanger, visible: mark == .skipped)
        }
        .frame(width: size, height: size)
        .animation(mark == .done ? Motion.pop(reduceMotion: reduceMotion) : Motion.icon, value: mark)
        .accessibilityHidden(true)
    }

    private func glyph(_ name: String, fill: Color, on: Color, visible: Bool) -> some View {
        Image(systemName: name)
            .font(.system(size: size, weight: .semibold))
            .symbolRenderingMode(.palette)
            .foregroundStyle(on, fill)
            .opacity(visible ? 1 : 0)
            .scaleEffect(visible || reduceMotion ? 1 : 0.25)
            .blur(radius: visible || reduceMotion ? 0 : 4)
    }
}

extension Plan {
    /// Some of the day done and some skipped: neither Done nor Skip alone resets it.
    func isMixed(on day: Day) -> Bool {
        let marks = record(on: day).marks.values
        return marks.contains(.done) && marks.contains(.skipped)
    }

    /// How a part of a day reads: one column of a multi-column day, or the whole day.
    func mark(on day: Day, section column: Int?) -> Mark? {
        let status = status(on: day)
        if let column, columnCount > 1 {
            return mark(on: day, column: column) ?? (status == .skipped ? .skipped : nil)
        }
        switch status {
        case .done: return .done
        case .skipped: return .skipped
        default: return nil
        }
    }
}
