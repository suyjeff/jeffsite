# Cadence

A daily tracker for weekly plans: training, skincare, habits, and a number you log each day. Built from the "vibe" page of the Personal Portfolio Figma file, in SwiftUI for iOS 26 with Liquid Glass.

## Run it

1. Open `Cadence.xcodeproj` in Xcode 26 or later.
2. Select the **Cadence** target → Signing & Capabilities → pick your Team (the bundle id is `com.sujeff.cadence`; change it if it clashes).
3. Run on an iPhone. The simulator works, but haptics and the feel of the swipes only make sense on a device.

The project uses a synchronized folder, so any file added under `Cadence/` is picked up without editing the project.

## Using it

**Views** (tap the title, "Today ⌄"): Today, Week, Month, Scrolling.

**Today** is a deck, one card per plan.
- Swipe a card right to mark the day done, left for "not today". Past the commit point you feel a detent; let go and the card is thrown with your finger's speed and tucks in at the back.
- Pull a card down to bring the next one forward; push up to go back. The dots at the top also switch plans, and you can slide along them.
- The glass check button does the same as a right swipe. On AM/PM plans it checks off the next half, and each half can be tapped on its own.
- Long-press a card for Mark done, Not today, and Edit today.
- Number plans (Weight) show a ruler. Scrub it, then swipe right or tap the check to log.

**Week / Month / Scrolling**: swipe any row right for done, left for not today (on AM/PM plans, each column swipes separately). Long-press a row to edit just that day. Pull the page down to bring the next plan forward. Month shows each day's state in the calendar; tap a day to see the rest of its week below.

**Editing** (pencil button): opens the plan at the front of the deck as a sheet-style grid, one row per day and one column per slot. Each week can have its own plan. A week you haven't written repeats the most recent one before it, so a training block carries forward until you change it, and writing a new week never rewrites history. Use **Copy last week**, **Repeat previous**, **Clear week**, and **Same every day** (in the keyboard bar) for habits. Back in that sheet you can add, reorder, or delete plans and turn sounds or haptics off.

## How it's put together

```
Cadence/
  App/          entry point
  Design/       color + type tokens from Figma, motion, Liquid Glass buttons
  Model/        Day, Plan (weekly sheets, overrides, marks), Store (JSON persistence), seed data
  Feedback/     Core Haptics patterns, preloaded sounds, one Feedback.play(...) per moment
  Views/        Today deck, Week/Month/Scrolling, editors, shared components
  Resources/    Plus Jakarta Sans + Geist Mono (OFL), synthesized sounds
Tools/          Python scripts that generate the sounds and the app icon
```

- **Design tokens** come straight from the Figma file: canvas `#F3F1F3`, surface `#FAFAFA`, hairline `#E7E4E7`, ink `#463947`, labels `#79697B` / `#A89EA9` / `#D7D0D7`, 20pt cards with the three-layer shadow, Plus Jakarta Sans SemiBold for content and Geist Mono Medium for labels. Dark mode counterparts are defined alongside.
- **Motion** follows the skills in `.claude/skills` (`apple-design`, `gestures`, `make-interfaces-feel-better`, and the rest): cards track the finger 1:1, release into springs seeded with the finger's velocity, rubber-band at edges, commit on distance *or* a flick, and stay critically damped unless a gesture threw them. Icon swaps use scale 0.25 → 1, opacity, and a 4px blur on a 0.3s spring with no bounce. Reduce Motion swaps slides and the ink ripple for fades.
- **Sound and haptics** fire on the same frame as the state change they belong to. Sounds use the ambient audio session, so they follow the silent switch and mix with music. To retune them, edit `Tools/gen_sounds.py` and run `python3 Tools/gen_sounds.py Cadence/Resources/Sounds` (needs numpy).
- **Data** is one JSON file in Application Support. An unreadable file is set aside, never overwritten.

## Skills

The design-engineering skills used for the polish pass live in `.claude/skills/` (from [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) and [emilkowalski/skills](https://github.com/emilkowalski/skills), both MIT). Claude Code picks them up when working on files in this folder.
