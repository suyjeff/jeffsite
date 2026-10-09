// One season played out, game by game, for the playoff simulator: the same model as the odds (lib/fantasy/forecast's
// simulateSeason), but a single draw kept whole, so it can be shown as standings, a bracket and the stories in it.
//
// The odds are the average over thousands of these. A trace is one of them: any single season is unlikely, which is
// the point. Locked results hold in both.

import { bracketOrder, lockKey, lockStream, lockedScores, normals, persistMean, rng, type Forecast, type ForecastInput, type SimInput } from './forecast'

/** The simulation's input from the forecast, as the odds use it, with locked results and a chaos factor on the noise. */
export const simInputFor = (input: ForecastInput, f: Forecast, opts: { locks?: Record<string, number>; chaos?: number; sims?: number; seed?: number } = {}): SimInput => {
  const teams = input.teams.map((t) => t.rosterId)
  const k = opts.chaos ?? 1
  return {
    teams,
    record: input.record,
    schedule: input.schedule,
    playoffWeeks: input.playoffWeeks,
    playoffTeams: input.playoffTeams,
    mean: persistMean(f.mean, teams),
    sigma: f.sigma * k,
    tau: f.tau * k,
    weeksLeft: input.weeksLeft,
    sims: opts.sims ?? 2000,
    seed: opts.seed,
    locks: opts.locks,
  }
}

export type TraceGame = { week: number; a: number; b: number; sa: number; sb: number; locked: boolean }
export type TraceRow = {
  rosterId: number
  seed: number
  wins: number
  losses: number
  ties: number
  pf: number
  /** Wins and losses before the simulated weeks. */ was: { wins: number; losses: number }
}
export type BracketGame = { a: number | null; b: number | null; seedA: number | null; seedB: number | null; sa: number | null; sb: number | null; winner: number | null }
export type BracketRound = { week: number; name: string; games: BracketGame[] }

export type Trace = {
  seed: number
  regular: TraceGame[]
  standings: TraceRow[]
  nPlayoff: number
  rounds: BracketRound[]
  champion: number | null
  runnerUp: number | null
}

export const roundName = (teamsLeft: number) => (teamsLeft === 2 ? 'Final' : teamsLeft === 4 ? 'Semifinals' : teamsLeft === 8 ? 'Quarterfinals' : `Round of ${teamsLeft}`)

/** One simulated season, kept whole. */
export const simulateOnce = (input: SimInput, seed: number): Trace => {
  const { teams, schedule, record, sigma, tau, playoffWeeks } = input
  const z = normals(rng(seed))
  const zl = normals(rng(lockStream(seed)))
  const level: Record<number, number> = {}
  const rows: Record<number, TraceRow> = {}
  for (const t of teams) {
    const r = record[t] ?? { wins: 0, losses: 0, ties: 0, pf: 0 }
    rows[t] = { rosterId: t, seed: 0, wins: r.wins, losses: r.losses, ties: r.ties, pf: r.pf, was: { wins: r.wins, losses: r.losses } }
    level[t] = tau * z()
  }
  const score = (t: number, w: number, draw = z) => input.mean(t, w) + level[t] + sigma * draw()
  const regular: TraceGame[] = []
  for (const g of [...schedule].sort((x, y) => x.week - y.week)) {
    if (!rows[g.a] || !rows[g.b]) continue
    let sa = score(g.a, g.week)
    let sb = score(g.b, g.week)
    const lock = input.locks?.[lockKey(g)]
    if (lock !== undefined)
      [sa, sb] = lockedScores(
        lock === g.a,
        sa,
        sb,
        () => score(g.a, g.week, zl),
        () => score(g.b, g.week, zl),
      )
    rows[g.a].pf += sa
    rows[g.b].pf += sb
    if (sa > sb) {
      rows[g.a].wins++
      rows[g.b].losses++
    } else {
      rows[g.b].wins++
      rows[g.a].losses++
    }
    regular.push({ week: g.week, a: g.a, b: g.b, sa, sb, locked: lock !== undefined })
  }
  const standings = Object.values(rows).sort((x, y) => y.wins + 0.5 * y.ties - (x.wins + 0.5 * x.ties) || y.pf - x.pf)
  standings.forEach((r, i) => (r.seed = i + 1))

  const nPlayoff = Math.min(input.playoffTeams || 0, teams.length)
  const size = nPlayoff > 1 ? 2 ** Math.ceil(Math.log2(nPlayoff)) : 0
  const rounds: BracketRound[] = []
  let champion: number | null = null
  let runnerUp: number | null = null
  if (size) {
    const seedOf = (t: number | null) => (t == null ? null : rows[t].seed)
    let alive: (number | null)[] = bracketOrder(size).map((s) => (s <= nPlayoff ? standings[s - 1].rosterId : null))
    let i = 0
    while (alive.length > 1) {
      const week = playoffWeeks[Math.min(i, playoffWeeks.length - 1)] ?? 0
      const games: BracketGame[] = []
      const next: (number | null)[] = []
      for (let m = 0; m < alive.length; m += 2) {
        const a = alive[m]
        const b = alive[m + 1]
        if (a == null || b == null) {
          games.push({ a, b, seedA: seedOf(a), seedB: seedOf(b), sa: null, sb: null, winner: a ?? b })
          next.push(a ?? b)
          continue
        }
        const sa = score(a, week)
        const sb = score(b, week)
        const winner = sa >= sb ? a : b
        games.push({ a, b, seedA: seedOf(a), seedB: seedOf(b), sa, sb, winner })
        next.push(winner)
      }
      rounds.push({ week, name: roundName(alive.length), games })
      if (alive.length === 2) {
        const g = games[0]
        champion = g.winner
        runnerUp = g.winner === g.a ? g.b : g.a
      }
      alive = next
      i++
    }
    if (champion == null) champion = alive[0] ?? null
  }
  return { seed, regular, standings, nPlayoff, rounds, champion, runnerUp }
}

