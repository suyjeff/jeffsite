// Your grades on suggested trades, and what the trade read learns from them.
//
// The yes-odds on a trade are judgment: a handful of weighted terms (their
// lineup gain, how the deal looks by consensus, how active they are). You know
// things they cannot: that one manager never sells his first-round pick, that
// another has checked out for the season, that a third laughs at anything
// short of a steal. Grading a suggestion says so, and every read after it moves:
//
//   a grade      pulls that manager's odds toward it: likely ≈ 75%, maybe ≈ 40%,
//                no way ≈ 7%. Each grade is a residual on the log-odds scale,
//                shrunk toward zero until there are several (n / (n + 2)), plus a
//                smaller league-wide shift (n / (n + 6)) for how generous or harsh
//                the model is with everyone.
//   a reason     narrows it: "won't move him" makes that player off limits from
//                that team; "asks too much" caps the premium you can ask of
//                them; "checked out" marks the manager dormant.
//
// Grades live in this browser, per league.

import type { AcceptRead } from './behavior'
import type { TradeIdea } from './trades'

export type Grade = 'yes' | 'maybe' | 'no'
export type GradeWhy = 'untouchable' | 'lopsided' | 'dormant' | 'fit'

export type GradeRecord = {
  partnerId: number
  give: string[]
  get: string[]
  grade: Grade
  why?: GradeWhy
  /** For "won't move him": the player they keep. */
  player?: string
  /** The model's log-odds when you graded it, before any lessons. */
  x: number
  /** Value you asked of them by consensus, pts/wk. */
  ask: number | null
  at: number
}

export type Grades = Record<string, GradeRecord>

export type Lessons = {
  n: number
  global: number
  partner: Record<number, { offset: number; n: number; dormant: boolean }>
  /** Players a manager will not move, by your grade. */
  untouchable: Record<number, string[]>
  /** The smallest consensus premium a manager balked at. */
  askCap: Record<number, number>
  /** Positions a manager has no use for, from "doesn't need it". */
  noUse: Record<number, string[]>
  grades: Grades
}

export const TARGET: Record<Grade, number> = { yes: 0.75, maybe: 0.4, no: 0.07 }
export const GRADE_LABEL: Record<Grade, string> = { yes: 'Likely', maybe: 'Maybe', no: 'No way' }
export const WHY_LABEL: Record<GradeWhy, string> = {
  untouchable: "won't move him",
  lopsided: 'too big an ask',
  dormant: 'checked out',
  fit: "doesn't need it",
}

const logit = (p: number) => Math.log(p / (1 - p))
const logistic = (x: number) => 1 / (1 + Math.exp(-x))

/** One key per deal: who, and the players each way. */
export const ideaKey = (i: Pick<TradeIdea, 'partnerId' | 'give' | 'get'>) => `${i.partnerId}|${[...i.give].sort().join(',')}>${[...i.get].sort().join(',')}`

const KEY = (leagueId: string) => `ff:grades:v1:${leagueId}`

