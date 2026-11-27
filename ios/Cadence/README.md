# Cadence

A daily tracker for weekly plans: training, skincare, habits, and a number you log each day. Built from the "vibe" page of the Personal Portfolio Figma file, in SwiftUI for iOS 26 with Liquid Glass.

## Run it

1. Open `Cadence.xcodeproj` in Xcode 26 or later.
2. Select the **Cadence** target → Signing & Capabilities → pick your Team (the bundle id is `com.sujeff.cadence`; change it if it clashes).
3. Run on an iPhone. The simulator works, but haptics and the feel of the swipes only make sense on a device.

The project uses a synchronized folder, so any file added under `Cadence/` is picked up without editing the project.

## Using it

**Header**: "Today ⌄" switches between Today, Week and Month. The glass pill at the top right holds ⋯ (edit the front plan, all plans, switch to any plan, jump to today, Settings) and + (add a plan). Tap any of them, or press and hold: the button sinks as the press loads, then the menu opens with a round thunk, and you can slide onto a row and let go to choose it. While your finger is down the menu leans toward it and stretches a little past its edges, on a loose spring.

**Adding a plan**: + offers three kinds. A **schedule** is a week written like a sheet (training, skincare, habits). A **scale** logs one number a day (weight, sleep). A **streak** is one yes-or-no a day. Each opens straight into its editor, where you name it and choose its icon.

**Moving between plans** works the same in every view, and the dots under the cards show where you are. Tap a dot to jump there, or press and slide along the dots to page through every plan, a tick for each, with the dots swelling under your finger.
- **Sideways**: drag the card left for the next plan, right for the previous one. It stays under your finger as long as you hold it, getting heavier the further it goes, with that plan rising behind it. Let go past about a third of the way (or flick) and it's thrown into the stack with one solid tap; otherwise it springs back.
- **Pull down**: a longer pull. The card fades, darkens and softens as the one behind rises, with an even tick, tick, tick as it loads and a click once it's far enough. Let go and the card pops up out of the stack and sinks to the back, out of focus, as the next one opens. Push up to bring the previous plan back.
- On Week and Month the card scrolls first; once it's at its top (or bottom) the same pull moves the deck.

**Status** reads the same everywhere: a finished part of a card, a row or a calendar day settles a step darker, with a green ✓ when done or a red ✕ when skipped.

**Today** is a deck, one card per plan. Tap the check to mark the day done ("da-ding"); on AM/PM plans it checks off the next half, and each half can be tapped on its own. Scales show a ruler: scrub it, then tap the check to log. Streaks show the current run and the last two weeks.

**Holding things.** Hold a card (on Today, anywhere on it; on Week and Month, its top strip) and it lifts while everything around it blurs. On a two-part Today card, the part you hold lifts on its own. A pill rises near the bottom: **Mark as Done** (a solid green **Done** once it is; tap it again to undo), Delete in red (confirmed in a bubble pointing at it), and ⋯ for the rest (skip, edit, duplicate). Hold a row in Week or Month to lift just that day.

**Week / Month**: each card keeps its header (name, period, weekday names) fixed and scrolls its days inside. Tap a day to check it off (with AM/PM, tap each column). Move to another week or month with the arrows; **Back to this week** appears at the bottom of the card when you've moved away. Month shows each day's state in the calendar; tap a day for the rest of its week.

**Settings** (from ⋯) is a full page: the theme (five Tailwind neutrals: Mauve, the design's own, plus Taupe, Olive, Mist and Zinc), sounds and haptics.

**Plans**: editing a plan opens just that plan; ✓ closes it, and **All plans** leads to the list. In the list, tap a plan to open it, swipe right to mark today done, left to delete, or Edit to reorder.

**Editing**: each plan is a sheet-style grid, one row per day and one column per slot. A week you haven't written repeats the most recent one before it, so a training block carries forward until you change it, and writing a new week never rewrites history. Use **Copy last week**, **Repeat previous**, **Clear week**, and **Same every day** (in the keyboard bar) for habits.

## How it's put together

```
Cadence/
  App/          entry point
  Design/       color + type tokens from Figma, motion, Liquid Glass buttons
  Model/        Day, Plan (weekly sheets, overrides, marks), Store (JSON persistence), seed data
  Feedback/     Core Haptics patterns, preloaded sounds, one Feedback.play(...) per moment
  Views/        Today deck, Week/Month, editors, menus, shared components
  Resources/    Plus Jakarta Sans + Geist Mono (OFL), synthesized sounds
Tools/          Python scripts that generate the sounds and the app icon, a sketched asterisk on a
                painted landscape (numpy, scipy, pillow)
```

- **Design tokens** come from the Figma file, which was drawn in Tailwind's Mauve (surface 50, hairline 200, ink 700, labels 500). The canvas sits one step darker (200) for contrast, and every neutral follows the chosen theme (`Design/Palette.swift`). Cards are 20pt with the three-layer shadow, Plus Jakarta Sans SemiBold for content and Geist Mono Medium for labels. Dark mode counterparts are defined alongside.
- **Motion** follows the skills in `.claude/skills` (`apple-design`, `gestures`, `make-interfaces-feel-better`, and the rest): cards track the finger 1:1, release into springs seeded with the finger's velocity, rubber-band at edges, commit on distance *or* a flick, and stay critically damped unless a gesture threw them. Icon swaps use scale 0.25 → 1, opacity, and a 4px blur on a 0.3s spring with no bounce. Reduce Motion swaps slides and the ink ripple for fades.
- **Sound and haptics** fire on the same frame as the state change they belong to. Sounds use the ambient audio session, so they follow the silent switch and mix with music. To retune them, edit `Tools/gen_sounds.py` and run `python3 Tools/gen_sounds.py Cadence/Resources/Sounds` (needs numpy).
- **Data** is one JSON file in Application Support. An unreadable file is set aside, never overwritten.

## Skills

The design-engineering skills used for the polish pass live in `.claude/skills/` (from [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) and [emilkowalski/skills](https://github.com/emilkowalski/skills), both MIT). Claude Code picks them up when working on files in this folder.
