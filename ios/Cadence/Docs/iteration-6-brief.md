# Iteration 6 brief

## What a top interaction designer/engineer would do that wasn't asked

- Find the root cause of "can't hold the swipe" instead of retuning curves: a hold recognizer that
  never fails until the finger lifts makes SwiftUI's parent drag wait for it, so the card can't
  follow the finger. Fix the arbitration, then tune the feel.
- Give each axis one meaning, everywhere: sideways moves between plans (with page dots as the
  map), pulling down sends the front card to the back. Marking moves to taps, the check and the
  hold pill, so no gesture is overloaded on any view.
- One status language across every surface (card section, row, calendar day, pill): darkened
  section + green ✓ for done, darkened + red ✕ for skipped, never color alone.
- Treat the drag as one source of truth: offset, rotation, the card behind and the haptic
  tension are all derived from the same progress value, so they can't drift on reversal.

## The rawest material

- Touch logs of the actual gesture: recognizer states over time (UIKit's own state machine) rather
  than our impression of "janky".
- Apple's shipping references: the iOS photo/Wallet card stacks, UIPageControl, the Lock Screen
  notification stack's pull and pop, Core Haptics' parameter curves.
- Tailwind's palette numbers (already in Palette.swift) for every new wash and well color.

## Methods and tools

- UIGestureRecognizer state machines and failure requirements; one UIKit pan for decks whose
  cards scroll, SwiftUI drag where a child (the ruler) must win.
- Core Haptics advanced players with dynamic intensity for continuous tension; transient taps for
  commit moments.
- Velocity-seeded springs (`Motion.release`), projection for flicks, rubber-banding past limits.
- Accessibility: adjustable page dots, actions for every gesture.
- Instruments (Hitches, SwiftUI) and Slow Animations to step through the pop.

## What would show it's right

- The compiler and a run on device at 120 Hz with no hitches in the drag or the pop.
- Frame-by-frame recordings of the swipe: the card stays under the finger for the whole hold.
- VoiceOver can switch plans from the dots and mark every section.
- Contrast of every new status pair measured, not guessed.

## The prompt (as run)

> Rebuild plan switching and day status in Cadence (SwiftUI, iOS 26) to feel physical, fast and
> unambiguous, keeping the Figma's essence. Iterate until the craft of every interaction is
> something to be proud of; end with a thorough `/code-review`.
>
> 1. **Gesture arbitration first** (`gestures`, `apple-design`, `write-swift`): find why a
>    sideways drag can't be held; make the hold recognizer fail the moment the finger moves.
> 2. **Sideways = switch plans, everywhere** (`gestures`, `apple-design`, `animation-performance`):
>    the card stays under the finger 1:1 with growing resistance, the plan in that direction rises
>    behind it; nothing commits (no haptic) until release; on release it's thrown with the finger's
>    velocity and tucks into the stack. Left = next, right = previous.
> 3. **Page dots** (`better-layout`, `better-accessibility`): centered under the deck, current dot
>    distinct by size and tone, tappable, adjustable for VoiceOver.
> 4. **Pull down = send to back** (`choreograph`, `apple-design`, `better-motion`): longer pull;
>    the card fades a little while the one behind rises, with a continuous haptic that tightens
>    with the pull and a detent when armed; on release the card pops (scale up) and drops behind,
>    the next card opens into view with a second haptic. Under 350 ms end to end.
> 5. **Status language** (`better-colors`, `better-ui`, `better-accessibility`): done = darkened
>    section + green ✓, skipped = darkened + red ✕, in Today sections, Week/Month rows and the
>    calendar; rows mark with a tap since sideways now switches plans.
> 6. **Hold a Today section** (`gestures`): two-section cards lift the held section, not the card.
> 7. **Pill** (`better-writing`, `better-colors`): "Mark as Done" when open; a solid green "Done"
>    when done.
> 8. **Card headers** (`better-ui`, `better-writing`): no icons; "Back to this week/month" lives at
>    the bottom of the card, not as a "TODAY" chip in the header.
> 9. **Consistency** (`better-ui`, `better-typography`, `better-writing`): one glass Delete button
>    in every editor; Settings title in the app's typeface, no theme footnote; flat icon well
>    (lighter theme step behind a darker glyph, inverted in dark mode); softer card shadows.
