import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { lockKey, simulateSeason, winProb, type SimTeam } from '../../lib/fantasy/forecast'
import { seasonStories, simInputFor, simulateOnce, type BracketGame, type Story, type Trace } from '../../lib/fantasy/playoffSim'
import { useFantasy } from './FantasyContext'
import { Avatar, Button, Panel, Segmented, cx, fmt, odds, pct } from './ui'

const SIMS = 2000
/** The odds and every what-if share one stream of draws, so a difference is the pick and not the dice. */
const SEED = 11
const LEVER_SIMS = 600

type Chaos = 'calm' | 'normal' | 'chaos'
const CHAOS: Record<Chaos, number> = { calm: 0.7, normal: 1, chaos: 1.5 }
/** The picks and luck a season was played under, compared by content so undoing a pick is no change. */
const setupKey = (locks: Record<string, number>, chaos: Chaos) =>
  `${chaos}|${Object.entries(locks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`

/** A change in a probability, in points: "+12", "−3", nothing when it rounds to zero. */
const Delta = ({ v, className }: { v: number; className?: string }) => {
  const n = Math.round(v * 100)
  if (!n) return <span className={cx('num inline-block w-8 text-right text-[10.5px] text-ff-muted/0', className)}>0</span>
  return <span className={cx('num inline-block w-8 text-right text-[10.5px]', n > 0 ? 'text-ff-pos' : 'text-ff-neg', className)}>{n > 0 ? `+${n}` : `−${-n}`}</span>
}

/** Two managers squaring off: the winner, then the other, dimmed. One avatar for a story about one team. */
const FaceOff = ({ a, b }: { a: number; b: number | null }) => {
  const { analysis } = useFantasy()
  const A = analysis.teamById[a]
  const B = b != null ? analysis.teamById[b] : null
  return (
    <span aria-hidden className="flex w-[60px] shrink-0 items-center gap-1 pt-0.5">
      <Avatar src={A?.avatar ?? null} name={A?.name ?? '?'} size={22} />
      {B && (
        <>
          <span className="font-mono text-[8.5px] uppercase text-ff-muted">vs</span>
          <span className="opacity-55 grayscale-[0.6]">
            <Avatar src={B.avatar} name={B.name} size={22} />
          </span>
        </>
      )}
    </span>
  )
}

const KIND: Record<Story['kind'], { label: string; tone: string }> = {
  title: { label: 'TITLE', tone: 'text-ff-accent' },
  upset: { label: 'UPSET', tone: 'text-ff-warn' },
  escape: { label: 'ESCAPE', tone: 'text-ff-text2' },
  bubble: { label: 'THE LINE', tone: 'text-ff-warn' },
  thriller: { label: 'THRILLER', tone: 'text-ff-text2' },
  rout: { label: 'ROUT', tone: 'text-ff-neg' },
  streak: { label: 'HOT', tone: 'text-ff-pos' },
  slump: { label: 'COLD', tone: 'text-ff-neg' },
  you: { label: 'YOU', tone: 'text-ff-accent' },
}