// ---------- Stories ----------

/** A story's text: plain words and team mentions, so the page can style the names. */
export type Part = string | { team: number }
export type Story = {
  key: string
  kind: 'title' | 'upset' | 'escape' | 'bubble' | 'thriller' | 'rout' | 'streak' | 'slump' | 'you'
  when: string
  a: number
  b: number | null
  parts: Part[]
  order: number
}

const WEIGHT: Record<Story['kind'], number> = { you: 10, title: 9, upset: 8, bubble: 7, thriller: 6, escape: 5, streak: 4, rout: 3, slump: 2 }
const f1 = (x: number) => x.toFixed(1)
const ord = (n: number) => `No. ${n}`

/**
 * The few things worth retelling from one season: the title game, playoff upsets and escapes, how the last
 * playoff spot was settled, the closest and most lopsided games among teams near the line, streaks, and
 * where you finished. At most `limit`, in the order they happened.
 */
export const seasonStories = (t: Trace, me: number | null, limit = 8): Story[] => {
  const out: Story[] = []
  const row = Object.fromEntries(t.standings.map((r) => [r.rosterId, r])) as Record<number, TraceRow>
  const lastIn = t.standings[t.nPlayoff - 1]
  const firstOut = t.standings[t.nPlayoff]
  const near = (id: number) => Math.abs(row[id].seed - t.nPlayoff - 0.5) <= 2.5
  const maxWeek = Math.max(0, ...t.regular.map((g) => g.week))

  // The last spot: settled head to head, on points, or by a game.
  if (lastIn && firstOut) {
    const h2h = [...t.regular].reverse().find((g) => (g.a === lastIn.rosterId && g.b === firstOut.rosterId) || (g.b === lastIn.rosterId && g.a === firstOut.rosterId))
    const tied = lastIn.wins === firstOut.wins && lastIn.ties === firstOut.ties
    if (tied)
      out.push({
        key: 'bubble',
        kind: 'bubble',
        when: 'standings',
        a: lastIn.rosterId,
        b: firstOut.rosterId,
        order: 900,
        parts: [
          { team: lastIn.rosterId },
          ` took the last playoff spot on points, ${Math.round(lastIn.pf).toLocaleString()} to ${Math.round(firstOut.pf).toLocaleString()}, over `,
          { team: firstOut.rosterId },
          '.',
        ],
      })
    else if (h2h) {
      const aWon = h2h.sa > h2h.sb
      const w = aWon ? h2h.a : h2h.b
      const l = aWon ? h2h.b : h2h.a
      out.push({
        key: 'bubble',
        kind: 'bubble',
        when: `wk ${h2h.week}`,
        a: w,
        b: l,
        order: h2h.week,
        parts: [
          { team: w },
          ` beat `,
          { team: l },
          ` ${f1(Math.max(h2h.sa, h2h.sb))}–${f1(Math.min(h2h.sa, h2h.sb))} in week ${h2h.week}. ${w === lastIn.rosterId ? 'That game was the last playoff spot.' : 'It was not enough.'}`,
        ],
      })
    } else
      out.push({
        key: 'bubble',
        kind: 'bubble',
        when: 'standings',
        a: lastIn.rosterId,
        b: firstOut.rosterId,
        order: 900,
        parts: [
          { team: lastIn.rosterId },
          ` held off `,
          { team: firstOut.rosterId },
          ` for the last spot, ${lastIn.wins}-${lastIn.losses} to ${firstOut.wins}-${firstOut.losses}.`,
        ],
      })
  }

  // Thrillers and routs among teams near the line, the regular season's stories.
  const contested = t.regular.filter((g) => !g.locked && (near(g.a) || near(g.b)))
  const thriller = [...contested].sort((x, y) => Math.abs(x.sa - x.sb) - Math.abs(y.sa - y.sb))[0]
  if (thriller && Math.abs(thriller.sa - thriller.sb) < 4) {
    const aWon = thriller.sa > thriller.sb
    const w = aWon ? thriller.a : thriller.b
    const l = aWon ? thriller.b : thriller.a
    out.push({
      key: `thriller:${thriller.week}`,
      kind: 'thriller',
      when: `wk ${thriller.week}`,
      a: w,
      b: l,
      order: thriller.week,
      parts: [
        { team: w },
        ` edged `,
        { team: l },
        ` ${f1(Math.max(thriller.sa, thriller.sb))}–${f1(Math.min(thriller.sa, thriller.sb))}, a ${f1(Math.abs(thriller.sa - thriller.sb))}-point game.`,
      ],
    })
  }
  const rout = [...t.regular].sort((x, y) => Math.abs(y.sa - y.sb) - Math.abs(x.sa - x.sb))[0]
  if (rout && Math.abs(rout.sa - rout.sb) >= 35) {
    const aWon = rout.sa > rout.sb
    const w = aWon ? rout.a : rout.b
    const l = aWon ? rout.b : rout.a
    out.push({
      key: `rout:${rout.week}`,
      kind: 'rout',
      when: `wk ${rout.week}`,
      a: w,
      b: l,
      order: rout.week + 0.1,
      parts: [{ team: w }, ` buried `, { team: l }, ` by ${Math.round(Math.abs(rout.sa - rout.sb))}, ${f1(Math.max(rout.sa, rout.sb))}–${f1(Math.min(rout.sa, rout.sb))}.`],
    })
  }

  // Streaks to finish the regular season.
  const weeks = new Set(t.regular.map((g) => g.week))
  if (weeks.size >= 3) {
    const byTeam: Record<number, boolean[]> = {}
    for (const g of t.regular) {
      ;(byTeam[g.a] ??= []).push(g.sa > g.sb)
      ;(byTeam[g.b] ??= []).push(g.sb >= g.sa)
    }
    const run = (xs: boolean[], v: boolean) => {
      let n = 0
      for (let i = xs.length - 1; i >= 0 && xs[i] === v; i--) n++
      return n
    }
    const hot = Object.entries(byTeam)
      .map(([id, xs]) => ({ id: Number(id), n: run(xs, true), all: xs.every(Boolean) && xs.length >= 3 }))
      .sort((a, b) => b.n - a.n)[0]
    if (hot && hot.n >= 4) {
      const r = row[hot.id]
      out.push({
        key: 'streak',
        kind: 'streak',
        when: `to wk ${maxWeek}`,
        a: hot.id,
        b: null,
        order: maxWeek + 0.2,
        parts: [{ team: hot.id }, hot.all ? ` won out, ${hot.n} straight, to finish ${r.wins}-${r.losses}.` : ` closed on ${hot.n} straight wins to finish ${r.wins}-${r.losses}.`],
      })
    }
    const cold = Object.entries(byTeam)
      .map(([id, xs]) => ({ id: Number(id), n: run(xs, false) }))
      .filter((x) => row[x.id].seed <= t.nPlayoff + 2)
      .sort((a, b) => b.n - a.n)[0]
    if (cold && cold.n >= 4 && cold.id !== hot?.id) {
      const r = row[cold.id]
      out.push({
        key: 'slump',
        kind: 'slump',
        when: `to wk ${maxWeek}`,
        a: cold.id,
        b: null,
        order: maxWeek + 0.3,
        parts: [{ team: cold.id }, ` dropped its last ${cold.n} and finished ${r.wins}-${r.losses}${r.seed > t.nPlayoff ? ', out' : `, seeded ${r.seed}`}.`],
      })
    }
  }

  // The playoffs: upsets, escapes, the title.
  t.rounds.forEach((rd, i) => {
    for (const g of rd.games) {
      if (g.a == null || g.b == null || g.sa == null || g.sb == null || g.winner == null) continue
      const w = g.winner
      const l = w === g.a ? g.b : g.a
      const sw = (w === g.a ? g.seedA : g.seedB)!
      const sl = (w === g.a ? g.seedB : g.seedA)!
      const hi = Math.max(g.sa, g.sb)
      const lo = Math.min(g.sa, g.sb)
      const order = 1000 + i * 10
      if (rd.name === 'Final') {
        out.push({
          key: 'title',
          kind: 'title',
          when: rd.name,
          a: w,
          b: l,
          order: order + 5,
          parts: [sw >= 3 ? `${ord(sw)} seed ` : '', { team: w }, ` won the title, ${f1(hi)}–${f1(lo)} over `, { team: l }, sw > sl ? ', from the lower seed.' : '.'],
        })
      } else if (sw - sl >= 2)
        out.push({
          key: `upset:${i}:${w}`,
          kind: 'upset',
          when: rd.name,
          a: w,
          b: l,
          order,
          parts: [`${ord(sw)} `, { team: w }, ` stunned ${ord(sl)} `, { team: l }, ` ${f1(hi)}–${f1(lo)}.`],
        })
      else if (hi - lo < 3)
        out.push({ key: `escape:${i}:${w}`, kind: 'escape', when: rd.name, a: w, b: l, order: order + 1, parts: [{ team: w }, ` survived `, { team: l }, ` by ${f1(hi - lo)}.`] })
    }
  })

  // Where you finished, always told.
  if (me != null && row[me]) {
    const r = row[me]
    const lostTo = t.rounds
      .flatMap((rd) => rd.games.map((g) => ({ rd, g })))
      .find(({ g }) => (g.a === me || g.b === me) && g.winner != null && g.winner !== me && g.a != null && g.b != null)
    const parts: Part[] =
      t.champion === me
        ? [`You went ${r.wins}-${r.losses}, took the ${ord(r.seed)} seed and won it all.`]
        : r.seed > t.nPlayoff
          ? [
              `You finished ${r.wins}-${r.losses}, ${ord(r.seed)}, and missed the playoffs ${
                lastIn && lastIn.wins > r.wins ? `by ${lastIn.wins - r.wins} ${lastIn.wins - r.wins === 1 ? 'win' : 'wins'}.` : 'on points.'
              }`,
            ]
          : lostTo
            ? [`You went ${r.wins}-${r.losses} as the ${ord(r.seed)} seed and fell to `, { team: lostTo.g.winner! }, ` in the ${lostTo.rd.name.toLowerCase()}.`]
            : [`You went ${r.wins}-${r.losses} as the ${ord(r.seed)} seed.`]
    out.push({ key: 'you', kind: 'you', when: 'you', a: me, b: lostTo?.g.winner ?? null, order: 2000, parts })
  }

  // Over the limit, the least telling go first; what is kept reads in the order it happened.
  const seen = new Set<string>()
  return out
    .filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)))
    .sort((a, b) => WEIGHT[b.kind] - WEIGHT[a.kind])
    .slice(0, limit)
    .sort((a, b) => a.order - b.order)
}
