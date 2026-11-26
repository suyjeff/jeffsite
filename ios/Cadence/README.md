# Cadence

A daily tracker for weekly plans: training, skincare, habits, and a number you log each day. Built from the "vibe" page of the Personal Portfolio Figma file, in SwiftUI for iOS 26 with Liquid Glass.

## Run it

1. Open `Cadence.xcodeproj` in Xcode 26 or later.
2. Select the **Cadence** target → Signing & Capabilities → pick your Team (the bundle id is `com.sujeff.cadence`; change it if it clashes).
3. Run on an iPhone. The simulator works, but haptics and the feel of the swipes only make sense on a device.

The project uses a synchronized folder, so any file added under `Cadence/` is picked up without editing the project.

## Using it

**Menus** open from the title ("Today ⌄"), from ⋯, and from Create. Tap to open one, or hold for a moment and slide onto a row: letting go there chooses it. Each press taps on touch-down, again as the menu opens, and ticks as you move across its rows.

**Views**: "Today ⌄" switches between Today, Week and Month, as in the design.

**Moving between plans** works the same in every view: pull down past the top to bring the next plan forward, push up past the bottom (or, on Today, push the card up) to go back, or tap the card peeking behind. ⋯ also lists every plan.

**Today** is a deck, one card per plan.
- Swipe a card right to mark the day done, left to skip it. The check fills green and draws itself as you drag; past the commit point it pops with a detent, and on release the card is thrown and tucks in at the back.
- The check does the same as a right swipe ("da-ding"). On AM/PM plans it checks off the next half; each half can also be tapped.
- Number plans (Weight) show a ruler. Scrub it, then swipe right or tap the check to log.

**Holding things.** Hold a card (on Today, anywhere on it; on Week and Month, its top strip) and the whole card lifts while everything around it blurs. A pill rises near the bottom: Done in green, Delete in red (confirmed in a panel that rises from the pill), and ⋯ for the rest (undo, skip, edit, duplicate), also in a panel from the pill. Hold a row in Week or Month to lift just that day.

**Create**: the plum + floating bottom right. Tap or hold it for a small menu of what you can add; choosing one makes the plan and opens it to write.

**Week / Month** scroll, with each card's header (name, period, weekday names) pinned while its rows pass beneath. The app header floats over the page; once you scroll, the title gathers into a glass capsule. Swipe a row right for done, left to skip (on AM/PM plans, each column swipes separately). Month shows each day's state in the calendar; tap a day for the rest of its week.

**⋯ menu** (top right): edit the front plan, all plans, switch to any plan, jump to today (Week and Month, when you've moved away), and Settings (sounds and haptics).

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
Tools/          Python scripts that generate the sounds and the app icon (numpy, scipy, pillow)
```

- **Design tokens** come straight from the Figma file: canvas `#F3F1F3`, surface `#FAFAFA`, hairline `#E7E4E7`, ink `#463947`, labels `#79697B` / `#A89EA9` / `#D7D0D7`, 20pt cards with the three-layer shadow, Plus Jakarta Sans SemiBold for content and Geist Mono Medium for labels. Dark mode counterparts are defined alongside.
- **Motion** follows the skills in `.claude/skills` (`apple-design`, `gestures`, `make-interfaces-feel-better`, and the rest): cards track the finger 1:1, release into springs seeded with the finger's velocity, rubber-band at edges, commit on distance *or* a flick, and stay critically damped unless a gesture threw them. Icon swaps use scale 0.25 → 1, opacity, and a 4px blur on a 0.3s spring with no bounce. Reduce Motion swaps slides and the ink ripple for fades.
- **Sound and haptics** fire on the same frame as the state change they belong to. Sounds use the ambient audio session, so they follow the silent switch and mix with music. To retune them, edit `Tools/gen_sounds.py` and run `python3 Tools/gen_sounds.py Cadence/Resources/Sounds` (needs numpy).
- **Data** is one JSON file in Application Support. An unreadable file is set aside, never overwritten.

## Skills

The design-engineering skills used for the polish pass live in `.claude/skills/` (from [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) and [emilkowalski/skills](https://github.com/emilkowalski/skills), both MIT). Claude Code picks them up when working on files in this folder.
