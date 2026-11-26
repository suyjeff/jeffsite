# Iteration 5 brief

## What a top interaction designer/engineer would do that wasn't asked

- Build each pattern **once** as a system and reuse it everywhere: one press-menu component (touch-down haptic, quick hold opens, press-drag-release selection with a tick per row, release to choose) for the view title, ⋯, Create and the focus pill; one long-press primitive that never fights scrolling; one deck engine for switching plans in every view.
- Match **platform physics** rather than inventing timings: UIKit's context-menu hold (~0.3–0.5s), `UIMenu`'s press-drag-release, `UIScrollView`'s scroll-edge glass, iOS 26 Liquid Glass materialize transitions.
- Treat gesture arbitration as a first-class problem: decide, per surface, which recognizer wins and prove scroll is never blocked.
- Specify motion and haptics as a table (event → curve/duration → haptic → sound) and keep every surface on it.
- Use semantic color only where meaning is semantic: green for done, red for delete, plum for the brand's one primary action.

## The rawest material to start from

- The Figma source frames (`eTMW1O5Fndoq4w2qmZpyAH`, node `5381:5185`), not my earlier reinterpretations of them.
- Apple's own shipping behavior: `UIContextMenuInteraction` / `UIMenu` press-drag-release, Things 3's focus pill (the reference screenshots), the navigation bar's scroll-edge glass in iOS 26 apps.
- The HIG pages for Menus, Context menus, Liquid Glass materials, Sheets, and WWDC25 "Meet Liquid Glass" / "Build a SwiftUI app with the new design".
- Real-device behavior at 120 Hz, recorded and scrubbed frame by frame.

## Methods and tools

- `UIGestureRecognizerRepresentable` (UIKit long-press and pan recognizers with explicit delegates) for any gesture that must coexist with scrolling.
- `onScrollGeometryChange` / `onScrollPhaseChange`, pinned `LazyVStack` section headers, `safeAreaBar` + `scrollEdgeEffectStyle` for the glass header, `glassEffect` + `glassEffectTransition(.materialize)` for containerizing.
- Core Haptics / UIFeedbackGenerator for a press → open → move → choose haptic grammar.
- Instruments (Hitches, SwiftUI, Time Profiler), `Self._printChanges()`, Xcode's Slow Animations, Accessibility Inspector, VoiceOver and Dynamic Type passes, contrast measurement.

## What would show it's right (other than us)

- The compiler and a clean run on device.
- Instruments: no hitches while scrolling Week/Month, scrubbing the ruler, or opening menus on a ProMotion device.
- Frame-by-frame recordings next to the reference apps (Things 3 pill and menus, an iOS 26 nav bar containerizing on scroll).
- Accessibility Inspector audit and a full VoiceOver pass reaching every action without gestures.
- The user's hands: holds that feel immediate, menus that open under the thumb, no jitter.

## The prompt (as run)

See the top of the session reply; reproduced here for the record.

> Rework Cadence (SwiftUI, iOS 26) against the Figma source and Apple's shipping behavior, keeping the design's essence. Build shared systems, then apply them; iterate until every interaction is exceptional and you're proud of it.
>
> **A. One press-menu system** (`gestures`, `apple-design`, `better-motion`, `animate`): a Liquid Glass menu that grows from its trigger (origin-aware scale-in), opens on a quick hold or a tap, supports press-drag-release with a selection haptic per row, and gives a light haptic on touch-down. Use it for the "Today ⌄" view switcher, the ⋯ menu, a long-press/tap menu on the Create button listing what you can add (no full sheet), and inside the focus view.
>
> **B. Focus view** (`gestures`, `choreograph`, `better-ui`, `better-colors`): the pill stays put; its ⋯ spawns a menu panel stemming from the pill and delete spawns a confirmation panel with a tail pointing at the trash (Things-style). Fewer options in the pill: a green Done, a red Delete (or Clear for a day), and ⋯ holding Edit, Skip, Undo, Duplicate, and value actions. Lift the pill higher off the bottom edge.
>
> **C. Gestures that never fight scrolling** (`gestures`, `animation-performance`): replace SwiftUI long-presses with UIKit recognizers that recognize alongside the scroll view, so Week/Month scroll freely. Switch plans by swiping in every view: pull down / push up past the edges on Week and Month as on Today, plus tapping the peek.
>
> **D. Week and Month scroll with sticky card headers** (`better-layout`): the card's title strip, period bar and weekday header pin while rows and the calendar scroll. The app header floats over scrolling content with the scroll-edge blur; the view title materializes into a Liquid Glass capsule only while the page is scrolled, and dematerializes back at rest.
>
> **E. Today card** (`better-colors`, `better-ui`, `better-layout`): the check is neutral glass with an ink glyph (green only once done), the card extends down as in the Figma, and the check sits beside the floating Create button instead of stacked above it. Create is custom Liquid Glass with its glow on a separate layer (fixing the square background and jitter).
>
> **F. Copy and structure** (`better-writing`): "Not today" becomes "Skip" / "Skipped"; remove the weight footer hints; Sounds and Haptics move to a Settings page reachable from ⋯; remove the Scrolling view.
>
> **G. Plans** (`better-layout`, `better-writing`): editing a plan opens it alone, and ✓ closes it; a Plans list (reachable from ⋯ and from the editor) opens any plan, with swipe actions (Done today, Delete with confirmation) and Reorder instead of a Select mode.
>
> **H. Haptic grammar** (`apple-design`): every press-to-open control taps on touch-down, again on open, ticks while moving across items, and confirms on choose.
>
> Then run a deep `/code-review` and fix what it finds.
