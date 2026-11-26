import SwiftUI

/// "‹  NOV 23 – 29  ›" under a card's header strip. Getting back to the current period is
/// `BackToToday`, at the bottom of the card, so nothing in the header reads as a date.
struct PeriodBar: View {
    @Environment(\.focusedKey) private var focusedKey

    let title: String
    /// "week" or "month", for the step buttons' names.
    var unit = "week"
    var onStep: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton("chevron.backward", label: "Previous \(unit)", delta: -1)
            Spacer(minLength: 0)
            Text(title)
                .font(.cadenceLabel)
                .foregroundStyle(Color.ink)
                .contentTransition(.numericText())
                .lineLimit(1)
            Spacer(minLength: 0)
            stepButton("chevron.forward", label: "Next \(unit)", delta: 1)
        }
        .padding(.horizontal, 8)
        .frame(height: 44)
        .overlay(alignment: .bottom) { Hairline() }
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

/// "Back to this week": a small glass capsule floating at the bottom of a Week or Month card
/// once you've moved away from the current period. It rises in from the bottom edge and
/// leaves the same way.
struct BackToToday: View {
    let title: String
    var action: () -> Void

    @Environment(\.focusedKey) private var focusedKey

    var body: some View {
        Button {
            guard focusedKey == nil else { return }
            action()
        } label: {
            Label(title, systemImage: "arrow.uturn.backward")
                .font(.cadenceCallout)
                .foregroundStyle(Color.ink)
                .padding(.horizontal, 16)
                .frame(height: 40)
                .glassEffect(.regular.interactive(), in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(PressableStyle())
    }

    static func transition(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .offset(y: 16).combined(with: .opacity).combined(with: .scale(scale: 0.96, anchor: .bottom))
    }
}
