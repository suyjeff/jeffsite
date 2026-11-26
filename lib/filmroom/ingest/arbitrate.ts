// Cross-feed arbitration. The cdn.nba.com liveData snapshot is captured near the final buzzer; the stat crew keeps
// correcting the record afterwards (a steal re-credited, a toe-on-the-line two changed to a three). Those fixes
// reach stats.nba.com playbyplayv3 and shotchartdetail. Before parsing, each cdn action that has a counterpart in
// those feeds is compared and, where they disagree, the corrected value is applied and logged.
//
// Action numbers drift between cdn and v3 after edits, so counterparts are joined on (period, clock, kind, team),
// aligned in order within each cluster, and only when both feeds have the same number of actions of that kind there.

import type { CdnAction, RawGame, V3Action } from "./raw";
import { parseClock } from "./raw";

export interface Correction {
  actionNumber: number;
  field: string;
  from: string;
  to: string;
  source: "playbyplayv3" | "shotchartdetail" | "box minutes";
}

type Kind = "steal" | "block" | "fga";

const cdnKind = (a: CdnAction): Kind | null =>
  a.actionType === "steal" ? "steal" : a.actionType === "block" ? "block" : a.isFieldGoal ? "fga" : null;

const v3Kind = (a: V3Action): Kind | null =>
  /\bSTEAL\b/.test(a.description) ? "steal" : /\bBLOCK\b/.test(a.description) ? "block" : a.isFieldGoal ? "fga" : null;

export function arbitrate(raw: RawGame, acts: CdnAction[]): { actions: CdnAction[]; corrections: Correction[] } {
  const corrections: Correction[] = [];
  const out = acts.map((a) => ({ ...a }));

  // shotchartdetail is the official shot log: its event id is the cdn action number.
  const chart = new Map(raw.shots.map((s) => [s.eventId, s]));

  if (raw.v3?.length) {
    const key = (period: number, clock: number, kind: Kind, team: number) => `${period}|${clock}|${kind}|${team}`;
    const v3Groups = new Map<string, V3Action[]>();
    for (const v of raw.v3) {
      const k = v3Kind(v);
      if (!k || !v.teamId) continue;
      const kk = key(v.period, parseClock(v.clock), k, v.teamId);
      (v3Groups.get(kk) ?? v3Groups.set(kk, []).get(kk)!).push(v);
    }
    const cdnGroups = new Map<string, CdnAction[]>();
    for (const a of out) {
      const k = cdnKind(a);
      if (!k || !a.teamId) continue;
      const kk = key(a.period, parseClock(a.clock), k, a.teamId);
      (cdnGroups.get(kk) ?? cdnGroups.set(kk, []).get(kk)!).push(a);
    }
    for (const [kk, cs] of cdnGroups) {
      const vs = v3Groups.get(kk);
      if (!vs || vs.length !== cs.length) continue;
      const kind = kk.split("|")[2] as Kind;
      cs.forEach((a, i) => {
        const v = vs[i];
        if (kind === "steal" || kind === "block") {
          if (v.personId && v.personId !== a.personId) {
            corrections.push({ actionNumber: a.actionNumber, field: `${kind}.personId`, from: String(a.personId), to: String(v.personId), source: "playbyplayv3" });
            a.personId = v.personId;
            a.personIdsFilter = [v.personId];
          }
        } else if (kind === "fga") {
          const sv = v.shotValue || (/\b3PT\b/.test(v.description) ? 3 : 2);
          const value = sv === 3 ? "3pt" : "2pt";
          // A value change must be confirmed by the shot chart too: two corrected feeds outvote the snapshot.
          const c = chart.get(a.actionNumber);
          if (value !== a.actionType && c && (c.value === 3 ? "3pt" : "2pt") === value) {
            corrections.push({ actionNumber: a.actionNumber, field: "shot.value", from: a.actionType, to: value, source: "playbyplayv3" });
            a.actionType = value;
            if (c.locX !== a.xLegacy || c.locY !== a.yLegacy) {
              corrections.push({ actionNumber: a.actionNumber, field: "shot.xy", from: `${a.xLegacy},${a.yLegacy}`, to: `${c.locX},${c.locY}`, source: "shotchartdetail" });
              a.xLegacy = c.locX;
              a.yLegacy = c.locY;
            }
          }
        }
      });
    }
  }
  return { actions: out, corrections };
}