const StoryText = ({ s }: { s: Story }) => {
  const { analysis } = useFantasy()
  return (
    <>
      {s.parts.map((p, i) =>
        typeof p === 'string' ? (
          <React.Fragment key={i}>{p}</React.Fragment>
        ) : (
          <b key={i} className={cx('font-medium', p.team === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')}>
            {analysis.teamById[p.team]?.name ?? `#${p.team}`}
          </b>
        ),
      )}
    </>
  )
}

/** The season's stories as a short feed, each line revealed in turn. */
const Feed = ({ stories, run }: { stories: Story[]; run: number }) => (
  <ol className="divide-y divide-ff-line/60">
    {stories.map((s, i) => (
      <li
        key={`${run}:${s.key}`}
        className={cx(
          'ff-rise grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-3 py-2.5',
          s.kind === 'you' && 'bg-ff-accent/[0.06] shadow-[inset_2px_0_0_rgb(var(--ff-accent))]',
        )}
        style={{ animationDelay: `${100 + i * 100}ms` }}
      >
        <FaceOff a={s.a} b={s.b} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 font-mono text-[10px] tracking-[0.06em]">
            <span className={KIND[s.kind].tone}>{KIND[s.kind].label}</span>
            <span className="text-ff-muted">{s.when}</span>
          </div>
          <p className="mt-0.5 text-[13px] leading-[1.45] text-ff-text2">
            <StoryText s={s} />
          </p>
        </div>
      </li>
    ))}
  </ol>
)

/** One bracket game: both sides with seed and score, the winner lit. */
const Match = ({ g }: { g: BracketGame }) => {
  const { analysis } = useFantasy()
  const side = (id: number | null, seed: number | null, pts: number | null) => {
    const t = id != null ? analysis.teamById[id] : null
    const won = id != null && g.winner === id && g.a != null && g.b != null
    return (
      <div className={cx('flex h-7 items-center gap-1.5 px-2 text-[12px]', won ? 'text-ff-text' : 'text-ff-muted')}>
        <span className="num w-3.5 shrink-0 text-right text-[10px] text-ff-muted">{seed ?? ''}</span>
        {t ? <Avatar src={t.avatar} name={t.name} size={16} /> : <span className="h-4 w-4 shrink-0" />}
        <span className={cx('min-w-0 flex-1 truncate', won && 'font-medium', id === analysis.myRosterId && 'text-ff-accent')}>{t?.name ?? 'bye'}</span>
        {pts != null && <span className={cx('num shrink-0 text-[11.5px]', won ? 'text-ff-text' : 'text-ff-muted')}>{fmt(pts)}</span>}
      </div>
    )
  }
  if (g.a == null || g.b == null)
    return (
      <div className="border border-dashed border-ff-line bg-ff-panel">
        {side(g.a ?? g.b, g.a != null ? g.seedA : g.seedB, null)}
        <div className="flex h-5 items-center px-2 font-mono text-[10px] text-ff-muted">bye</div>
      </div>
    )
  return (
    <div className="divide-y divide-ff-line/60 border border-ff-line bg-ff-panel">
      {side(g.a, g.seedA, g.sa)}
      {side(g.b, g.seedB, g.sb)}
    </div>
  )
}

/** The bracket, a column per round, revealed round by round. */
const Bracket = ({ t, run }: { t: Trace; run: number }) => {
  const { analysis } = useFantasy()
  const champ = t.champion != null ? analysis.teamById[t.champion] : null
  return (
    <div className="ff-scroll overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-3 p-3">
        {t.rounds.map((rd, i) => (
          <div key={`${run}:${i}`} className="ff-rise flex w-[160px] flex-col" style={{ animationDelay: `${100 + i * 100}ms` }}>
            <div className="ff-label mb-1.5 flex justify-between">
              <span>{rd.name}</span>
              <span className="num">wk {rd.week}</span>
            </div>
            <div className="flex flex-1 flex-col justify-around gap-2">
              {rd.games.map((g, j) => (
                <Match key={j} g={g} />
              ))}
            </div>
          </div>
        ))}
        {champ && (
          <div key={`${run}:champ`} className="ff-rise flex w-[112px] flex-col" style={{ animationDelay: `${100 + t.rounds.length * 100}ms` }}>
            <div className="ff-label mb-1.5">Champion</div>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 border border-ff-accent/50 bg-ff-accent/[0.07] px-2 py-3 text-center">
              <Avatar src={champ.avatar} name={champ.name} size={40} />
              <span className={cx('line-clamp-2 text-[12.5px] font-medium leading-tight', t.champion === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')}>
                {champ.name}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The season in one line: who won it, how you did, and your tally across the seasons played. */
const Headline = ({ t, run, tally }: { t: Trace; run: number; tally: { n: number; in: number; titles: number } }) => {
  const { analysis } = useFantasy()
  const me = analysis.myRosterId
  const champ = t.champion != null ? analysis.teamById[t.champion] : null
  const mine = me != null ? t.standings.find((r) => r.rosterId === me) : null
  return (
    <div key={run} className="ff-rise flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ff-line bg-ff-sunken/40 px-3 py-2.5">
      {champ && (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar src={champ.avatar} name={champ.name} size={32} />
          <span className="min-w-0 leading-tight">
            <span className="ff-label block">Champion</span>
            <span className={cx('block truncate text-[15px] font-medium', t.champion === me ? 'text-ff-accent' : 'text-ff-text')}>
              {t.champion === me ? 'You won it all' : champ.name}
            </span>
          </span>
        </span>
      )}
      {mine && (
        <span className="leading-tight">
          <span className="ff-label block">You</span>
          <span className="num text-[13px] text-ff-text">
            {mine.wins}-{mine.losses} · seed {mine.seed}
            <span className={cx('ml-1.5 font-sans text-[12px]', mine.seed <= t.nPlayoff ? 'text-ff-pos' : 'text-ff-neg')}>{mine.seed <= t.nPlayoff ? 'in' : 'out'}</span>
          </span>
        </span>
      )}
      {me != null && tally.n > 1 && (
        <span className="ml-auto text-right leading-tight">
          <span className="ff-label block">This visit</span>
          <span className="num text-[12px] text-ff-text2">
            {tally.n} seasons · in {tally.in} · {tally.titles} {tally.titles === 1 ? 'title' : 'titles'}
          </span>
        </span>
      )}
    </div>
  )
}

/** Final standings of the season played out, the playoff line drawn under the last seed in. */
const Standings = ({ t }: { t: Trace }) => {
  const { analysis } = useFantasy()
  return (
    <ol className="text-[12px]">
      {t.standings.map((r) => {
        const team = analysis.teamById[r.rosterId]
        const gained = r.wins - r.was.wins
        const played = gained + r.losses - r.was.losses
        return (
          <li
            key={r.rosterId}
            className={cx('flex h-7 items-center gap-2 px-3', r.seed === t.nPlayoff ? 'border-b border-dashed border-ff-line2' : 'border-b border-ff-line/50 last:border-0')}
          >
            <span className="num w-4 text-right text-[10.5px] text-ff-muted">{r.seed}</span>
            <Avatar src={team?.avatar ?? null} name={team?.name ?? '?'} size={16} />
            <span
              className={cx('min-w-0 flex-1 truncate', r.rosterId === analysis.myRosterId ? 'font-medium text-ff-accent' : r.seed <= t.nPlayoff ? 'text-ff-text' : 'text-ff-muted')}
            >
              {team?.name}
            </span>
            <span className="num w-10 text-right text-ff-text">
              {r.wins}-{r.losses}
            </span>
            <span className="num hidden w-10 whitespace-nowrap text-right text-[10.5px] text-ff-muted sm:inline" title={`Went ${gained}-${played - gained} in the simulated weeks`}>
              {played ? `${gained}-${played - gained}` : ''}
            </span>
            <span className="num w-12 text-right text-[10.5px] text-ff-muted">{Math.round(r.pf).toLocaleString()}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The playoff simulator. The odds are thousands of seasons averaged; here you can pick results in the weeks left and
 * watch every team's odds move, turn the randomness up or down, and play out single seasons to see how one goes:
 * the standings, the bracket, and the stories in it.
 */
const PlayoffLab = () => {
  const { models, analysis } = useFantasy()
  const f = models.forecast!
  const input = models.forecastInput
  const me = analysis.myRosterId
  const nPlayoff = Math.min(input.playoffTeams, analysis.teams.length)

  const weeks = useMemo(() => [...new Set(input.schedule.map((g) => g.week))].sort((a, b) => a - b), [input.schedule])
  const [week, setWeek] = useState<number | null>(weeks[0] ?? null)
  const [locks, setLocks] = useState<Record<string, number>>({})
  const [chaos, setChaos] = useState<Chaos>('normal')
  // Picks land at once; the simulations behind them run in a deferred render a beat later.
  const dLocks = useDeferredValue(locks)
  const dChaos = useDeferredValue(chaos)
  const pending = dLocks !== locks || dChaos !== chaos

  const baseline = useMemo(() => simulateSeason(simInputFor(input, f, { sims: SIMS, seed: SEED })), [input, f])
  // Untouched, the scenario is the baseline: no second run of the same seasons.
  const scenario = useMemo(
    () => (Object.keys(dLocks).length || dChaos !== 'normal' ? simulateSeason(simInputFor(input, f, { locks: dLocks, chaos: CHAOS[dChaos], sims: SIMS, seed: SEED })) : baseline),
    [input, f, dLocks, dChaos, baseline],
  )
  const nLocks = Object.keys(locks).length
  const tweaked = nLocks > 0 || chaos !== 'normal'

  // What each result in the chosen week does to your playoff odds, on top of the picks already made.
  const dWeek = useDeferredValue(week)
  const games = useMemo(() => input.schedule.filter((g) => g.week === week), [input.schedule, week])
  // Run a game at a time, yielding to the page between games, so a tap is never stuck behind them.
  const [lever, setLever] = useState<Record<string, { a: number; b: number }>>({})
  useEffect(() => {
    setLever({})
    if (me == null || dWeek == null) return
    let live = true
    const out: Record<string, { a: number; b: number }> = {}
    ;(async () => {
      for (const g of input.schedule.filter((x) => x.week === dWeek)) {
        await new Promise<void>((r) => window.setTimeout(r, 0))
        if (!live) return
        const k = lockKey(g)
        const run = (w: number) => simulateSeason(simInputFor(input, f, { locks: { ...dLocks, [k]: w }, chaos: CHAOS[dChaos], sims: LEVER_SIMS, seed: SEED }))[me]?.playoffs ?? 0
        out[k] = { a: run(g.a), b: run(g.b) }
        setLever({ ...out })
      }
    })()
    return () => {
      live = false
    }
  }, [me, dWeek, input, f, dLocks, dChaos])

  const pick = (g: { week: number; a: number; b: number }, w: number) =>
    setLocks((L) => {
      const k = lockKey(g)
      const next = { ...L }
      if (next[k] === w) delete next[k]
      else next[k] = w
      return next
    })
  const myGames = me == null ? [] : input.schedule.filter((g) => g.a === me || g.b === me)
  const allMine = (win: boolean) =>
    setLocks((L) => {
      const next = { ...L }
      for (const g of myGames) next[lockKey(g)] = win ? me! : g.a === me ? g.b : g.a
      return next
    })

  // One season, played out on demand.
  const [run, setRun] = useState(0)
  const [trace, setTrace] = useState<{ t: Trace; stories: Story[]; setup: string } | null>(null)
  // A running tally of the seasons played this visit: how often you got in, and how often you won it all.
  const [tally, setTally] = useState({ n: 0, in: 0, titles: 0 })
  const play = () => {
    const seed = Math.floor(Math.random() * 1e9)
    const t = simulateOnce(simInputFor(input, f, { locks, chaos: CHAOS[chaos] }), seed)
    setTrace({ t, stories: seasonStories(t, me, 7), setup: setupKey(locks, chaos) })
    setRun((r) => r + 1)
    const mineRow = me != null ? t.standings.find((r) => r.rosterId === me) : null
    setTally((x) => ({ n: x.n + 1, in: x.in + (mineRow && mineRow.seed <= t.nPlayoff ? 1 : 0), titles: x.titles + (t.champion === me ? 1 : 0) }))
  }
  const stale = trace && trace.setup !== setupKey(locks, chaos)

  const name = (id: number) => analysis.teamById[id]?.name ?? `#${id}`
  const rows = useMemo(
    () =>
      [...analysis.teams].map((t) => t.rosterId).sort((a, b) => (scenario[b]?.playoffs ?? 0) - (scenario[a]?.playoffs ?? 0) || (scenario[b]?.wins ?? 0) - (scenario[a]?.wins ?? 0)),
    [analysis.teams, scenario],
  )
  // The headline: the favorite, the coin flip at the line, and you.
  const fav = [...rows].sort((a, b) => (scenario[b]?.title ?? 0) - (scenario[a]?.title ?? 0))[0]
  const bubble = rows.filter((id) => !scenario[id]?.clinch).sort((a, b) => Math.abs((scenario[a]?.playoffs ?? 0) - 0.5) - Math.abs((scenario[b]?.playoffs ?? 0) - 0.5))[0]
  const mine: SimTeam | undefined = me != null ? scenario[me] : undefined

  return (
    <section className="space-y-3" aria-label="Playoff simulator">
      {/* Controls: how random the season is, and the picks made so far. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-ff-line bg-ff-panel px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-medium text-ff-text">Playoff simulator</h2>
          <p className="text-[11.5px] text-ff-muted">Pick results, change the luck, play out a season. Odds rerun {SIMS.toLocaleString()} seasons on every change.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="ff-label">Luck</span>
          <Segmented<Chaos>
            size="sm"
            label="Luck"
            value={chaos}
            onChange={setChaos}
            options={[
              { key: 'calm', label: 'Calm', title: 'Less weekly randomness: the better team wins more often' },
              { key: 'normal', label: 'Normal', title: 'Randomness as measured in this league' },
              { key: 'chaos', label: 'Chaos', title: 'Half again as much randomness: anything can happen' },
            ]}
          />
        </div>
        {tweaked && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLocks({})
              setChaos('normal')
            }}
          >
            Reset{nLocks ? ` ${nLocks} pick${nLocks === 1 ? '' : 's'}` : ''}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Everyone's odds under the picks, against the model's. */}
        <Panel
          title={tweaked ? 'Odds, your scenario' : 'Odds'}
          pad={false}
          actions={<span className={cx(pending && 'ff-pulse')}>{pending ? 'simulating…' : tweaked ? 'change vs the model' : `${SIMS.toLocaleString()} seasons`}</span>}
        >
          <p className="border-b border-ff-line px-3 py-2 text-[12.5px] leading-[1.5] text-ff-text2">
            {fav != null && (
              <>
                <b className="font-medium text-ff-text">{name(fav)}</b> {fav === me ? '(you) ' : ''}
                {(scenario[fav]?.title ?? 0) >= 0.25 ? 'is the clear title favorite' : 'leads a wide-open title race'} at {pct(scenario[fav]?.title ?? 0)}.{' '}
              </>
            )}
            {bubble != null && (
              <>
                The coin flip is <b className="font-medium text-ff-text">{name(bubble)}</b> at {odds(scenario[bubble]?.playoffs ?? 0)} to get in.{' '}
              </>
            )}
            {mine && me != null && (
              <>
                You: <span className="num text-ff-text">{odds(mine.playoffs, 0, mine.clinch)}</span> playoffs
                {tweaked && <Delta v={mine.playoffs - (baseline[me]?.playoffs ?? 0)} className="w-auto pl-1" />}, {fmt(mine.wins)} wins on average.
              </>
            )}
          </p>
          <div className="ff-scroll overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr className="ff-label">
                  <th className="sticky left-0 z-10 h-7 border-b border-ff-line bg-ff-panel pl-3 pr-2 text-left font-normal">team</th>
                  <th className="hidden h-7 border-b border-ff-line px-2 text-left font-normal sm:table-cell" title="Probability of each finishing seed, 1 to the left">
                    seed 1 → {analysis.teams.length}
                  </th>
                  <th className="h-7 border-b border-ff-line px-2 text-right font-normal">wins</th>
                  <th className="h-7 border-b border-ff-line px-2 text-right font-normal">playoffs</th>
                  <th className="h-7 border-b border-ff-line pl-2 pr-3 text-right font-normal">title</th>
                </tr>
              </thead>
              <tbody className={cx('transition-opacity duration-150', pending && 'opacity-70')}>
                {rows.map((id, i) => {
                  const s = scenario[id]
                  const b = baseline[id]
                  const t = analysis.teamById[id]
                  return (
                    <tr key={id} className={cx(i === nPlayoff - 1 && '[&>td]:border-b-ff-line2 [&>td]:border-dashed')}>
                      <td className="sticky left-0 z-[1] h-8 border-b border-ff-line/60 bg-ff-panel pl-3 pr-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Avatar src={t?.avatar ?? null} name={t?.name ?? '?'} size={16} />
                          <span className={cx('max-w-[140px] truncate', id === me ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t?.name}</span>
                        </span>
                      </td>
                      <td className="hidden h-8 border-b border-ff-line/60 px-2 sm:table-cell">
                        <span className="flex gap-px" aria-label={`Most likely seed ${s ? s.seeds.indexOf(Math.max(...s.seeds.slice(1))) : '–'}`}>
                          {(s?.seeds.slice(1) ?? []).map((p, k) => (
                            <span
                              key={k}
                              title={`${pct(p, 1)} to finish ${k + 1}`}
                              className={cx('h-3.5 w-2.5 transition-colors duration-300', k + 1 === nPlayoff && 'mr-[3px]')}
                              style={{ background: p > 0.004 ? `rgb(var(--ff-accent) / ${Math.min(0.95, 0.1 + p * 1.6).toFixed(2)})` : 'rgb(var(--ff-line) / 0.5)' }}
                            />
                          ))}
                        </span>
                      </td>
                      <td className="num h-8 border-b border-ff-line/60 px-2 text-right text-ff-text2">{fmt(s?.wins)}</td>
                      <td className="h-8 whitespace-nowrap border-b border-ff-line/60 px-2 text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span className="hidden h-1 w-12 bg-ff-line md:inline-block" aria-hidden>
                            <span
                              className="block h-full origin-left bg-ff-accent transition-transform duration-300 ease-out"
                              style={{ transform: `scaleX(${s?.playoffs ?? 0})` }}
                            />
                          </span>
                          <span className="num w-10 text-right text-ff-text">{odds(s?.playoffs, 0, s?.clinch)}</span>
                          {tweaked && <Delta v={(s?.playoffs ?? 0) - (b?.playoffs ?? 0)} />}
                        </span>
                      </td>
                      <td className="h-8 whitespace-nowrap border-b border-ff-line/60 pl-2 pr-3 text-right">
                        <span className="num inline-block w-10 text-right text-ff-text2">{odds(s?.title, (s?.title ?? 0) < 0.1 ? 1 : 0)}</span>
                        {tweaked && <Delta v={(s?.title ?? 0) - (b?.title ?? 0)} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
            The dashed rule is the playoff line ({nPlayoff} teams). Seed cells shade by probability. Changes are in points against the model&apos;s own odds, on the same draws.
          </p>
        </Panel>

        {/* Pick results: tap a side to lock its win; tap again to let the dice decide. */}
        <Panel title="Pick results" pad={false} actions={nLocks ? <span className="text-ff-accent">{nLocks} locked</span> : <span>tap a team to lock its win</span>}>
          {weeks.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-ff-muted">The regular season is over: the seeds are set. Play out the bracket below.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-ff-line px-3 py-2">
                <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Week">
                  {weeks.map((w) => {
                    const n = input.schedule.filter((g) => g.week === w && locks[lockKey(g)] !== undefined).length
                    return (
                      <button
                        key={w}
                        role="tab"
                        aria-selected={w === week}
                        onClick={() => setWeek(w)}
                        className={cx(
                          'ff-press relative h-7 min-w-[40px] shrink-0 border px-2 font-mono text-[11px]',
                          w === week ? 'border-ff-text bg-ff-text text-ff-panel' : 'border-ff-line text-ff-text2 hover:border-ff-line2',
                        )}
                      >
                        {w}
                        {n > 0 && <span className={cx('absolute -right-px -top-px h-1.5 w-1.5', w === week ? 'bg-ff-accent' : 'bg-ff-accent')} aria-label={`${n} picked`} />}
                      </button>
                    )
                  })}
                </div>
              </div>
              {me != null && myGames.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-ff-line px-3 py-2 text-[12px]">
                  <span className="text-ff-muted">Your games:</span>
                  <Button size="sm" onClick={() => allMine(true)}>
                    Win out
                  </Button>
                  <Button size="sm" onClick={() => allMine(false)}>
                    Lose out
                  </Button>
                </div>
              )}
              <ul className="divide-y divide-ff-line/60">
                {games.map((g) => {
                  const k = lockKey(g)
                  const locked = locks[k]
                  const pA = f.nextWeek.find((x) => x.week === g.week && x.a === g.a && x.b === g.b)?.pA ?? winProb(f.mean(g.a, g.week), f.mean(g.b, g.week), f.sigma)
                  const lv = lever[k]
                  const side = (id: number, p: number, align: 'left' | 'right') => {
                    const t = analysis.teamById[id]
                    const on = locked === id
                    const off = locked !== undefined && !on
                    return (
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => pick(g, id)}
                        className={cx(
                          'ff-press flex min-h-[44px] min-w-0 flex-1 items-center gap-2 border px-2 py-1.5 text-left',
                          align === 'right' && 'flex-row-reverse text-right',
                          on
                            ? 'border-ff-accent bg-ff-accent/10'
                            : off
                              ? 'border-ff-line bg-ff-sunken/50 opacity-60'
                              : 'border-ff-line bg-ff-panel hover:border-ff-line2 hover:bg-ff-raised/50',
                        )}
                      >
                        <Avatar src={t?.avatar ?? null} name={t?.name ?? '?'} size={22} />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className={cx('block truncate text-[12.5px]', id === me ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t?.name}</span>
                          <span className="num block text-[10.5px] text-ff-muted">{on ? 'wins · locked' : off ? 'loses' : `${pct(p)} to win`}</span>
                        </span>
                      </button>
                    )
                  }
                  return (
                    <li key={k} className="px-3 py-2">
                      <div className="flex items-stretch gap-1.5">
                        {side(g.a, pA, 'left')}
                        <span className="flex w-6 shrink-0 items-center justify-center font-mono text-[10px] text-ff-muted">vs</span>
                        {side(g.b, 1 - pA, 'right')}
                      </div>
                      {lv && me != null && Math.abs(lv.a - lv.b) >= 0.01 && (
                        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 font-mono text-[10.5px] text-ff-muted">
                          <span className={cx('num', lv.a > lv.b ? 'text-ff-pos' : 'text-ff-neg')}>{odds(lv.a)}</span>
                          <span className="text-center">← your playoff odds →</span>
                          <span className={cx('num text-right', lv.b > lv.a ? 'text-ff-pos' : 'text-ff-neg')}>{odds(lv.b)}</span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Panel>
      </div>

      {/* One season, played out. */}
      <Panel
        title="One season, played out"
        pad={false}
        actions={trace ? <span className="num">season #{trace.t.seed.toString(36).toUpperCase()}</span> : <span>one draw of many</span>}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-ff-line px-3 py-2.5">
          <Button variant="primary" onClick={play} className="ff-press">
            {trace ? 'Play another season' : 'Play out a season'}
          </Button>
          <span className="min-w-0 flex-1 text-[12px] text-ff-muted">
            {stale
              ? 'Your picks changed since this season. Play again to use them.'
              : trace
                ? `Every game left, then the bracket${nLocks ? `, with your ${nLocks} pick${nLocks === 1 ? '' : 's'} locked` : ''}. Any one season is unlikely; that is the fun.`
                : 'Simulates every game left and the playoffs once, with your picks, and tells you what happened.'}
          </span>
        </div>
        {trace && <Headline t={trace.t} run={run} tally={tally} />}
        {trace ? (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="border-b border-ff-line lg:border-b-0 lg:border-r">
              <div className="ff-label px-3 pb-1 pt-2.5">What happened</div>
              <Feed stories={trace.stories} run={run} />
            </div>
            <div className="min-w-0">
              <div className="ff-label px-3 pt-2.5">Bracket</div>
              <Bracket t={trace.t} run={run} />
              <div className="border-t border-ff-line">
                <div className="ff-label flex justify-between px-3 pb-1 pt-2.5">
                  <span>Final standings</span>
                  <span>
                    record<span className="hidden sm:inline"> · rest of season</span> · pts
                  </span>
                </div>
                <Standings t={trace.t} />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 px-3 py-6 text-center text-[12.5px] text-ff-muted">
            <span className="mx-auto flex gap-1" aria-hidden>
              {analysis.teams.slice(0, 6).map((t) => (
                <Avatar key={t.rosterId} src={t.avatar} name={t.name} size={24} />
              ))}
            </span>
            Standings, a bracket and the stories of one simulated season.
          </div>
        )}
      </Panel>
    </section>
  )
}

export default PlayoffLab
