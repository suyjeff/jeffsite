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

export type Broadcast = { networks: string[]; away?: number; home?: number; /** ESPN's game state: before, during or after. */ state?: 'pre' | 'in' | 'post' }

/** Networks (and, once played, scores) by "AWAY@HOME", from ESPN's scoreboard payload. Anything unexpected is skipped. */
export const parseScoreboard = (json: unknown): Record<string, Broadcast> => {
  const out: Record<string, Broadcast> = {}
  const events = (json as { events?: unknown[] })?.events
  if (!Array.isArray(events)) return out
  for (const e of events) {
    const c = (
      e as {
        competitions?: {
          competitors?: { homeAway?: string; score?: string; team?: { abbreviation?: string } }[]
          broadcasts?: { names?: string[] }[]
          status?: { type?: { state?: string } }
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
    out[`${abbr(away)}@${abbr(home)}`] = {
      networks: [...new Set((c.broadcasts ?? []).flatMap((b) => b.names ?? []))],
      away: num(away.score),
      home: num(home.score),
      state: c.status?.type?.state === 'in' ? 'in' : c.status?.type?.state === 'post' ? 'post' : 'pre',
    }
  }
  return out
}
