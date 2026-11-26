import SwiftUI

/// "‹  NOV 23 – 29  ›" under a card's header strip. Shows a "Today" chip when you've
/// wandered off the current period.
struct PeriodBar: View {
    @Environment(\.focusedKey) private var focusedKey

    let title: String
    /// "week" or "month", for the step buttons' names.
    var unit = "week"
    var isCurrent: Bool
    var onStep: (Int) -> Void
    var onReset: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton("chevron.backward", label: "Previous \(unit)", delta: -1)
            Spacer(minLength: 0)
            Text(title)
                .font(.cadenceLabel)
                .foregroundStyle(Color.ink)
                .contentTransition(.numericText())
                .lineLimit(1)
            if !isCurrent {
                Button {
                    guard focusedKey == nil else { return }
                    onReset()
                } label: {
                    Text("TODAY")
                        .font(.cadenceCaption)
                        .foregroundStyle(Color.plum)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.plum.opacity(0.1), in: Capsule())
                        .padding(.vertical, 10)
                        .contentShape(.rect)
                }
                .buttonStyle(PressableStyle())
                .padding(.leading, 8)
                .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
            Spacer(minLength: 0)
            stepButton("chevron.forward", label: "Next \(unit)", delta: 1)
        }
        .padding(.horizontal, 8)
        .frame(height: 44)
        .overlay(alignment: .bottom) { Hairline() }
        .animation(Motion.snappy, value: isCurrent)
    }

    private func stepButton(_ symbol: String, label: String, delta: Int) -> some View {
        Button {
            // The release that ends a hold on the header isn't a tap.
            guard focusedKey == nil else { return }
            Haptics.shared.tick()
            onStep(delta)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.inkSecondary)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}
