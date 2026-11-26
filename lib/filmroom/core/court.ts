// Half-court geometry in the stats.nba.com shot-chart frame: tenths of a foot, rim centre at (0, 0), +y toward
// half court, the baseline at y = -47.5 and half court at y = 422.5. Negative x is the side NBA labels "Left".
//
// Zones are computed from (x, y) and rim polar coordinates (r, θ) — never from the feed's text labels. The NBA
// labels are used only as an independent check (see court.test.ts): the basic zone (RA / paint / mid / corner 3 /
// above-break 3 / backcourt) and the above-break side (C / LC / RC) must agree on every shot in the fixture.

export const RIM_R = 7.5;
export const RESTRICTED_R = 40; // 4 ft arc
export const THREE_R = 237.5; // 23.75 ft arc
export const CORNER_X = 220; // 22 ft corner line
export const CORNER_BREAK_Y = 87.5; // where the corner line meets the arc (NBA labels corner through y = 87)
export const PAINT_HALF_W = 80; // 16 ft lane
export const FT_LINE_Y = 142.5; // 19 ft from the baseline
export const FT_CIRCLE_R = 60;
export const BASELINE_Y = -47.5;
export const HALF_COURT_Y = 422.5;
/** NBA's labelling edges, measured on 218,701 2023-24 shots: paint through y = 138, backcourt from y = 420. */
export const PAINT_TOP_Y = 138.5;
export const BACKCOURT_Y = 419.5;
export const SIDE_X = 250;
/** Above-the-break side boundary: |θ| from the rim's forward axis. NBA's C vs LC/RC split sits at 18°. */
export const TOP_ANGLE_DEG = 18;

export const ZONES = [
  "restricted_area",
  "paint",
  "nail",
  "left_elbow",
  "right_elbow",
  "left_short_corner",
  "right_short_corner",
  "left_wing_mid",
  "right_wing_mid",
  "top_mid",
  "left_corner_3",
  "right_corner_3",
  "left_wing_3",
  "right_wing_3",
  "top_arc_3",
  "backcourt",
] as const;
export type Zone = (typeof ZONES)[number];
export const ZONE_ID: Record<Zone, number> = Object.fromEntries(ZONES.map((z, i) => [z, i])) as Record<Zone, number>;

/** NBA's SHOT_ZONE_BASIC vocabulary, derived from our fine zones. */
export type BasicZone =
  | "Restricted Area"
  | "In The Paint (Non-RA)"
  | "Mid-Range"
  | "Left Corner 3"
  | "Right Corner 3"
  | "Above the Break 3"
  | "Backcourt";

export interface Polar {
  r: number;
  /** Degrees; 0 = straight up the floor from the rim, negative = NBA "left". */
  theta: number;
}

export function polar(x: number, y: number): Polar {
  return { r: Math.hypot(x, y), theta: (Math.atan2(x, y) * 180) / Math.PI };
}

/**
 * Classify a field goal attempt. `value` (2 or 3) comes from the official shot type, so a shot whose recorded
 * coordinates sit a few tenths inside the arc but was ruled a three still lands in a three-point zone.
 */
export function classifyZone(x: number, y: number, value: 2 | 3): Zone {
  const { r, theta } = polar(x, y);
  const side = x < 0 ? "left" : "right";
  if (y >= BACKCOURT_Y) return "backcourt";
  if (value === 3) {
    // A three ruled below the break is a corner three even when its recorded x sits a tenth inside the line.
    if (y < CORNER_BREAK_Y) return `${side}_corner_3` as Zone;
    if (Math.abs(theta) < TOP_ANGLE_DEG) return "top_arc_3";
    return `${side}_wing_3` as Zone;
  }
  if (r < RESTRICTED_R) return "restricted_area";
  // The nail: centre of the free-throw line, the help-defence landmark (a 3 ft disc).
  if (Math.hypot(x, y - FT_LINE_Y) <= 30) return "nail";
  if (Math.abs(x) <= PAINT_HALF_W && y < PAINT_TOP_Y) return "paint";
  // Elbows: where the lane meets the free-throw line.
  if (Math.hypot(Math.abs(x) - PAINT_HALF_W, y - FT_LINE_Y) <= 35) return `${side}_elbow` as Zone;
  if (y < CORNER_BREAK_Y) return `${side}_short_corner` as Zone;
  if (Math.abs(theta) < TOP_ANGLE_DEG) return "top_mid";
  return `${side}_wing_mid` as Zone;
}

/** The value the coordinates alone imply (beyond the arc, or outside the corner line below the break). */
export function geometricValue(x: number, y: number): 2 | 3 {
  if (y < CORNER_BREAK_Y) return Math.abs(x) >= CORNER_X ? 3 : 2;
  return Math.hypot(x, y) >= THREE_R ? 3 : 2;
}

/** Map a fine zone (plus the geometry that the nail and elbows straddle) onto NBA's basic zone. */
export function basicZone(x: number, y: number, value: 2 | 3): BasicZone {
  const z = classifyZone(x, y, value);
  if (z === "backcourt") return "Backcourt";
  if (z === "left_corner_3") return "Left Corner 3";
  if (z === "right_corner_3") return "Right Corner 3";
  if (z.endsWith("_3")) return "Above the Break 3";
  if (z === "restricted_area") return "Restricted Area";
  // The nail and elbows are help landmarks that straddle the lane line; NBA splits them on the paint rectangle.
  const inPaint = Math.abs(x) <= PAINT_HALF_W && y < PAINT_TOP_Y;
  return inPaint ? "In The Paint (Non-RA)" : "Mid-Range";
}

/** NBA's above-the-break side label. */
export function aboveBreakArea(x: number, y: number): "Center(C)" | "Left Side Center(LC)" | "Right Side Center(RC)" {
  const { theta } = polar(x, y);
  if (Math.abs(theta) < TOP_ANGLE_DEG) return "Center(C)";
  return x < 0 ? "Left Side Center(LC)" : "Right Side Center(RC)";
}

/**
 * Hierarchical zone matching for the query language: a query value matches a zone when its `_`-separated segments
 * occur contiguously in the zone's segments. `right_wing` → right_wing_3, right_wing_mid; `corner_3` → both
 * corners; `elbow` → both elbows; `3` → every three-point zone.
 */
export function zoneMatches(query: string, zone: Zone): boolean {
  if (query === zone) return true;
  const q = query.split("_");
  const z = zone.split("_");
  outer: for (let i = 0; i + q.length <= z.length; i++) {
    for (let j = 0; j < q.length; j++) if (z[i + j] !== q[j]) continue outer;
    return true;
  }
  return false;
}

export const ZONE_LABEL: Record<Zone, string> = {
  restricted_area: "Restricted area",
  paint: "Paint (non-RA)",
  nail: "Nail",
  left_elbow: "Left elbow",
  right_elbow: "Right elbow",
  left_short_corner: "Left short corner",
  right_short_corner: "Right short corner",
  left_wing_mid: "Left wing mid",
  right_wing_mid: "Right wing mid",
  top_mid: "Top mid",
  left_corner_3: "Left corner 3",
  right_corner_3: "Right corner 3",
  left_wing_3: "Left wing 3",
  right_wing_3: "Right wing 3",
  top_arc_3: "Top arc 3",
  backcourt: "Backcourt",
};
