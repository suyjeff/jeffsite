// Keyboard modes as an XState machine. Every key goes through here, so a key always means one thing per mode:
//
//   browse ──/──▶ query ──Esc/Enter──▶ browse
//   browse ──⌘K─▶ palette ──Esc/run──▶ browse
//   browse ──?──▶ help
//   browse ──T──▶ chord.act ─▶ chord.cov ─▶ chord.co ─▶ chord.cot ─▶ chord.contest ─▶ chord.read ─▶ commit
//
// In a chord step a mnemonic letter or a digit 1–9 picks a value and advances; Space or "-" skips the dimension;
// Backspace steps back; Enter commits whatever is drafted; Esc abandons. `T p d 2 ⏎` stamps
// pindown · drop · 2+ closeouts on the marked [in, out] window without leaving the home row.

import { assign, setup } from "xstate";
import { DIMS, type Tag } from "../tags/ontology";

export type Draft = Partial<Pick<Tag, "act" | "cov" | "co" | "cot" | "contest" | "read">>;

export type KeyEvent =
  | { type: "QUERY" }
  | { type: "PALETTE" }
  | { type: "HELP" }
  | { type: "CHORD" }
  | { type: "CLOSE" }
  | { type: "PICK"; value: string }
  | { type: "SKIP" }
  | { type: "BACK" }
  | { type: "COMMIT" };

const STEPS = DIMS.map((d) => d.key);
type Step = (typeof STEPS)[number];

export interface KeyContext {
  draft: Draft;
  committed: Draft | null;
}

function chordStates() {
  const states: Record<string, object> = {};
  STEPS.forEach((step, i) => {
    const next = STEPS[i + 1];
    const prev = STEPS[i - 1];
    states[step] = {
      on: {
        PICK: { target: next ?? "#keys.browse", actions: next ? [{ type: "pick", params: { step } }] : [{ type: "pick", params: { step } }, "commit"] },
        SKIP: next ? { target: next } : { target: "#keys.browse", actions: "commit" },
        BACK: prev ? { target: prev, actions: { type: "unpick", params: { step: prev } } } : { target: "#keys.browse" },
      },
    };
  });
  return states;
}

export const keyMachine = setup({
  types: {
    context: {} as KeyContext,
    events: {} as KeyEvent,
  },
  actions: {
    reset: assign({ draft: () => ({}) }),
    pick: assign({
      draft: ({ context, event }, params: { step: string }) => (event.type === "PICK" ? { ...context.draft, [params.step]: event.value } : context.draft),
    }),
    unpick: assign({
      draft: ({ context }, params: { step: string }) => {
        const d = { ...context.draft } as Record<string, string>;
        delete d[params.step];
        return d as Draft;
      },
    }),
    commit: assign({ committed: ({ context }) => ({ ...context.draft }) }),
  },
}).createMachine({
  id: "keys",
  initial: "browse",
  context: { draft: {}, committed: null },
  states: {
    browse: {
      on: {
        QUERY: "query",
        PALETTE: "palette",
        HELP: "help",
        CHORD: { target: "chord", actions: ["reset", assign({ committed: () => null })] },
      },
    },
    query: { on: { CLOSE: "browse", PALETTE: "palette" } },
    palette: { on: { CLOSE: "browse", QUERY: "query" } },
    help: { on: { CLOSE: "browse", HELP: "browse" } },
    chord: {
      initial: STEPS[0],
      states: chordStates(),
      on: {
        CLOSE: { target: "browse", actions: "reset" },
        COMMIT: { target: "browse", actions: "commit" },
      },
    },
  },
});

/** Which step a chord-state value names, e.g. { chord: "cov" } → "cov". */
export function chordStep(value: unknown): Step | null {
  if (value && typeof value === "object" && "chord" in (value as Record<string, unknown>)) return (value as { chord: Step }).chord;
  return null;
}

/** Resolve a key to a value for the dimension at `step` (mnemonic or 1-based digit). */
export function valueForKey(step: Step, key: string): string | null {
  const dim = DIMS.find((d) => d.key === step)!;
  if (dim.key === "co" && /^[0-2]$/.test(key)) return key;
  const k = key.toLowerCase();
  const byKey = dim.keys.indexOf(k);
  if (byKey >= 0 && !/^\d$/.test(k)) return dim.values[byKey];
  if (/^[1-9]$/.test(k) && Number(k) <= dim.values.length) return dim.values[Number(k) - 1];
  return null;
}

export const STEP_LIST = STEPS;
