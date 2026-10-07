import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ELO, EFFICIENCY_PRIOR_GAMES, FORM_PRIOR_GAMES, FORM_WEIGHT, SIM, type BacktestModel, type BacktestScore } from '../../../lib/fantasy/forecast'
import { gradeSnapshots, loadSnapshots, MARKET_WEIGHT, MEDIAN_TO_MEAN } from '../../../lib/fantasy/lines'
import { useFantasy } from '../FantasyContext'
import { Badge, Num, Panel, Stat, StatGrid, Table, cx, fmt, fmtSigned, pct } from '../ui'

// ---------- System map ----------

type NodeId =
  | 'lines'
  | 'proj'
  | 'results'
  | 'history'
  | 'schedule'
  | 'tx'
  | 'ecr'
  | 'avail'
  | 'horizon'
  | 'lineup'
  | 'market'
  | 'war'
  | 'trades'
  | 'rating'
  | 'elo'
  | 'composite'
  | 'sim'
  | 'behavior'
  | 'perceived'
  | 'cards'
  | 'power'
  | 'odds'
  | 'backtest'

type MapNode = { id: NodeId; col: number; label: string; stat: string; tab?: string; note: string }

const COLS = ['sources', 'adjust', 'core', 'models', 'outputs']

/** Edges: what each node feeds. The map is drawn from this list and nothing else. */
const EDGES: [NodeId, NodeId][] = [
  ['lines', 'avail'],
  ['lines', 'backtest'],
  ['proj', 'avail'],
  ['history', 'avail'],
  ['schedule', 'avail'],
  ['avail', 'horizon'],
  ['horizon', 'lineup'],
  ['lineup', 'market'],
  ['lineup', 'trades'],
  ['market', 'trades'],
  ['lineup', 'rating'],
  ['results', 'war'],
  ['results', 'rating'],
  ['results', 'elo'],
  ['results', 'composite'],
  ['war', 'composite'],
  ['rating', 'sim'],
  ['proj', 'backtest'],
  ['results', 'backtest'],
  ['tx', 'behavior'],
  ['ecr', 'perceived'],
  ['market', 'perceived'],
  ['perceived', 'behavior'],
  ['trades', 'cards'],
  ['sim', 'cards'],
  ['behavior', 'cards'],
  ['rating', 'power'],
  ['elo', 'power'],
  ['composite', 'power'],
  ['sim', 'odds'],
  ['elo', 'backtest'],
  ['composite', 'backtest'],
  ['rating', 'backtest'],
]

