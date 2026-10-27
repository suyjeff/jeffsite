// NFL team identity for the game views: each team's primary color, its logo, and, where ESPN's public scoreboard
// answers, the network a game is on. Colors are the clubs' own primaries, used only as thin accents.

export const TEAM_COLOR: Record<string, string> = {
  ARI: '#97233F',
  ATL: '#A71930',
  BAL: '#241773',
  BUF: '#00338D',
  CAR: '#0085CA',
  CHI: '#C83803',
  CIN: '#FB4F14',
  CLE: '#FF3C00',
  DAL: '#003594',
  DEN: '#FB4F14',
  DET: '#0076B6',
  GB: '#203731',
  HOU: '#03202F',
  IND: '#002C5F',
  JAX: '#006778',
  KC: '#E31837',
  LV: '#A5ACAF',
  LAC: '#0080C6',
  LAR: '#003594',
  MIA: '#008E97',
  MIN: '#4F2683',
  NE: '#002244',
  NO: '#D3BC8D',
  NYG: '#0B2265',
  NYJ: '#125740',
  PHI: '#004C54',
  PIT: '#FFB612',
  SF: '#AA0000',
  SEA: '#69BE28',
  TB: '#D50A0A',
  TEN: '#4B92DB',
  WAS: '#5A1414',
}

export const teamColor = (abbr: string) => TEAM_COLOR[abbr] ?? '#888888'
export const teamLogo = (abbr: string) => `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png`

/** ESPN abbreviations that differ from Sleeper's. */
const ESPN_TO_SLEEPER: Record<string, string> = { WSH: 'WAS', LA: 'LAR' }

export type Broadcast = {
  networks: string[]
  away?: number
  home?: number
  /** ESPN's game state: before, during or over. A game postponed, canceled or suspended reads 'pre': it is not over. */
  state?: 'pre' | 'in' | 'post'
  /** Kickoff, as ESPN schedules it (ms). */
  start?: number
  /** When this reading was fetched (ms); stamped by the reader, not the payload. */
  at?: number
  /** The latest the game can have ended (ms): when a reading first said it was over, or kickoff plus five hours. */
  ended?: number
  /** A game under way: the quarter and its clock ("Q3 4:12", "Half", "OT 2:00"). */
  clock?: string
  /** Share of regulation played, 0–1, for a game under way. */
  elapsed?: number
}

/** "4:12" to seconds. */
const clockSecs = (c?: string) => {
  const m = /^(\d+):(\d+)/.exec(c ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Networks (and, once played, scores) by "AWAY@HOME", from ESPN's scoreboard payload. Anything unexpected is skipped. */
export const parseScoreboard = (json: unknown): Record<string, Broadcast> => {
  const out: Record<string, Broadcast> = {}
  const events = (json as { events?: unknown[] })?.events
  if (!Array.isArray(events)) return out
  for (const e of events) {
    const ev = e as { date?: string }
    const c = (
      e as {
        competitions?: {
          competitors?: { homeAway?: string; score?: string; team?: { abbreviation?: string } }[]
          broadcasts?: { names?: string[] }[]
          status?: { period?: number; displayClock?: string; type?: { state?: string; name?: string; completed?: boolean } }
        }[]
      }
    )?.competitions?.[0]
    if (!c?.competitors) continue
    const side = (k: 'home' | 'away') => c.competitors!.find((x) => x.homeAway === k)
    const abbr = (x?: { team?: { abbreviation?: string } }) => {
      const a = x?.team?.abbreviation ?? ''
      return ESPN_TO_SLEEPER[a] ?? a
    }
    const home = side('home')
    const away = side('away')
    if (!home || !away) continue
    const num = (s?: string) => (s != null && s !== '' && !Number.isNaN(Number(s)) ? Number(s) : undefined)
    // Over only when ESPN calls it complete: a postponed, canceled or suspended game also sits in its 'post' state, but
    // it has not been played, so it reads as not started.
    const type = c.status?.type
    const done = type?.completed === true || type?.name === 'STATUS_FINAL' || type?.name === 'STATUS_FINAL_OVERTIME'
    const state = type?.state === 'in' ? 'in' : type?.state === 'post' && done ? 'post' : 'pre'
    const start = ev.date ? Date.parse(ev.date) : NaN
    // The clock, for a game under way: quarters are 15 minutes, so the share played is what a projection has left.
    const period = c.status?.period ?? 0
    const left = clockSecs(c.status?.displayClock)
    const half = c.status?.type?.name === 'STATUS_HALFTIME'
    const clock =
      state !== 'in' || !period ? undefined : half ? 'Half' : `${period > 4 ? 'OT' : `Q${period}`}${left != null ? ` ${c.status!.displayClock}` : ''}`
    const elapsed = state !== 'in' || !period ? undefined : half ? 0.5 : period > 4 ? 1 : Math.min(1, Math.max(0, ((period - 1) * 900 + (900 - (left ?? 450))) / 3600))
    out[`${abbr(away)}@${abbr(home)}`] = {
      networks: [...new Set((c.broadcasts ?? []).flatMap((b) => b.names ?? []))],
      away: num(away.score),
      home: num(home.score),
      state,
      ...(Number.isFinite(start) ? { start } : {}),
      ...(clock ? { clock, elapsed } : {}),
    }
  }
  return out
}
