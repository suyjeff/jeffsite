import SwiftUI

/// Settings, pushed as a full page from ⋯: the theme, and sound and haptics.
struct SettingsView: View {
    @AppStorage(Palette.storageKey) private var palette: Palette = .mauve
    @AppStorage(Prefs.soundsKey) private var soundsOn = true
    @AppStorage(Prefs.hapticsKey) private var hapticsOn = true

    var body: some View {
        List {
            Section {
                ForEach(Palette.allCases) { option in
                    Button {
                        choose(option)
                    } label: {
                        HStack(spacing: 14) {
                            Swatch(palette: option)
                            Text(option.title)
                                .font(.cadenceBodyMedium)
                                .foregroundStyle(Color.ink)
                            Spacer()
                            if option == palette {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color.ink)
                                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                            }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(RowPressStyle())
                    .accessibilityAddTraits(option == palette ? .isSelected : [])
                }
            } header: {
                // The page's title, in the app's own type, like every editor's.
                VStack(alignment: .leading, spacing: 24) {
                    Text("Settings")
                        .font(.cadenceNumber(28))
                        .tracking(-0.6)
                        .foregroundStyle(Color.ink)
                        .accessibilityAddTraits(.isHeader)
                    SheetSectionHeader(text: "Theme")
                }
                .textCase(nil)
            }
            .listRowBackground(Color.surface)

            Section {
                Toggle(isOn: $soundsOn) {
                    Label("Sounds", systemImage: "speaker.wave.2")
                }
                Toggle(isOn: $hapticsOn) {
                    Label("Haptics", systemImage: "hand.tap")
                }
            } header: {
                SheetSectionHeader(text: "Feedback")
            } footer: {
                Text("Sounds follow the silent switch.")
                    .font(.cadenceSubhead)
                    .foregroundStyle(Color.inkSecondary)
            }
            .font(.cadenceBodyMedium)
            .foregroundStyle(Color.ink)
            .tint(Color.success)
            .listRowBackground(Color.surface)
        }
        .scrollContentBackground(.hidden)
        // Rows resolve their colors when drawn; a new theme redraws them.
        .id(palette)
        .background(Color.canvas)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // Turning one on plays it, so you know what you've turned on.
        .onChange(of: soundsOn) { _, isOn in
            if isOn { Sounds.shared.play(.check) }
        }
        .onChange(of: hapticsOn) { _, isOn in
            if isOn { Haptics.shared.check() }
        }
    }

    private func choose(_ option: Palette) {
        guard option != palette else { return }
        Haptics.shared.menuChoose()
        Palette.current = option
        // A theme swaps at once: animating it would cross-fade every color on screen at once.
        palette = option
    }
}

/// A theme at a glance: the colors it changes, as a row of dots (page, card, label, text).
private struct Swatch: View {
    let palette: Palette
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let dark = colorScheme == .dark
        let tones: [Palette.Tone] = dark
            ? [.shade(950), .shade(900), .shade(400), .shade(100)]
            : [.shade(200), .shade(50), .secondary, .shade(700)]
        HStack(spacing: -5) {
            ForEach(Array(tones.enumerated()), id: \.offset) { _, tone in
                Circle()
                    .fill(Color(uiColor: UIColor(hex: palette.hex(tone))))
                    .frame(width: 18, height: 18)
                    .overlay(Circle().strokeBorder(Color.cardRing, lineWidth: 1))
                    // A hairline of the row behind, so overlapping dots stay distinct.
                    .background(Circle().stroke(Color.surface, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}