export const SystemTab = ({ onSub }: { onSub: (s: string) => void }) => {
  const { data, analysis, models } = useFantasy()
  const f = models.forecast
  const best = [...models.backtest.scores].filter((s) => s.model !== 'coin').sort((a, b) => a.brier - b.brier)[0]
  const removed = Object.values(data.context).reduce((a, c) => a + c.lost, 0)
  const nodes: MapNode[] = [
    { id: 'proj', col: 0, label: 'Sleeper projections', stat: `${data.rawHorizon.length} wks ahead · ${Object.keys(data.pastProjections).length} past`, note: 'Weekly, league-scored. Already price opponents and announced absences.' },
    {
      id: 'lines',
      col: 0,
      label: 'Prop lines',
      stat: data.market ? `${data.market.players} priced · wk ${data.market.week}` : 'none open',
      tab: 'backtest',
      note: `Sleeper's prop board, de-vigged and read as expected stats; blended ${Math.round(MARKET_WEIGHT * 100)}% into the coming week.`,
    },
    { id: 'results', col: 0, label: 'League results', stat: `${data.regularWeeks.length} wks${data.history ? ` + ${data.history.weeks.length} last season` : ''}`, note: 'Matchups and player points for every completed week.' },
    { id: 'history', col: 0, label: 'Injury history', stat: `${Object.keys(data.availability).length} players`, tab: 'availability', note: 'Games played over two seasons plus this one.' },
    { id: 'schedule', col: 0, label: 'NFL schedule', stat: data.schedule ? `${data.schedule.weeks.length} wks` : 'missing', note: 'Byes and opponents.' },
    { id: 'tx', col: 0, label: 'Transactions', stat: `${data.transactions.length} this season`, tab: 'behavior', note: 'Waivers, pickups and trades, both seasons.' },
    { id: 'ecr', col: 0, label: 'FantasyPros ECR', stat: data.consensus ? `${data.consensus.matched} matched` : 'unavailable', tab: 'data', note: 'Expert consensus via the DynastyProcess mirror.' },
    { id: 'avail', col: 1, label: 'Availability + roles', stat: `−${fmt(removed, 0)} pts/wk league`, tab: 'availability', note: 'P(play) per week; absent players’ work moves to teammates.' },
    { id: 'horizon', col: 2, label: 'Horizon', stat: `${data.horizon.length} wks · ${data.horizonMode}`, tab: 'engine', note: 'Expected points per player per week ahead.' },
    { id: 'lineup', col: 2, label: 'Lineup solver', stat: `${analysis.slots.length} slots`, note: 'Optimal lineup solved per week, waiver floor in empty slots.' },
    { id: 'market', col: 2, label: 'Market value', stat: `${Object.keys(analysis.market).length} priced`, tab: 'value', note: 'Points per week above positional replacement.' },
    { id: 'war', col: 2, label: 'WAR (to date)', stat: `σ ${fmt(analysis.sigma)}`, tab: 'value', note: 'Points above replacement converted to wins.' },
    { id: 'trades', col: 3, label: 'Trade search', stat: `${analysis.teams.length - 1} partners`, tab: 'engine', note: 'Beam search over packages, scored week by week.' },
    { id: 'rating', col: 3, label: 'Forecast rating', stat: f ? `eff ${pct(f.leagueEff)} · form ×${FORM_WEIGHT}` : 'off', tab: 'forecast', note: 'Projected lineup × efficiency: points per projected point (ELWAY’s lineup weights).' },
    { id: 'elo', col: 3, label: 'Elo', stat: `K ${ELO.k} · prior ${models.lastSeasonGames ? 'carried' : 'flat'}`, tab: 'forecast', note: 'Results only, margin-aware, regressed between seasons.' },
    { id: 'composite', col: 3, label: 'Composite', stat: 'win % vs avg', tab: 'power', note: 'All-play, scoring, form, roster, efficiency; results regressed by games played.' },
    { id: 'sim', col: 3, label: 'Season sim', stat: f ? `${f.sims.toLocaleString()} × σ ${fmt(f.sigma)}` : 'off', tab: 'forecast', note: 'Week-by-week seasons with a persistent team level, then the bracket.' },
    { id: 'perceived', col: 3, label: 'Perceived value', stat: models.perceived ? 'ECR → pts/wk' : 'off', tab: 'behavior', note: 'Consensus rank priced on the model’s own value curve.' },
    { id: 'behavior', col: 3, label: 'Behaviour read', stat: `${models.behavior.trades.length} trades seen`, tab: 'behavior', note: 'Engagement, trade history, perceived fairness.' },
    { id: 'cards', col: 4, label: 'Trade cards', stat: 'Δ odds · yes-odds', note: 'Every suggestion carries leverage and acceptance.' },
    { id: 'power', col: 4, label: 'Power rankings', stat: '3 models', note: 'Choose Forecast, Composite or Elo.' },
    { id: 'odds', col: 4, label: 'Playoff odds', stat: f && analysis.myRosterId != null ? `you ${pct(f.sim[analysis.myRosterId].playoffs)}` : '–', tab: 'forecast', note: 'Playoffs, byes, finals, titles, seeds.' },
    { id: 'backtest', col: 4, label: 'Backtest', stat: best ? `best: ${best.model} ${best.brier.toFixed(3)}` : '–', tab: 'backtest', note: 'Every model graded on games it had not seen.' },
  ]

  const wrap = useRef<HTMLDivElement>(null)
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [paths, setPaths] = useState<{ from: NodeId; to: NodeId; d: string }[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<NodeId | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      const box = el.getBoundingClientRect()
      setSize({ w: box.width, h: box.height })
      if (window.innerWidth < 1024) return setPaths([])
      setPaths(
        EDGES.flatMap(([from, to]) => {
          const a = refs.current[from]?.getBoundingClientRect()
          const b = refs.current[to]?.getBoundingClientRect()
          if (!a || !b) return []
          const x1 = a.right - box.left
          const y1 = a.top + a.height / 2 - box.top
          const x2 = b.left - box.left
          const y2 = b.top + b.height / 2 - box.top
          if (x2 <= x1) {
            // Same column: a short elbow down the gutter.
            const gx = a.right - box.left + 6
            return [{ from, to, d: `M${x1},${y1} H${gx} V${y2} H${b.right - box.left}` }]
          }
          const mx = (x1 + x2) / 2
          return [{ from, to, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }]
        }),
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [data, models])

  const related = useMemo(() => {
    if (!hover) return null
    // Everything upstream and downstream of the hovered node.
    const up = new Set<NodeId>([hover])
    const down = new Set<NodeId>([hover])
    let grew = true
    while (grew) {
      grew = false
      for (const [a, b] of EDGES) {
        if (down.has(a) && !down.has(b)) (down.add(b), (grew = true))
        if (up.has(b) && !up.has(a)) (up.add(a), (grew = true))
      }
    }
    return new Set([...up, ...down])
  }, [hover])

  const feeds = (id: NodeId) => EDGES.filter(([a]) => a === id).map(([, b]) => nodes.find((n) => n.id === b)!.label)

  return (
    <div className="space-y-3">
      <Panel title="How the models feed each other" pad={false} actions={<span>hover to trace · click to open</span>}>
        <div ref={wrap} className="relative p-3">
          {paths.length > 0 && (
            <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
              {paths.map((p, i) => {
                const on = !related || (related.has(p.from) && related.has(p.to))
                return <path key={i} d={p.d} fill="none" strokeWidth={on && related ? 1.5 : 1} className={on && related ? 'stroke-ff-accent' : 'stroke-ff-line2'} opacity={on ? 1 : 0.25} />
              })}
            </svg>
          )}
          <div className="relative grid grid-cols-1 gap-3 lg:grid-cols-5 lg:gap-x-10">
            {COLS.map((c, ci) => (
              <div key={c} className="min-w-0 space-y-2">
                <div className="ff-label flex items-center gap-2">
                  <span className="num text-ff-muted/70">{String(ci + 1).padStart(2, '0')}</span>
                  {c}
                </div>
                {nodes
                  .filter((n) => n.col === ci)
                  .map((n) => {
                    const dim = related && !related.has(n.id)
                    return (
                      <button
                        key={n.id}
                        ref={(el) => {
                          refs.current[n.id] = el
                        }}
                        onMouseEnter={() => setHover(n.id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(n.id)}
                        onBlur={() => setHover(null)}
                        onClick={() => n.tab && onSub(n.tab)}
                        title={n.note}
                        className={cx(
                          'block w-full border bg-ff-panel px-2.5 py-1.5 text-left transition-opacity',
                          hover === n.id ? 'border-ff-accent' : 'border-ff-line hover:border-ff-line2',
                          dim && 'opacity-30',
                          n.tab ? 'cursor-pointer' : 'cursor-default',
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12.5px] text-ff-text">{n.label}</span>
                          {n.tab && <span className="font-mono text-[9.5px] text-ff-muted">›</span>}
                        </span>
                        <span className="num block truncate text-[10.5px] text-ff-text2">{n.stat}</span>
                        <span className="block truncate font-mono text-[9.5px] text-ff-muted lg:hidden">→ {feeds(n.id).join(', ') || 'shown'}</span>
                      </button>
                    )
                  })}
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="What is measured" index={1}>
          <p className="text-[12.5px] leading-relaxed text-ff-text2">
            Weekly noise ({f ? `σ ${fmt(f.sigma)} from ${f.noiseN} team-weeks` : 'fallback'}), how often players actually suit up (two seasons of games), where an injured player’s points go (2026 projections), and how well each ranking predicts games it has not seen.
          </p>
        </Panel>
        <Panel title="What is assumed" index={2}>
          <p className="text-[12.5px] leading-relaxed text-ff-text2">
            The coming week blends prop lines and Sleeper {Math.round(MARKET_WEIGHT * 100)}/{Math.round((1 - MARKET_WEIGHT) * 100)}, with yardage lines read as medians (mean/median: rec {MEDIAN_TO_MEAN.rec_yd}, rush {MEDIAN_TO_MEAN.rush_yd}, pass {MEDIAN_TO_MEAN.pass_yd}). Season-long team uncertainty τ = {SIM.tauShare}·σ; Elo K {ELO.k} with a ⅓ summer regression (538’s NFL values); priors of {EFFICIENCY_PRIOR_GAMES} games on lineup efficiency and {FORM_PRIOR_GAMES} on form; the yes-odds weights. Each is labelled where it is used.
          </p>
        </Panel>
        <Panel title="What was decided by evidence" index={3}>
          <p className="text-[12.5px] leading-relaxed text-ff-text2">
            Form is computed but weighted ×{FORM_WEIGHT}: in both leagues tested when it was built, it made next-week predictions worse. Per-manager efficiency is shrunk with a {EFFICIENCY_PRIOR_GAMES}-game prior for the same reason.{' '}
            {(() => {
              const results = models.backtest.scores.filter((s) => ['ppg', 'allplay', 'power', 'elo'].includes(s.model))
              const worse = results.filter((s) => s.skill < 0).map((s) => MODEL_LABEL[s.model])
              return worse.length ? `Here, ${worse.join(', ')} scored worse than a coin flip on probability. ` : 'Here, every results model beats a coin flip. '
            })()}
            {best ? `${MODEL_LABEL[best.model]} grades best (Brier ${best.brier.toFixed(3)}, n ${best.n}).` : ''}
          </p>
        </Panel>
      </div>
    </div>
  )
}

// ---------- Forecast ----------

export const ForecastTab = () => {
  const { models, analysis } = useFantasy()
  const f = models.forecast
  if (!f) return <Panel title="Forecast">Needs projections for the weeks ahead.</Panel>
  const rows = [...f.ratings].sort((a, b) => b.rating - a.rating)
  return (
    <div className="space-y-3">
      <StatGrid>
        <Stat label="Weekly σ" value={fmt(f.sigma)} sub={f.noiseN ? `measured, ${f.noiseN} team-weeks` : 'fallback'} />
        <Stat label="Season τ" value={fmt(f.tau)} sub={`${SIM.tauShare} × σ`} />
        <Stat label="League eff" value={pct(f.leagueEff, 1)} sub="actual / projected optimum" />
        <Stat label="Simulations" value={f.sims.toLocaleString()} sub="seasons + bracket" />
        <Stat label="Elo K" value={ELO.k} sub={`regress ${Math.round(ELO.regress * 100)}% / summer`} />
        <Stat label="Form weight" value={`×${FORM_WEIGHT}`} sub="by backtest" />
      </StatGrid>
      <Panel title="Rating = projected lineup × efficiency (+ form × weight)" pad={false}>
        <Table
          rows={rows}
          rowKey={(r) => r.rosterId}
          rowClass={(r) => (r.rosterId === analysis.myRosterId ? 'ff-mine' : '')}
          columns={[
            { key: 't', label: 'Team', sticky: true, render: (r) => <span className={r.rosterId === analysis.myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text'}>{analysis.teamById[r.rosterId].name}</span> },
            { key: 'p', label: 'Lineup', align: 'right', title: 'Projected optimal lineup, pts/wk, horizon mean', sort: (r) => r.projected, render: (r) => fmt(r.projected) },
            { key: 'x', label: '×', align: 'center', render: () => <span className="text-ff-muted">×</span> },
            { key: 'e', label: 'Eff', align: 'right', sort: (r) => r.efficiency, render: (r) => pct(r.efficiency, 1) },
            { key: 'f', label: 'Form', align: 'right', title: `Shown, weighted ×${FORM_WEIGHT}`, sort: (r) => r.form, render: (r) => <span className="text-ff-muted">{fmtSigned(r.form)}</span> },
            { key: 'eq', label: '=', align: 'center', render: () => <span className="text-ff-muted">=</span> },
            { key: 'r', label: 'Rating', align: 'right', sort: (r) => r.rating, render: (r) => <span className="text-ff-text">{fmt(r.rating)}</span> },
            { key: 'elo', label: 'Elo', align: 'right', sort: (r) => r.elo, render: (r) => r.elo },
            { key: 'w', label: 'Proj W', align: 'right', sort: (r) => f.sim[r.rosterId].wins, render: (r) => fmt(f.sim[r.rosterId].wins) },
            { key: 'po', label: 'PO', align: 'right', sort: (r) => f.sim[r.rosterId].playoffs, render: (r) => pct(f.sim[r.rosterId].playoffs) },
            { key: 'ti', label: 'Title', align: 'right', sort: (r) => f.sim[r.rosterId].title, render: (r) => pct(f.sim[r.rosterId].title, 1) },
          ]}
        />
      </Panel>
      <Panel title="Method · after ELWAY and 538 NFL Elo">
        <div className="grid grid-cols-1 gap-4 text-[12.5px] leading-relaxed text-ff-text2 lg:grid-cols-2">
          <p>
            ELWAY rates NFL teams with Elo-style results, then adjusts for who is actually playing, the quarterback above all. Fantasy inverts the balance: nobody plays defense, so a team&apos;s score is almost entirely the lineup it fields, and that lineup is
            projected in advance. The rating is therefore the projected optimal lineup for each week, with injury odds and byes priced in, times efficiency: the points this team has actually scored per point its lineup was projected for, shrunk toward the league. That folds in lineup calls and any systematic gap between a roster and its projections.
          </p>
          <p>
            Results still matter twice: they set efficiency, and they measure the weekly noise σ the simulation uses. Elo, the pure-results benchmark, uses 538&apos;s margin multiplier and carries last season&apos;s rating forward,
            regressed a third of the way to 1500. A season simulation draws one level per team per season (τ) on top of weekly noise, so a team the projections misjudge stays misjudged all year, as it would in reality.
          </p>
        </div>
      </Panel>
    </div>
  )
}

// ---------- Backtest ----------

const MODEL_LABEL: Record<BacktestModel, string> = {
  coin: 'Coin flip',
  ppg: 'Points per game',
  allplay: 'All-play (log5)',
  elo: 'Elo',
  power: 'Composite power',
  projection: 'Projection',
  forecast: 'Forecast',
  form: 'Forecast + form',
}

const Reliability = ({ s }: { s: BacktestScore }) => {
  const W = 96
  const H = 40
  return (
    <svg width={W} height={H} className="block" role="img" aria-label={`${MODEL_LABEL[s.model]} reliability`}>
      <rect x={0} y={0} width={W} height={H} className="fill-ff-sunken" />
      <line x1={0} y1={H} x2={W} y2={0} className="stroke-ff-line2" strokeDasharray="2 2" />
      {s.bins.map((b, i) =>
        b.n && !Number.isNaN(b.observed) ? (
          <rect key={i} x={b.p * W - 4} y={H - b.observed * H - 4} width={8} height={8} className="fill-ff-accent" opacity={Math.min(1, 0.35 + b.n / 20)}>
            <title>{`predicted ${pct(b.p)} · observed ${pct(b.observed)} · n ${b.n}`}</title>
          </rect>
        ) : null,
      )}
    </svg>
  )
}

/** Prop lines against Sleeper on finished weeks, from snapshots this browser filed before kickoff. */
const LinesTracker = () => {
  const { data } = useFantasy()
  const snaps = useMemo(() => loadSnapshots(data.league.season), [data.league.season])
  const grade = useMemo(() => (data.valueSeason === data.league.season ? gradeSnapshots(snaps, data.weekPoints) : null), [snaps, data])
  const filed = Object.keys(snaps).map(Number).sort((a, b) => a - b)
  const rows = grade
    ? [
        { k: 'Sleeper', v: grade.maeSleeper },
        { k: 'Prop lines', v: grade.maeMarket },
        { k: `Blend ${Math.round(MARKET_WEIGHT * 100)}/${Math.round((1 - MARKET_WEIGHT) * 100)} (used)`, v: grade.maeBlend },
      ].sort((a, b) => a.v - b.v)
    : []
  const worst = rows.length ? Math.max(...rows.map((r) => r.v)) : 1
  return (
    <Panel title="Weekly player points · prop lines vs Sleeper" actions={<span>mean absolute error, lower is better</span>}>
      {grade ? (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.k} className="grid grid-cols-[150px_minmax(0,1fr)_56px] items-center gap-3 text-[12.5px]">
              <span className="text-ff-text2">{r.k}</span>
              <span className="h-[6px] bg-ff-sunken">
                <span className="block h-full bg-ff-s1" style={{ width: `${(r.v / worst) * 100}%` }} />
              </span>
              <span className="num text-right text-ff-text">{r.v.toFixed(2)}</span>
            </div>
          ))}
          <p className="pt-1 font-mono text-[10.5px] text-ff-muted">
            {grade.n} player-weeks · wk {grade.weeks.join(', ')} · graded from snapshots filed in this browser before kickoff
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ff-text2">
          No free archive of past prop lines exists, so the page keeps its own: every load before kickoff files what the lines and Sleeper projected for each priced player, and the week is graded once it is scored.{' '}
          {filed.length ? (
            <span className="font-mono text-[11px] text-ff-muted">Filed so far: wk {filed.join(', ')}. First grade after those games finish.</span>
          ) : (
            <span className="font-mono text-[11px] text-ff-muted">Nothing filed yet.</span>
          )}
        </p>
      )}
    </Panel>
  )
}

export const BacktestTab = () => {
  const { models, data } = useFantasy()
  const bt = models.backtest
  const rows = [...bt.scores].sort((a, b) => a.brier - b.brier)
  const maxSkill = Math.max(0.05, ...rows.map((r) => Math.abs(r.skill)))
  const seasons = [data.league.season, ...(data.history ? [data.history.season] : [])]
  return (
    <div className="space-y-3">
      <LinesTracker />
      <Panel title="Next-week win probability, graded out of sample" pad={false} actions={<span>{seasons.join(' + ')}</span>}>
        <Table
          rows={rows}
          rowKey={(r) => r.model}
          defaultSort="brier"
          defaultDesc={false}
          columns={[
            { key: 'm', label: 'Model', sticky: true, render: (r) => <span className={cx(r.model === 'forecast' ? 'font-medium text-ff-text' : 'text-ff-text2')}>{MODEL_LABEL[r.model]}</span> },
            { key: 'n', label: 'Games', align: 'right', sort: (r) => r.n, render: (r) => r.n },
            { key: 'brier', label: 'Brier', align: 'right', title: 'Mean squared error of the probability. Lower is better; a coin flip scores 0.250.', sort: (r) => r.brier, render: (r) => <span className="text-ff-text">{r.brier.toFixed(3)}</span> },
            { key: 'se', label: '±se', align: 'right', hideBelow: 'sm', render: (r) => <span className="text-ff-muted">{r.se.toFixed(3)}</span> },
            {
              key: 'skill',
              label: 'Skill vs coin',
              align: 'right',
              sort: (r) => r.skill,
              render: (r) => (
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="relative inline-block h-[6px] w-24 bg-ff-sunken">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-ff-line2" />
                    <span className={cx('absolute inset-y-0', r.skill >= 0 ? 'bg-ff-pos' : 'bg-ff-neg')} style={{ left: r.skill >= 0 ? '50%' : `${50 - (Math.abs(r.skill) / maxSkill) * 50}%`, width: `${(Math.abs(r.skill) / maxSkill) * 50}%` }} />
                  </span>
                  <Num value={r.skill * 100} signed digits={0} suffix="%" />
                </span>
              ),
            },
            { key: 'acc', label: 'Picks right', align: 'right', sort: (r) => r.accuracy, render: (r) => (r.model === 'coin' ? <span className="text-ff-muted">–</span> : pct(r.accuracy)) },
            { key: 'll', label: 'Log loss', align: 'right', hideBelow: 'md', sort: (r) => r.logLoss, render: (r) => r.logLoss.toFixed(3) },
            { key: 'rel', label: 'Reliability', hideBelow: 'lg', render: (r) => (r.model === 'coin' ? null : <Reliability s={r} />) },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 border-t border-ff-line px-3 py-2.5 text-[12px] leading-relaxed text-ff-text2 lg:grid-cols-2">
          <p>
            Every prediction for week <i>w</i> uses only weeks before <i>w</i>. Projection models need Sleeper&apos;s past projections, so they cover this season only; results models also run on last season. On the{' '}
            <span className="num">{bt.commonN}</span> games every model predicted:{' '}
            {[...bt.commonScores]
              .sort((a, b) => a.brier - b.brier)
              .map((s) => `${MODEL_LABEL[s.model]} ${s.brier.toFixed(3)}`)
              .join(' · ')}
            .
          </p>
          <p>
            Read the standard errors before the ranking: with a few dozen games, gaps under about 0.03 are noise. Reliability plots predicted against observed win rates; points on the dashed line are well calibrated. The composite is graded on its
            regressed margin in points per week, through the same weekly σ as the point-based models.
          </p>
        </div>
      </Panel>
    </div>
  )
}

// ---------- Behaviour ----------

export const BehaviorTab = () => {
  const { models, analysis, data } = useFantasy()
  const b = models.behavior
  const teams = [...analysis.teams].sort((x, y) => b.teams[y.rosterId].engagement - b.teams[x.rosterId].engagement)
  const name = (id: string) => data.players[id]?.name ?? id
  return (
    <div className="space-y-3">
      <StatGrid>
        <Stat label="Moves" value={b.movesTotal} sub="waiver + FA adds" />
        <Stat label="Trades" value={b.trades.length} sub={data.history ? `incl. ${data.history.season}` : 'this season'} />
        <Stat label="Median gap" value={b.medianGap == null ? '–' : fmt(b.medianGap)} sub="pts/wk, accepted deals" />
        <Stat label="Common shape" value={Object.entries(b.shapes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '–'} sub="by count" />
        <Stat label="Consensus" value={data.consensus ? 'on' : 'off'} sub="perceived fairness" />
        <Stat label="Personalities" value="no" sub="deliberately not modelled" />
      </StatGrid>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Managers" pad={false}>
          <Table
            rows={teams}
            rowKey={(t) => t.rosterId}
            rowClass={(t) => (t.rosterId === analysis.myRosterId ? 'ff-mine' : '')}
            columns={[
              { key: 't', label: 'Team', sticky: true, render: (t) => <span className="text-ff-text">{t.name}</span> },
              { key: 'm', label: 'Moves', align: 'right', sort: (t) => b.teams[t.rosterId].moves, render: (t) => b.teams[t.rosterId].moves },
              {
                key: 'e',
                label: 'Engagement',
                align: 'right',
                sort: (t) => b.teams[t.rosterId].engagement,
                render: (t) => (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-[6px] w-14 bg-ff-sunken">
                      <span className="block h-full bg-ff-s1" style={{ width: `${b.teams[t.rosterId].engagement * 100}%` }} />
                    </span>
                    {pct(b.teams[t.rosterId].engagement)}
                  </span>
                ),
              },
              { key: 'tr', label: 'Trades', align: 'right', sort: (t) => b.teams[t.rosterId].trades + b.teams[t.rosterId].tradesLast, render: (t) => `${b.teams[t.rosterId].trades}+${b.teams[t.rosterId].tradesLast}` },
              {
                key: 'bt',
                label: 'Bought',
                hideBelow: 'md',
                render: (t) => (
                  <span className="font-mono text-[11px] text-ff-text2">
                    {Object.entries(b.teams[t.rosterId].bought)
                      .map(([p, n]) => `${p}${n > 1 ? `×${n}` : ''}`)
                      .join(' ') || '–'}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
        <Panel title="Trade log" pad={false}>
          {b.trades.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-ff-muted">No trades on record. Engagement and consensus carry the read alone.</p>
          ) : (
            <div className="ff-scroll max-h-[420px] overflow-auto">
              {b.trades.map((t, i) => (
                <div key={i} className="border-b border-ff-line/60 px-3 py-2 text-[12px] last:border-0">
                  <div className="flex items-center gap-2 font-mono text-[10.5px] text-ff-muted">
                    <span>
                      {t.season} wk {t.week}
                    </span>
                    <Badge>{t.shape}</Badge>
                    {t.gap != null && <span>gap {t.gap.toFixed(1)}</span>}
                    {t.picks > 0 && <span>{t.picks} picks</span>}
                  </div>
                  {t.sides.map((side) => (
                    <div key={side.rosterId} className="mt-0.5 truncate">
                      <span className="text-ff-text">{analysis.teamById[side.rosterId]?.name ?? `#${side.rosterId}`}</span>
                      <span className="text-ff-muted"> got </span>
                      <span className="text-ff-text2">{side.got.map(name).join(', ') || 'picks'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Yes-odds weights · judgement, not fit">
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-[11.5px] text-ff-text2 sm:grid-cols-2">
          {[
            ['their lineup gain', '+0.90 per pt/wk'],
            ['perceived overpay (consensus)', '−0.45 per pt/wk'],
            ['perceived bargain for them', '+0.10 per pt/wk, cap 2'],
            ['engagement (least → most)', '−0.40 → +0.40'],
            ['trades on record', '+0.25 each, cap 3'],
            ['has traded with you', '+0.30'],
            ['each player past 1-for-1', '−0.15'],
            ['index', 'logistic → 0–100'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dotted border-ff-line py-1">
              <span className="text-ff-muted">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ff-text2">
          There are too few trades in one league to fit anything, so these stay small and visible. It ranks offers; it does not claim a probability. Owners judge offers by public rankings, which is why the consensus view of a deal carries real weight.
        </p>
      </Panel>
    </div>
  )
}
