// Frame-anchored tactical ontology. A tag stamps tactical reads onto a [t_in, t_out] window of one play's clip,
// measured in seconds from that play's sync anchor t₀ (the shot/turnover/whistle event), so it survives any
// change of pre-roll and maps onto any film source that knows where t₀ is.

export interface TagDim<V extends string = string> {
  key: "act" | "cov" | "co" | "cot" | "contest" | "read";
  field: string; // query field
  label: string;
  values: readonly V[];
  /** One-key mnemonics in chord mode, parallel to `values`; digits 1–9 also select by position. */
  keys: readonly string[];
  names: Record<V, string>;
}

export const ACTIONS = ["pnr", "pindown", "flare", "ghost", "spain_pnr", "dho", "stagger", "split_cut", "zipper", "hammer", "back_screen", "iso", "post", "transition"] as const;
export const COVERAGES = ["drop", "switch", "top_lock", "ice", "nail_help", "peel_switch", "hedge", "blitz", "at_level", "zone"] as const;
export const CLOSEOUT_COUNTS = ["0", "1", "2"] as const; // "2" means 2+
export const CLOSEOUT_TYPES = ["short", "flyby", "stunt"] as const;
export const CONTESTS = ["open", "light", "tight"] as const;
export const READS = ["good", "late", "wrong"] as const;

export type Action = (typeof ACTIONS)[number];
export type Coverage = (typeof COVERAGES)[number];

export const DIMS: readonly TagDim[] = [
  {
    key: "act",
    field: "action",
    label: "Action",
    values: ACTIONS,
    keys: ["b", "p", "f", "g", "s", "h", "t", "x", "z", "m", "k", "i", "o", "r"],
    names: {
      pnr: "Ball screen",
      pindown: "Pindown",
      flare: "Flare",
      ghost: "Ghost",
      spain_pnr: "Spain PnR",
      dho: "DHO",
      stagger: "Stagger",
      split_cut: "Split cut",
      zipper: "Zipper",
      hammer: "Hammer",
      back_screen: "Back screen",
      iso: "Iso",
      post: "Post up",
      transition: "Transition",
    },
  },
  {
    key: "cov",
    field: "cov",
    label: "Coverage",
    values: COVERAGES,
    keys: ["d", "s", "t", "i", "n", "p", "h", "b", "l", "z"],
    names: {
      drop: "Drop",
      switch: "Switch",
      top_lock: "Top lock",
      ice: "Ice",
      nail_help: "Nail help",
      peel_switch: "Peel switch",
      hedge: "Hedge",
      blitz: "Blitz",
      at_level: "At level",
      zone: "Zone",
    },
  },
  {
    key: "co",
    field: "closeouts",
    label: "Closeouts",
    values: CLOSEOUT_COUNTS,
    keys: ["0", "1", "2"],
    names: { "0": "0", "1": "1", "2": "2+" },
  },
  {
    key: "cot",
    field: "closeout",
    label: "Closeout",
    values: CLOSEOUT_TYPES,
    keys: ["s", "f", "t"],
    names: { short: "Short", flyby: "Flyby", stunt: "Stunt" },
  },
  {
    key: "contest",
    field: "contest",
    label: "Contest",
    values: CONTESTS,
    keys: ["o", "l", "t"],
    names: { open: "Open", light: "Light", tight: "Tight" },
  },
  {
    key: "read",
    field: "read",
    label: "Read",
    values: READS,
    keys: ["g", "l", "w"],
    names: { good: "Good", late: "Late", wrong: "Wrong" },
  },
];

export const DIM_BY_FIELD = new Map(DIMS.map((d) => [d.field, d]));

export interface Tag {
  id: string;
  game: string; // NBA game id
  action: number; // anchor play's actionNumber (its t₀)
  /** `${game}:${possession index within game}` — the possession the window belongs to. */
  possession: string;
  tIn: number; // seconds from t₀ (negative = before the event)
  tOut: number;
  act?: string;
  cov?: string;
  co?: string;
  cot?: string;
  contest?: string;
  read?: string;
  note?: string;
  author: string;
  source: "analyst" | "fixture";
  created: number;
}

export function tagSummary(t: Tag): string {
  const parts: string[] = [];
  if (t.act) parts.push(t.act);
  if (t.cov) parts.push(t.cov);
  if (t.co !== undefined) parts.push(`${t.co === "2" ? "2+" : t.co}co`);
  if (t.cot) parts.push(t.cot);
  if (t.contest) parts.push(t.contest);
  if (t.read) parts.push(`read:${t.read}`);
  return parts.join(" · ");
}
