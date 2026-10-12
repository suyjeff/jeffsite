// The pure part of the grades worker: what one browser's grades add up to, and what a league's
// browsers add up to once yours is left out. No Worker APIs here, so the app's tests can import it.
//
// Every browser's grades reduce to a Contribution. Nothing is kept as a running total: each browser
// owns one key, and a read adds the keys up (and caches the result), so no two writes can ever collide.

export type Grade = 'yes' | 'maybe' | 'no'
export type Why = 'untouchable' | 'lopsided' | 'dormant' | 'fit'

/** One grade as stored: roster ids and numbers only. */
export type StoredGrade = {
  /** A short hash of the deal, so a regrade replaces the old grade instead of adding to it. */
  key: string
  partnerId: number
  grade: Grade
  why?: Why
  /** For "won't move him": the player they keep (a player id, never a name). */
  player?: string
  /** The model's log-odds when graded, before any lessons. */
  x: number
  ask: number | null
  /** The trade-value scale `ask` is in. */
  v?: number
  at: number
}

export type Sum = { sum: number; n: number }

export type PartnerContribution = {
  /** Residual sum and count: grades that carry no rule of their own. */
  sum: number
  n: number
  dormant: boolean
  untouchable: string[]
  /** Smallest premium balked at, per price scale. */
  ask: Record<string, number>
}

export type Contribution = {
  all: Sum
  partners: Record<string, PartnerContribution>
  at: number
}

/** What a read gets back: everyone else's grades, summed. */
export type Prior = {
  /** Residuals across every league, yours left out. */
  global: Sum
  /** Per team in this league, yours left out. */
  partners: Record<string, { sum: number; n: number; dormant: number; untouchable: string[]; askCap: number | null }>
  /** How many other browsers have graded in this league. */
  clients: number
}

// Same targets as the app (lib/fantasy/grades.ts): a grade is a point on the odds scale.
export const TARGET: Record<Grade, number> = { yes: 0.75, maybe: 0.4, no: 0.07 }
const logit = (p: number) => Math.log(p / (1 - p))

export const GRADES: readonly string[] = ['yes', 'maybe', 'no']
export const WHYS: readonly string[] = ['untouchable', 'lopsided', 'dormant', 'fit']

export const LIMITS = { x: 12, ask: 500, partnerId: 99, perClient: 400, clientsPerLeague: 30 }

/** A grade the worker will store, or null. Anything unexpected is dropped rather than repaired. */
export const cleanGrade = (raw: unknown): StoredGrade | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const partnerId = num(r.partnerId)
  const x = num(r.x)
  if (typeof r.key !== 'string' || !/^[A-Za-z0-9]{4,24}$/.test(r.key)) return null
  if (partnerId === null || !Number.isInteger(partnerId) || partnerId < 0 || partnerId > LIMITS.partnerId) return null
  if (typeof r.grade !== 'string' || !GRADES.includes(r.grade)) return null
  if (x === null || Math.abs(x) > LIMITS.x) return null
  const ask = r.ask === null || r.ask === undefined ? null : num(r.ask)
  if (ask !== null && (ask < 0 || ask > LIMITS.ask)) return null
  const out: StoredGrade = { key: r.key, partnerId, grade: r.grade as Grade, x, ask, at: num(r.at) ?? 0 }
  if (typeof r.why === 'string' && WHYS.includes(r.why)) out.why = r.why as Why
  if (out.why === 'untouchable' && typeof r.player === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(r.player)) out.player = r.player
  const v = num(r.v)
  if (v !== null && Number.isInteger(v) && v >= 0 && v < 1000) out.v = v
  return out
}

/** What one browser's grades add up to. Mirrors learn() in the app. */
export const contribute = (grades: StoredGrade[], at = 0): Contribution => {
  const out: Contribution = { all: { sum: 0, n: 0 }, partners: {}, at }
  for (const r of grades) {
    const p = (out.partners[r.partnerId] ??= { sum: 0, n: 0, dormant: false, untouchable: [], ask: {} })
    // A reason that is a rule of its own does not also drag the manager's whole curve.
    const rule = r.why === 'untouchable' || r.why === 'fit'
    if (!rule) {
      const residual = logit(TARGET[r.grade]) - r.x
      p.sum += residual
      p.n++
      out.all.sum += residual
      out.all.n++
    }
    if (r.why === 'dormant') p.dormant = true
    if (r.why === 'untouchable' && r.player && !p.untouchable.includes(r.player)) p.untouchable.push(r.player)
    if (r.why === 'lopsided' && r.ask != null && r.v != null) p.ask[r.v] = Math.min(p.ask[r.v] ?? Infinity, r.ask)
  }
  return out
}

/** One browser's key in KV, and the parts of one back out. */
export const clientKey = (league: string, client: string) => `c:${league}:${client}`
/** The client id in a key under this league's prefix, or null when the key belongs to another league whose id starts the same way. */
export const clientOf = (key: string, league: string) => {
  const prefix = `c:${league}:`
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  return rest && !rest.includes(':') ? rest : null
}

/** The prior for one browser: the league's other browsers, and every league's residuals less its own part.
 *  `sums` is each browser's residual total by its KV key, as the key listing gives it. */
export const priorFor = (clients: Record<string, Contribution>, sums: Record<string, Sum>, me: string | undefined, league: string, v: number | undefined): Prior => {
  const ownKey = me ? clientKey(league, me) : undefined
  const out: Prior = { global: { sum: 0, n: 0 }, partners: {}, clients: 0 }
  for (const [key, t] of Object.entries(sums)) {
    if (key === ownKey) continue
    out.global.sum += t.sum
    out.global.n += t.n
  }
  for (const [id, c] of Object.entries(clients)) {
    if (id === me) continue
    out.clients++
    for (const [pid, p] of Object.entries(c.partners)) {
      const t = (out.partners[pid] ??= { sum: 0, n: 0, dormant: 0, untouchable: [], askCap: null })
      t.sum += p.sum
      t.n += p.n
      if (p.dormant) t.dormant++
      for (const player of p.untouchable) if (!t.untouchable.includes(player)) t.untouchable.push(player)
      const ask = v === undefined ? undefined : p.ask[v]
      if (ask !== undefined) t.askCap = t.askCap === null ? ask : Math.min(t.askCap, ask)
    }
  }
  return out
}
