import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { lockKey, simulateSeason, winProb, type SimTeam } from '../../../lib/fantasy/forecast'
import { seasonStories, simInputFor, simulateOnce, type Story, type Trace } from '../../../lib/fantasy/playoffSim'
import { useFantasy } from '../FantasyContext'
import { Bracket, CHAOS, Delta, Feed, Headline, LEVER_SIMS, SEED, SIMS, Standings, setupKey, type Chaos } from '../PlayoffLab'
import TeamName from '../TeamName'
import { Avatar, Button, Empty, PageHeader, Panel, Segmented, Stat, StatGrid, TabSection, Tabs, cx, fmt, odds, pct, usePhone } from '../ui'
import { OddsGrid } from './PowerView'

type Sub = 'race' | 'season' | 'seeds'
const SUBS: Sub[] = ['race', 'season', 'seeds']

/**
 * The playoff race, simulated. The race is everyone's odds from thousands of seasons played out; "What if" fixes
 * results in the weeks left and reruns the race as if they had happened; "Play a season" plays one season whole,
 * bracket and stories, under the same picks.
 */
const PlayoffsView = ({ sub, onSub }: { sub: string | null; onSub: (s: string) => void }) => {
  const { models, analysis } = useFantasy()
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'race'
  const stacked = usePhone()
  const f = models.forecast
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

  const baseline = useMemo(() => (f ? simulateSeason(simInputFor(input, f, { sims: SIMS, seed: SEED })) : {}), [input, f]) as Record<number, SimTeam>
  // Untouched, the scenario is the baseline: no second run of the same seasons.
  const scenario = useMemo(
    () => (f && (Object.keys(dLocks).length || dChaos !== 'normal') ? simulateSeason(simInputFor(input, f, { locks: dLocks, chaos: CHAOS[dChaos], sims: SIMS, seed: SEED })) : baseline),
    [input, f, dLocks, dChaos, baseline],
  ) as Record<number, SimTeam>
  const nLocks = Object.keys(locks).length
  const tweaked = nLocks > 0 || chaos !== 'normal'

  // What each result in the chosen week does to your playoff odds, a game at a time so taps never wait on it.
  const dWeek = useDeferredValue(week)
  const games = useMemo(() => input.schedule.filter((g) => g.week === week), [input.schedule, week])
  const [lever, setLever] = useState<Record<string, { a: number; b: number }>>({})
  useEffect(() => {
    setLever({})
    if (!f || me == null || dWeek == null) return
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
  const reset = () => {
    setLocks({})
    setChaos('normal')
  }

  // One season, played out on demand, with a running tally of how you did across the seasons played.
  const [run, setRun] = useState(0)
  const [trace, setTrace] = useState<{ t: Trace; stories: Story[]; setup: string } | null>(null)
  const [tally, setTally] = useState({ n: 0, in: 0, titles: 0 })
  const play = () => {
    if (!f) return
    const t = simulateOnce(simInputFor(input, f, { locks, chaos: CHAOS[chaos] }), Math.floor(Math.random() * 1e9))
    setTrace({ t, stories: seasonStories(t, me, 7), setup: setupKey(locks, chaos) })
    setRun((r) => r + 1)
    const mineRow = me != null ? t.standings.find((r) => r.rosterId === me) : null
    setTally((x) => ({ n: x.n + 1, in: x.in + (mineRow && mineRow.seed <= t.nPlayoff ? 1 : 0), titles: x.titles + (t.champion === me ? 1 : 0) }))
  }
  const stale = trace && trace.setup !== setupKey(locks, chaos)

  const rows = useMemo(
    () =>
      [...analysis.teams].map((t) => t.rosterId).sort((a, b) => (scenario[b]?.playoffs ?? 0) - (scenario[a]?.playoffs ?? 0) || (scenario[b]?.wins ?? 0) - (scenario[a]?.wins ?? 0)),
    [analysis.teams, scenario],
  )

  if (!f)
    return (
      <>
        <PageHeader title="Playoffs" />
        <div className="mt-4">
          <Empty title="No forecast yet">The playoff race needs Sleeper&apos;s projections for the weeks ahead.</Empty>
        </div>
      </>
    )

  const mine: SimTeam | undefined = me != null ? scenario[me] : undefined
  const base: SimTeam | undefined = me != null ? baseline[me] : undefined
  const likelySeed = mine ? mine.seeds.indexOf(Math.max(...mine.seeds.slice(1))) : null
  const fav = [...rows].sort((a, b) => (scenario[b]?.title ?? 0) - (scenario[a]?.title ?? 0))[0]
  const bubble = rows.filter((id) => !scenario[id]?.clinch).sort((a, b) => Math.abs((scenario[a]?.playoffs ?? 0) - 0.5) - Math.abs((scenario[b]?.playoffs ?? 0) - 0.5))[0]
  const chaosLabel = { calm: 'calm luck', normal: '', chaos: 'chaos luck' }[chaos]

  // ---- The race: everyone's odds, the scenario's change against the model beside each. ----
  const race = (
    <Panel
      title="The race"
      pad={false}
      actions={<span className={cx(pending && 'ff-pulse')}>{pending ? 'simulating…' : tweaked ? 'change vs the model' : `${SIMS.toLocaleString()} seasons`}</span>}
    >
      <p className="border-b border-ff-line px-3 py-2 text-[12.5px] leading-[1.5] text-ff-text2">
        {fav != null && (
          <>
            <TeamName id={fav} avatar={false} plain className="font-medium" /> {(scenario[fav]?.title ?? 0) >= 0.25 ? 'is the clear title favorite' : 'leads an open title race'} at{' '}
            {pct(scenario[fav]?.title ?? 0)}.{' '}
          </>
        )}
        {bubble != null && (
          <>
            On the line: <TeamName id={bubble} avatar={false} plain className="font-medium" />, {odds(scenario[bubble]?.playoffs ?? 0)} to get in.
          </>
        )}
      </p>
      <div className="ff-scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr className="ff-label">
              <th className="sticky left-0 z-10 h-7 border-b border-ff-line bg-ff-panel pl-3 pr-2 text-left font-normal">team</th>
              <th className="hidden h-7 border-b border-ff-line px-2 text-left font-normal sm:table-cell" title="Chance of each finishing seed, 1 on the left">
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
              return (
                <tr key={id} className={cx(i === nPlayoff - 1 && '[&>td]:border-dashed [&>td]:border-b-ff-line2')}>
                  <td className="sticky left-0 z-[1] h-8 border-b border-ff-line/60 bg-ff-panel pl-3 pr-2">
                    <span className="flex max-w-[180px]">
                      <TeamName id={id} size={16} />
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
                        <span className="block h-full origin-left bg-ff-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${s?.playoffs ?? 0})` }} />
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
        Teams above the dashed rule make the playoffs ({nPlayoff} of {analysis.teams.length}). Seed cells shade by chance.
        {tweaked ? ' Green and red are the change your what-ifs make, in points.' : ''}
      </p>
    </Panel>
  )

  // ---- What if: fix results in the weeks left. ----
  const whatIf = (
    <Panel title="What if…" pad={false} actions={nLocks ? <span className="text-ff-accent">{nLocks} picked</span> : <span>no picks yet</span>}>
      <p className="border-b border-ff-line px-3 py-2.5 text-[12.5px] leading-[1.5] text-ff-text2">
        Choose who wins games not played yet. <b className="font-medium text-ff-text">The race reruns as if those results happened</b>, and shows how every team&apos;s odds
        move. Tap a team to make it the winner; tap again to undo.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ff-line px-3 py-2">
        <span className="flex items-center gap-2">
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
        </span>
        {me != null && myGames.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="ff-label">You</span>
            <Button size="sm" onClick={() => allMine(true)}>
              Win out
            </Button>
            <Button size="sm" onClick={() => allMine(false)}>
              Lose out
            </Button>
          </span>
        )}
        {tweaked && (
          <Button size="sm" variant="ghost" onClick={reset} className="ml-auto">
            Reset
          </Button>
        )}
      </div>
      {weeks.length === 0 ? (
        <p className="px-3 py-3 text-[12.5px] text-ff-muted">The regular season is over: the seeds are set. Play out the bracket under Play a season.</p>
      ) : (
        <>
          <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-ff-line px-3 py-2 [mask-image:linear-gradient(to_right,black_90%,transparent)]" role="tablist" aria-label="Week">
            {weeks.map((w) => {
              const n = input.schedule.filter((g) => g.week === w && locks[lockKey(g)] !== undefined).length
              return (
                <button
                  key={w}
                  role="tab"
                  aria-selected={w === week}
                  onClick={() => setWeek(w)}
                  className={cx(
                    'ff-press relative h-7 min-w-[44px] shrink-0 border px-2 font-mono text-[11px]',
                    w === week ? 'border-ff-text bg-ff-text text-ff-panel' : 'border-ff-line text-ff-text2 hover:border-ff-line2',
                  )}
                >
                  wk {w}
                  {n > 0 && (
                    <span className="absolute -right-px -top-px flex h-3.5 min-w-3.5 items-center justify-center bg-ff-accent px-0.5 text-[9px] leading-none text-white" aria-label={`${n} picked`}>
                      {n}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
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
                      on ? 'border-ff-accent bg-ff-accent/10' : off ? 'border-ff-line bg-ff-sunken/50 opacity-60' : 'border-ff-line bg-ff-panel hover:border-ff-line2 hover:bg-ff-raised/50',
                    )}
                  >
                    <Avatar src={t?.avatar ?? null} name={t?.name ?? '?'} size={22} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className={cx('block truncate text-[12.5px]', id === me ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t?.name}</span>
                      <span className="num block text-[10.5px] text-ff-muted">{on ? '✓ wins' : off ? 'loses' : `${pct(p)} to win`}</span>
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
                      <span className={cx('num', lv.a > lv.b ? 'text-ff-pos' : 'text-ff-neg')}>you {odds(lv.a)}</span>
                      <span className="text-center">your playoff odds if each wins</span>
                      <span className={cx('num text-right', lv.b > lv.a ? 'text-ff-pos' : 'text-ff-neg')}>you {odds(lv.b)}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Panel>
  )

  // ---- One season, played out whole. ----
  const season = (
    <Panel title="Play a season" pad={false} actions={trace ? <span className="num">season #{trace.t.seed.toString(36).toUpperCase()}</span> : <span>one draw of many</span>}>
      <div className="flex flex-wrap items-center gap-3 border-b border-ff-line px-3 py-2.5">
        <Button variant="primary" onClick={play} className="ff-press">
          {trace ? 'Play another season' : 'Play out a season'}
        </Button>
        <span className="min-w-0 flex-1 text-[12px] text-ff-muted">
          {stale
            ? 'Your what-ifs changed since this season. Play again to use them.'
            : `Plays every game left once, then the bracket${nLocks || chaosLabel ? `, with ${[nLocks ? `your ${nLocks} pick${nLocks === 1 ? '' : 's'}` : '', chaosLabel].filter(Boolean).join(' and ')}` : ''}. The race is thousands of these averaged; any one is unlikely, which is the fun.`}
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
        <div className="grid gap-3 px-3 py-8 text-center text-[12.5px] text-ff-muted">
          <span className="mx-auto flex gap-1" aria-hidden>
            {analysis.teams.slice(0, 6).map((t) => (
              <Avatar key={t.rosterId} src={t.avatar} name={t.name} size={24} />
            ))}
          </span>
          Final standings, a bracket, and the stories of one simulated season.
        </div>
      )}
    </Panel>
  )

  return (
    <>
      <PageHeader
        title="Playoffs"
        meta={`top ${nPlayoff} of ${analysis.teams.length} make it${weeks.length ? ` · ${weeks.length} weeks left` : ''}`}
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={onSub}
            stacked={stacked}
            items={[
              { key: 'race', label: 'The race', mark: nLocks ? `${nLocks} picks` : undefined },
              { key: 'season', label: 'Play a season' },
              { key: 'seeds', label: 'Every seed' },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        <TabSection id="race" label="The race" active={tab === 'race'} stacked={stacked} bare>
          {mine && me != null && (
            <StatGrid>
              <Stat
                label="Your playoff odds"
                value={odds(mine.playoffs, 0, mine.clinch)}
                meter={mine.playoffs}
                badge={tweaked && base ? { text: `${Math.round((mine.playoffs - base.playoffs) * 100) >= 0 ? '+' : ''}${Math.round((mine.playoffs - base.playoffs) * 100)} with what-ifs`, tone: mine.playoffs >= base.playoffs ? 'pos' : 'neg' } : undefined}
                sub={`${fmt(mine.wins)} wins on average`}
              />
              <Stat label="Bye" value={odds(mine.bye)} sub="a top seed, skipping round one" />
              <Stat label="Title" value={odds(mine.title, mine.title < 0.1 ? 1 : 0)} sub={`final ${odds(mine.final)}`} />
              <Stat label="Most likely seed" value={likelySeed ? `#${likelySeed}` : '–'} sub={likelySeed ? `${pct(mine.seeds[likelySeed])} of seasons` : undefined} />
            </StatGrid>
          )}
          {tweaked && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-ff-accent/40 bg-ff-accent/[0.06] px-3 py-2 text-[12.5px] text-ff-text2">
              <span className="ff-label text-ff-accent">Scenario</span>
              <span className="min-w-0 flex-1">
                {[nLocks ? `${nLocks} result${nLocks === 1 ? '' : 's'} picked` : '', chaosLabel].filter(Boolean).join(' · ')}. Odds below are as if these happened.
              </span>
              <Button size="sm" variant="ghost" onClick={reset}>
                Back to the model
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            {race}
            {whatIf}
          </div>
        </TabSection>
        <TabSection id="season" label="Play a season" active={tab === 'season'} stacked={stacked} bare>
          {season}
        </TabSection>
        <TabSection id="seeds" label="Every seed" active={tab === 'seeds'} stacked={stacked} bare>
          <OddsGrid onTeam={() => {}} />
        </TabSection>
      </div>
    </>
  )
}

export default PlayoffsView