export const loadGrades = (leagueId: string): Grades => {
  try {
    if (typeof window === 'undefined') return {}
    const raw = JSON.parse(window.localStorage.getItem(KEY(leagueId)) ?? '{}') as Grades
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export const saveGrades = (leagueId: string, g: Grades) => {
  try {
    if (Object.keys(g).length) window.localStorage.setItem(KEY(leagueId), JSON.stringify(g))
    else window.localStorage.removeItem(KEY(leagueId))
  } catch {
    // Private mode or full storage: the grades last for this visit.
  }
}

/** What a set of grades teaches. Positions of players come from `posOf`. */
export const learn = (grades: Grades, posOf: (id: string) => string | undefined): Lessons => {
  const recs = Object.values(grades)
  const partner: Lessons['partner'] = {}
  const sums: Record<number, number> = {}
  let all = 0
  let nAll = 0
  const untouchable: Record<number, string[]> = {}
  const askCap: Record<number, number> = {}
  const noUse: Record<number, string[]> = {}
  for (const r of recs) {
    // A reason explains the grade with a rule of its own, so it does not also drag the manager's whole curve.
    // Those grades count toward neither the residual nor its sample, so they never dilute the real ones.
    const rule = r.why === 'untouchable' || r.why === 'fit'
    const p = (partner[r.partnerId] ??= { offset: 0, n: 0, dormant: false })
    if (!rule) {
      const residual = logit(TARGET[r.grade]) - r.x
      sums[r.partnerId] = (sums[r.partnerId] ?? 0) + residual
      all += residual
      nAll++
      p.n++
    }
    if (r.why === 'dormant') p.dormant = true
    if (r.why === 'untouchable' && r.player) untouchable[r.partnerId] = [...new Set([...(untouchable[r.partnerId] ?? []), r.player])]
    if (r.why === 'lopsided' && r.ask != null) askCap[r.partnerId] = Math.min(askCap[r.partnerId] ?? Infinity, r.ask)
    if (r.why === 'fit') {
      const pos = r.give.map(posOf).filter((x): x is string => !!x)
      noUse[r.partnerId] = [...new Set([...(noUse[r.partnerId] ?? []), ...pos])]
    }
  }
  for (const [id, p] of Object.entries(partner)) p.offset = (sums[Number(id)] ?? 0) / (p.n + 2)
  return { n: recs.length, global: nAll ? all / (nAll + 6) : 0, partner, untouchable, askCap, noUse, grades }
}

/** Whether your grades rule a deal out, without scoring it: your own "no way", or a player you said they keep. */
export const ruledOutBy = (idea: Pick<TradeIdea, 'partnerId' | 'give' | 'get'>, lessons: Lessons) => {
  const own = lessons.grades[ideaKey(idea)]
  return own ? own.grade === 'no' : (lessons.untouchable[idea.partnerId] ?? []).some((id) => idea.get.includes(id))
}

/** A read with your grades applied: the same terms, then the lessons on top, each one said out loud. */
export const applyLessons = (
  read: AcceptRead,
  idea: TradeIdea,
  lessons: Lessons | null | undefined,
  names: (id: string) => string,
  posOf: (id: string) => string | undefined,
): AcceptRead => {
  if (!lessons || !lessons.n) return read
  const signals = [...read.signals]
  let x = read.logit
  const p = lessons.partner[idea.partnerId]
  const own = lessons.grades[ideaKey(idea)]
  x += lessons.global
  if (p) {
    x += p.offset
    if (p.dormant) {
      x -= 1.5
      signals.unshift({ text: 'you marked this manager as checked out', tone: 'neg' })
    } else if (Math.abs(p.offset) >= 0.2)
      signals.unshift({ text: `${p.offset > 0 ? 'raised' : 'lowered'} by your ${p.n} grade${p.n === 1 ? '' : 's'} of this team`, tone: p.offset > 0 ? 'pos' : 'neg' })
  }
  const kept = (lessons.untouchable[idea.partnerId] ?? []).filter((id) => idea.get.includes(id))
  if (kept.length) {
    x = Math.min(x, -4)
    signals.unshift({ text: `you said they won't move ${kept.map(names).join(' or ')}`, tone: 'neg' })
  }
  const cap = lessons.askCap[idea.partnerId]
  if (cap != null && read.perceivedAsk != null && read.perceivedAsk >= cap * 0.9) {
    x -= 1.2
    signals.unshift({ text: 'asks about as much as a deal you said they balked at', tone: 'neg' })
  }
  const useless = lessons.noUse[idea.partnerId]
  if (useless?.length && idea.give.every((id) => useless.includes(posOf(id) ?? ''))) {
    x -= 0.8
    signals.unshift({ text: `you said they have no use for another ${[...new Set(idea.give.map(posOf))].join('/')}`, tone: 'neg' })
  }
  // Your own grade of this very deal is the answer.
  if (own) x = logit(TARGET[own.grade])
  const index = Math.round(logistic(x) * 100)
  return {
    ...read,
    logit: x,
    index,
    band: index >= 60 ? 'likely' : index >= 35 ? 'possible' : 'long shot',
    reasons: signals.map((s) => s.text),
    signals,
    graded: own ? own.grade : null,
    // Your grade of this deal decides; a player you said they keep rules out the deals you have not graded.
    ruledOut: ruledOutBy(idea, lessons),
  }
}
