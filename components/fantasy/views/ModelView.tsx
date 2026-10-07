import React, { useMemo, type ReactNode } from 'react'
import { analyze, withWeights, type Analysis } from '../../../lib/fantasy/analysis'
import { AVAILABILITY_PRIOR_GAMES, BASE_AVAILABILITY, HEALTHY_DECAY, NEXT_MAN_SHARE, SKILL_POSITIONS, STATUS_PLAY, TRANSFER, playProbability } from '../../../lib/fantasy/context'
import { starterDemand } from '../../../lib/fantasy/lineup'
import { DEFAULT_POWER_WEIGHTS, type PowerWeights } from '../../../lib/fantasy/power'
import { clearFantasyCache } from '../../../lib/fantasy/sleeper'
import { DEFAULT_TRADE_CONFIG, DEFAULT_WAIVER_DEPTH, SUGGESTED_TRADE_CONFIG, type TradeConfig } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { DEFAULT_MODEL, type ModelConfig } from '../../../lib/fantasy/war'
import { HBars, Histogram, Legend, MiniLines } from '../charts'
import PlayerName from '../PlayerName'
import { Avatar, Badge, Button, Num, PageHeader, Panel, Stat, StatGrid, Table, Tabs, cx, fmt, fmtSigned, pct, type Column } from '../ui'
import { BacktestTab, BehaviorTab, ForecastTab, SystemTab } from './ModelSystem'
import { COMPONENTS } from './PowerView'

type Sub = 'system' | 'value' | 'availability' | 'engine' | 'forecast' | 'backtest' | 'behavior' | 'power' | 'data'
const SUBS: Sub[] = ['system', 'value', 'availability', 'engine', 'forecast', 'backtest', 'behavior', 'power', 'data']

const fill = (slot: string) => `rgb(var(--ff-${slot}))`
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps

// ---------- Console pieces ----------

/**
 * One tunable. The track carries a tick at the default so you can see how far
 * you have pushed it; the readout turns accent when it is off default.
 */
const Param = ({
  name,
  label,
  value,
  def,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  hint,
  className,
}: {
  name: string
  label: string
  value: number
  def: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: ReactNode
  className?: string
}) => {
  const changed = !near(value, def, step / 2)
  const at = (v: number) => (v - min) / (max - min || 1)
  // A 14px thumb travels 14px less than the track; keep the tick under its centre.
  const tickLeft = `calc(${at(def) * 100}% + ${(0.5 - at(def)) * 14}px)`
  return (
    <div className={cx('border-b border-ff-line px-3 py-2.5 last:border-b-0', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] text-ff-text">{label}</span>
          <code className="hidden truncate font-mono text-[10.5px] text-ff-muted sm:inline">{name}</code>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          {changed && (
            <button onClick={() => onChange(def)} className="font-mono text-[10px] uppercase tracking-wider text-ff-muted hover:text-ff-accent">
              reset
            </button>
          )}
          <span className={cx('num min-w-[44px] rounded-sm bg-ff-sunken px-1.5 py-0.5 text-right text-[12.5px]', changed ? 'text-ff-accent' : 'text-ff-text')}>{format(value)}</span>
        </div>
      </div>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute top-[3px] h-3 w-px bg-ff-muted/70" style={{ left: tickLeft }} aria-hidden />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="ff-range relative w-full"
          style={{ ['--fill' as string]: `${at(value) * 100}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-ff-muted">
        <span>{format(min)}</span>
        <span>default {format(def)}</span>
        <span>{format(max)}</span>
      </div>
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-ff-muted">{hint}</p>}
    </div>
  )
}

/** A read-only parameter sheet: key, value, what it does. */
const Spec = ({ rows, stacked }: { rows: { k: string; v: ReactNode; note?: ReactNode }[]; stacked?: boolean }) => (
  <div className="divide-y divide-ff-line">
    {rows.map((r) => (
      <div key={r.k} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-3 py-1.5', !stacked && 'sm:grid-cols-[150px_56px_minmax(0,1fr)]')}>
        <code className="truncate font-mono text-[11.5px] text-ff-text2">{r.k}</code>
        <span className="num text-right text-[12.5px] text-ff-text">{r.v}</span>
        {r.note && <span className={cx('col-span-2 text-[11.5px] leading-snug text-ff-muted', !stacked && 'sm:col-span-1')}>{r.note}</span>}
      </div>
    ))}
  </div>
)

const Code = ({ children }: { children: string }) => (
  <pre className="ff-scroll overflow-x-auto rounded-sm border border-ff-line bg-ff-sunken px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ff-text2">{children}</pre>
)

/** z-score as a bar either side of a centre line, clipped at ±2.5. */
const ZBar = ({ z, slot }: { z: number; slot: string }) => {
  const w = Math.min(1, Math.abs(z) / 2.5) * 50
  return (
    <span className="inline-flex items-center gap-1.5" title={`z ${fmtSigned(z, 2)}`}>
      <span className="relative h-2.5 w-14 rounded-[2px] bg-ff-sunken">
        <span className="absolute inset-y-0 left-1/2 w-px bg-ff-line2" />
        <span className="absolute inset-y-[1px] rounded-[2px]" style={{ background: fill(slot), width: `${w}%`, left: z >= 0 ? '50%' : `${50 - w}%` }} />
      </span>
      <span className="num w-9 text-right text-[11px] text-ff-text2">{fmtSigned(z, 1)}</span>
    </span>
  )
}

const RankDelta = ({ d }: { d: number }) =>
  d === 0 ? <span className="num text-ff-muted">·</span> : <span className={cx('num text-[11.5px]', d > 0 ? 'text-ff-pos' : 'text-ff-neg')}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>

/** Every parameter that differs from its default, as `key: default → now`. */
const diffList = (model: ModelConfig, weights: PowerWeights) => {
  const out: string[] = []
  for (const k of Object.keys(DEFAULT_MODEL) as (keyof ModelConfig)[]) if (!near(model[k], DEFAULT_MODEL[k], 1e-6)) out.push(k)
  for (const k of Object.keys(DEFAULT_POWER_WEIGHTS) as (keyof PowerWeights)[]) if (!near(weights[k], DEFAULT_POWER_WEIGHTS[k], 1e-6)) out.push(`w.${k}`)
  return out
}

// ---------- View ----------

type Props = {
  data: LeagueData
  analysis: Analysis
  sub: string | null
  onSub: (s: string) => void
  model: ModelConfig
  setModel: (m: ModelConfig) => void
  weights: PowerWeights
  setWeights: (w: PowerWeights) => void
  reload: () => void
}

const ModelView = ({ data, analysis, sub, onSub, model, setModel, weights, setWeights, reload }: Props) => {
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'system'
  const changed = diffList(model, weights)

  // The same league run at the defaults, so every readout can show what your settings moved.
  // Weights alone only re-rank, so that case skips the full re-analysis.
  const modelChanged = changed.some((k) => !k.startsWith('w.'))
  const baseline = useMemo(
    () => (!changed.length ? analysis : modelChanged ? analyze(data, DEFAULT_MODEL, DEFAULT_POWER_WEIGHTS) : withWeights(analysis, DEFAULT_POWER_WEIGHTS)),
    [data, changed.join(','), analysis], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <>
      <PageHeader
        code="07"
        title="Model"
        meta={
          <>
            <span className="num">{Object.keys(DEFAULT_MODEL).length + Object.keys(DEFAULT_POWER_WEIGHTS).length}</span> live parameters ·{' '}
            {changed.length ? (
              <span className="text-ff-accent">
                <span className="num">{changed.length}</span> off default
              </span>
            ) : (
              'all at defaults'
            )}
          </>
        }
        actions={
          changed.length > 0 && (
            <Button
              size="sm"
              onClick={() => {
                setModel(DEFAULT_MODEL)
                setWeights(DEFAULT_POWER_WEIGHTS)
              }}
            >
              Reset all
            </Button>
          )
        }
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={onSub}
            items={[
              { key: 'system', label: 'System' },
              { key: 'value', label: 'Player value' },
              { key: 'availability', label: 'Availability' },
              { key: 'engine', label: 'Trade engine' },
              { key: 'forecast', label: 'Forecast' },
              { key: 'backtest', label: 'Backtest' },
              { key: 'behavior', label: 'Behaviour' },
              { key: 'power', label: 'Composite' },
              { key: 'data', label: 'Data' },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        {tab === 'system' && <SystemTab onSub={onSub} />}
        {tab === 'forecast' && <ForecastTab />}
        {tab === 'backtest' && <BacktestTab />}
        {tab === 'behavior' && <BehaviorTab />}
        {tab === 'value' && <ValueTab data={data} analysis={analysis} baseline={baseline} model={model} setModel={setModel} />}
        {tab === 'power' && <PowerTab analysis={analysis} baseline={baseline} weights={weights} setWeights={setWeights} />}
        {tab === 'availability' && <AvailabilityTab data={data} analysis={analysis} />}
        {tab === 'engine' && <EngineTab data={data} analysis={analysis} baseline={baseline} />}
        {tab === 'data' && <DataTab data={data} analysis={analysis} reload={reload} />}
      </div>
    </>
  )
}

// ---------- Player value ----------

const ValueTab = ({ data, analysis, baseline, model, setModel }: { data: LeagueData; analysis: Analysis; baseline: Analysis; model: ModelConfig; setModel: (m: ModelConfig) => void }) => {
  const players = data.players
  const numTeams = data.league.total_rosters || data.rosters.length
  const demand = starterDemand(data.league.roster_positions ?? [], numTeams)
  const positions = Object.keys(demand)
  const isDefault = analysis === baseline

  const avgLevel = (a: Analysis, pos: string) => {
    const xs = data.valueWeeks.map((w) => a.levels[w]?.[pos] ?? 0)
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0
  }
  const levelRows = positions.map((pos) => ({
    pos,
    demand: demand[pos],
    rank: Math.round(demand[pos] * (1 + model.benchFactor)),
    toDate: avgLevel(analysis, pos),
    toDateBase: avgLevel(baseline, pos),
    ahead: analysis.horizonReplacement[pos] ?? 0,
    aheadBase: baseline.horizonReplacement[pos] ?? 0,
  }))

  const withGames = Object.values(analysis.values).filter((v) => v.games > 0)
  const above = withGames.filter((v) => v.war > 0).length
  const aboveBase = Object.values(baseline.values).filter((v) => v.games > 0 && v.war > 0).length
  const repriced = Object.keys(analysis.market).filter((id) => analysis.rosteredBy[id] !== undefined && Math.abs((analysis.market[id] ?? 0) - (baseline.market[id] ?? 0)) >= 0.25).length

  // Replacement depth shifts every player at a position by the same amount, so
  // what it really changes is the order across positions. Show that.
  const movers = useMemo(() => {
    if (isDefault) return []
    const rank = (m: Record<string, number>) => {
      const ids = Object.keys(m).filter((id) => players[id] && (m[id] ?? 0) > -50)
      ids.sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0))
      return Object.fromEntries(ids.map((id, i) => [id, i + 1])) as Record<string, number>
    }
    const now = rank(analysis.market)
    const before = rank(baseline.market)
    return Object.keys(now)
      .filter((id) => now[id] <= 100 && (before[id] ?? 999) <= 100)
      .map((id) => ({ id, rank: now[id], move: (before[id] ?? now[id]) - now[id], value: analysis.market[id] ?? 0, delta: (analysis.market[id] ?? 0) - (baseline.market[id] ?? 0) }))
      .filter((m) => m.move !== 0)
      .sort((a, b) => Math.abs(b.move) - Math.abs(a.move) || a.rank - b.rank)
      .slice(0, 20)
  }, [isDefault, analysis, baseline, players])

  const top = useMemo(() => [...withGames].sort((a, b) => b.war - a.war).slice(0, 12), [withGames])

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Panel title="Parameters" pad={false} actions={<span className="font-mono text-[10.5px]">war.ts</span>}>
          <Param
            name="benchFactor"
            label="Replacement depth"
            value={model.benchFactor}
            def={DEFAULT_MODEL.benchFactor}
            min={0}
            max={1.5}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => setModel({ ...model, benchFactor: v })}
            hint="Bench buffer past league-wide starter demand. 0 is the worst weekly starter (classic VBD); 0.6 lands near the best player on waivers. Also sets trade prices."
          />
          <Param
            name="halfLife"
            label="Recency half-life"
            value={model.halfLife}
            def={DEFAULT_MODEL.halfLife}
            min={0}
            max={8}
            step={1}
            format={(v) => (v === 0 ? 'off' : `${v} wk`)}
            onChange={(v) => setModel({ ...model, halfLife: v })}
            hint="Weight on recent weeks for “Now” WAR and roster strength. A week one half-life old counts half."
          />
          <Param
            name="riskAversion"
            label="Risk aversion"
            value={model.riskAversion}
            def={DEFAULT_MODEL.riskAversion}
            min={0}
            max={1}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => setModel({ ...model, riskAversion: v })}
            hint="Risk-adjusted PPG = PPG − λ·σweekly. Raise it if you would rather have a floor than a ceiling."
          />
        </Panel>
        <Panel title="Definitions" bodyClassName="space-y-2 text-[12.5px] leading-relaxed text-ff-text2">
          <Code>{`PAR_w  = pts_w − repl(pos, w)
WAR_w  = Φ(PAR_w / σ√2) − 0.5
σ      = ${fmt(analysis.sigma, 2)}  (team score sd)
Value  = perActive − repl_horizon(pos)`}</Code>
          <p>
            WAR turns points into wins against a random opponent, so a 40-point week can&apos;t be worth more than one win. <b className="font-medium text-ff-text">Value</b> is the forward-looking
            version the trade engine prices with.
          </p>
        </Panel>
      </div>

      <div className="min-w-0 space-y-3">
        <StatGrid className="xl:grid-cols-4">
          <Stat
            label="Above replacement"
            value={above}
            delta={!isDefault && above !== aboveBase ? <Num value={above - aboveBase} signed digits={0} /> : undefined}
            sub={`of ${withGames.length} with games`}
          />
          <Stat label="Team score σ" value={fmt(analysis.sigma, 1)} sub="pts, sets WAR scale" />
          <Stat label="Trade prices moved" value={isDefault ? '–' : repriced} sub={isDefault ? 'at defaults' : 'rostered, ≥0.25 pts/wk'} />
          <Stat label="Value weeks" value={data.valueWeeks.length} sub={`${data.valueSeason} · wks ${data.valueWeeks[0] ?? '–'}–${data.valueWeeks[data.valueWeeks.length - 1] ?? '–'}`} />
        </StatGrid>

        <Panel title="Replacement level by position" pad={false} actions={!isDefault && <Badge tone="accent">Δ vs default</Badge>}>
          <Table
            rows={levelRows}
            rowKey={(r) => r.pos}
            dense
            columns={[
              { key: 'pos', label: 'Pos', render: (r) => <span className="font-mono text-[11.5px] text-ff-text">{r.pos}</span> },
              { key: 'demand', label: 'Started/wk', align: 'right', title: 'League-wide starter demand, flex slots split by typical usage', render: (r) => fmt(r.demand) },
              { key: 'rank', label: 'Repl rank', align: 'right', render: (r) => `${r.pos}${r.rank}` },
              { key: 'td', label: 'To date', align: 'right', title: 'Replacement points per week, season to date', render: (r) => <span className="text-ff-text">{fmt(r.toDate)}</span> },
              ...(!isDefault ? [{ key: 'tdd', label: 'Δ', align: 'right' as const, render: (r: (typeof levelRows)[number]) => <Num value={r.toDate - r.toDateBase} signed /> }] : []),
              { key: 'ah', label: 'Ahead', align: 'right', title: 'Replacement points per active week over the pricing horizon', render: (r) => <span className="text-ff-text">{fmt(r.ahead)}</span> },
              ...(!isDefault ? [{ key: 'ahd', label: 'Δ', align: 'right' as const, render: (r: (typeof levelRows)[number]) => <Num value={r.ahead - r.aheadBase} signed /> }] : []),
            ]}
          />
        </Panel>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="WAR distribution" actions={<span className="num">{withGames.length} players</span>}>
            <Histogram values={withGames.map((v) => v.war)} bins={24} marker={0} markerLabel="replacement" format={(v) => fmt(v, 1)} />
          </Panel>
          {isDefault ? (
            <Panel title="Top WAR" pad={false}>
              <Table
                rows={top}
                rowKey={(v) => v.id}
                dense
                maxHeight={260}
                columns={[
                  { key: 'p', label: 'Player', render: (v) => <PlayerName player={players[v.id]} id={v.id} size={22} /> },
                  { key: 'ppg', label: 'PPG', align: 'right', render: (v) => fmt(v.ppg) },
                  { key: 'war', label: 'WAR', align: 'right', render: (v) => <Num value={v.war} signed digits={2} /> },
                ]}
              />
            </Panel>
          ) : (
            <Panel title="Value rank, reordered" pad={false} actions={<span>top 100</span>}>
              <Table
                rows={movers}
                rowKey={(m) => m.id}
                dense
                maxHeight={260}
                empty="No one in the top 100 changed places."
                columns={[
                  { key: 'rk', label: 'Rk', align: 'right', render: (m) => <span className="num text-ff-text">{m.rank}</span> },
                  { key: 'mv', label: 'Δ', render: (m) => <RankDelta d={m.move} /> },
                  { key: 'p', label: 'Player', render: (m) => <PlayerName player={players[m.id]} id={m.id} size={22} /> },
                  { key: 'v', label: 'Value', align: 'right', title: 'Pts/wk above replacement over the horizon', render: (m) => <span className="text-ff-text">{fmt(m.value)}</span> },
                  { key: 'd', label: 'Δ', align: 'right', render: (m) => <Num value={m.delta} signed /> },
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Power ----------

const POWER_HINT: Record<keyof PowerWeights, string> = {
  allPlay: 'Record against every team every week. Removes schedule luck.',
  points: 'Raw points per game.',
  recent: 'Points per game over the last three weeks.',
  roster: 'Recency-weighted WAR of the optimal lineup plus a discounted bench. The forward-looking piece.',
  efficiency: 'Points scored as a share of the optimal lineup. Rewards setting lineups well.',
}

const PowerTab = ({ analysis, baseline, weights, setWeights }: { analysis: Analysis; baseline: Analysis; weights: PowerWeights; setWeights: (w: PowerWeights) => void }) => {
  const sum = COMPONENTS.reduce((a, c) => a + Math.max(0, weights[c.key]), 0) || 1
  const shares = COMPONENTS.map((c) => ({ ...c, share: Math.max(0, weights[c.key]) / sum }))
  const changed = analysis !== baseline
  const moved = analysis.power.filter((p) => baseline.powerById[p.rosterId]?.rank !== p.rank).length

  const columns: Column<(typeof analysis.power)[number]>[] = [
    { key: 'rk', label: 'Rk', sort: (p) => -p.rank, render: (p) => <span className="num text-ff-text">{p.rank}</span> },
    ...(changed
      ? [
          {
            key: 'd',
            label: 'Δ',
            sort: (p: (typeof analysis.power)[number]) => baseline.powerById[p.rosterId].rank - p.rank,
            render: (p: (typeof analysis.power)[number]) => <RankDelta d={baseline.powerById[p.rosterId].rank - p.rank} />,
          },
        ]
      : []),
    {
      key: 'team',
      label: 'Team',
      sticky: true,
      render: (p) => {
        const t = analysis.teamById[p.rosterId]
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar src={t.avatar} name={t.name} size={20} />
            <span className={cx('max-w-[150px] truncate', p.rosterId === analysis.myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t.name}</span>
          </span>
        )
      },
    },
    { key: 'score', label: 'Score', align: 'right', sort: (p) => p.score, render: (p) => <span className="text-ff-text">{fmt(p.score, 0)}</span> },
    ...COMPONENTS.map((c, i) => ({
      key: c.key,
      label: c.label,
      hideBelow: (i < 2 ? undefined : i < 4 ? 'sm' : 'md') as Column<unknown>['hideBelow'],
      sort: (p: (typeof analysis.power)[number]) => p.components[c.key],
      render: (p: (typeof analysis.power)[number]) => <ZBar z={p.components[c.key]} slot={c.slot} />,
    })),
  ]

  return (
    <div className="space-y-3">
      <Panel title="Weights" pad={false} actions={<span className="font-mono text-[10.5px]">power.ts</span>}>
        <div className="space-y-2 border-b border-ff-line px-3 py-2.5">
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label="Normalized weights">
            {shares.map((s) => (s.share > 0 ? <span key={s.key} style={{ width: `${s.share * 100}%`, background: fill(s.slot) }} title={`${s.label} ${pct(s.share)}`} /> : null))}
          </div>
          <Legend items={shares.map((s) => ({ label: s.label, slot: s.slot, value: pct(s.share) }))} />
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-5">
          {COMPONENTS.map((c) => (
            <Param
              key={c.key}
              name={`w.${c.key}`}
              label={c.label}
              value={weights[c.key]}
              def={DEFAULT_POWER_WEIGHTS[c.key]}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setWeights({ ...weights, [c.key]: v })}
              hint={POWER_HINT[c.key]}
              className="sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
            />
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Rankings at these weights" pad={false} actions={changed ? <span className="num">{moved} teams moved</span> : <span>defaults</span>}>
          <Table rows={analysis.power} rowKey={(p) => p.rosterId} columns={columns} defaultSort="rk" defaultDesc rowClass={(p) => cx(p.rosterId === analysis.myRosterId && 'ff-mine')} />
        </Panel>
        <Panel title="Method">
          <Code>{`z_k   = (x_k − μ_k) / σ_k
score = Σ (w_k / Σw) · z_k
power = 100 · (score − min)
            / (max − min)`}</Code>
          <p className="mt-2 text-[12px] leading-relaxed text-ff-muted">
            Each component is z-scored across the {analysis.teams.length} teams, so weights are relative and only their shares matter. A component with no data yet (preseason) drops out and the rest
            renormalize. Bars show each team&apos;s z, clipped at ±2.5.
          </p>
        </Panel>
      </div>
    </div>
  )
}

// ---------- Availability ----------

const AvailabilityTab = ({ data, analysis }: { data: LeagueData; analysis: Analysis }) => {
  const players = data.players
  const rostered = Object.keys(analysis.rosteredBy).filter((id) => SKILL_POSITIONS.includes(players[id]?.pos as (typeof SKILL_POSITIONS)[number]))
  const rates = rostered.map((id) => data.availability[id]?.rate).filter((r): r is number => r != null)
  const weeksAhead = Array.from({ length: 10 }, (_, i) => i + 1)
  const curves = [
    { label: 'Iron man 0.95', rate: 0.95, slot: 's1' },
    { label: `Prior ${BASE_AVAILABILITY}`, rate: BASE_AVAILABILITY, slot: 's2' },
    { label: 'Dinged 0.75', rate: 0.75, slot: 's3' },
    { label: 'Fragile 0.60', rate: 0.6, slot: 's4' },
  ]
  const adjusted = useMemo(
    () =>
      rostered
        .map((id) => ({ id, c: data.context[id] }))
        .filter((r) => r.c && (r.c.lost > 0.05 || r.c.gained > 0.05))
        .sort((a, b) => Math.abs(b.c.adjusted - b.c.raw) - Math.abs(a.c.adjusted - a.c.raw)),
    [rostered.join(','), data.context], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const totalLost = adjusted.reduce((a, r) => a + r.c.lost, 0)
  const totalGained = adjusted.reduce((a, r) => a + r.c.gained, 0)
  const owner = (id: string) => (analysis.rosteredBy[id] === analysis.myRosterId ? <span className="text-ff-accent">you</span> : analysis.teamById[analysis.rosteredBy[id]]?.name)

  return (
    <div className="space-y-3">
      <StatGrid className="xl:grid-cols-4">
        <Stat label="League prior" value={pct(BASE_AVAILABILITY)} sub="share of games suited up" />
        <Stat label="Rostered median" value={rates.length ? pct([...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)]) : '–'} sub={`${rates.length} skill players`} />
        <Stat label="Pts/wk removed" value={fmt(totalLost)} sub="injury risk, league-wide" />
        <Stat label="Pts/wk reassigned" value={fmt(totalGained)} sub="to next men up" />
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="P(play) for a healthy player, by weeks ahead">
          <MiniLines
            xs={weeksAhead}
            series={curves.map((c) => ({ label: c.label, slot: c.slot, values: weeksAhead.map((w) => playProbability(c.rate, w)) }))}
            yMin={0.5}
            yMax={1}
            yFormat={(v) => pct(v)}
            xLabel={(x) => `+${x}`}
          />
          <div className="mt-2">
            <Code>{`P(play, t) = r + (1 − r) · ${HEALTHY_DECAY}^t`}</Code>
          </div>
        </Panel>
        <Panel title="Long-run availability, rostered" actions={<span className="num">n={rates.length}</span>}>
          <Histogram values={rates} bins={20} marker={BASE_AVAILABILITY} markerLabel="prior" format={(v) => pct(v)} />
          <div className="mt-2">
            <Code>{`r = (played + ${AVAILABILITY_PRIOR_GAMES}·${BASE_AVAILABILITY}) / (games + ${AVAILABILITY_PRIOR_GAMES})`}</Code>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Constants" pad={false} actions={<span className="font-mono text-[10.5px]">context.ts</span>}>
          <Spec
            stacked
            rows={[
              { k: 'BASE_AVAILABILITY', v: BASE_AVAILABILITY, note: 'Games suited up, skill players 2024–25.' },
              { k: 'AVAILABILITY_PRIOR', v: `${AVAILABILITY_PRIOR_GAMES} g`, note: 'Year-to-year r = 0.42 → 17·(1−r)/r.' },
              { k: 'HEALTHY_DECAY', v: HEALTHY_DECAY, note: 'Next game near-certain; risk climbs after.' },
              { k: 'NEXT_MAN_SHARE', v: NEXT_MAN_SHARE, note: 'Of moved points, share to the direct backup.' },
            ]}
          />
        </Panel>
        <Panel title="Designation vs projection → P(play)">
          <HBars rows={Object.entries(STATUS_PLAY).map(([k, v]) => ({ key: k, label: k, value: v }))} format={(v) => pct(v)} max={1} />
          <p className="mt-2 text-[11.5px] text-ff-muted">Used only when Sleeper still projects a player its own report rules out.</p>
        </Panel>
        <Panel title="Points that move to teammates">
          <HBars rows={Object.entries(TRANSFER).map(([k, v]) => ({ key: k, label: k, value: v }))} format={(v) => pct(v)} max={1} slot="s2" />
          <p className="mt-2 text-[11.5px] text-ff-muted">Measured on 2026 weeks where Sleeper zeroes a starter and later brings him back.</p>
        </Panel>
      </div>

      <Panel title="Largest adjustments on rosters" pad={false} actions={<span className="num">{adjusted.length} players</span>}>
        <Table
          rows={adjusted}
          rowKey={(r) => r.id}
          maxHeight={420}
          defaultSort="net"
          columns={[
            { key: 'p', label: 'Player', sticky: true, sort: (r) => players[r.id]?.name ?? '', render: (r) => <PlayerName player={players[r.id]} id={r.id} size={22} sub={owner(r.id)} /> },
            { key: 'raw', label: 'Base', align: 'right', title: 'Before injury and role adjustments', sort: (r) => r.c.raw, render: (r) => fmt(r.c.raw) },
            { key: 'adj', label: 'Exp', align: 'right', sort: (r) => r.c.adjusted, render: (r) => <span className="text-ff-text">{fmt(r.c.adjusted)}</span> },
            {
              key: 'lost',
              label: 'Risk',
              align: 'right',
              hideBelow: 'sm',
              sort: (r) => r.c.lost,
              render: (r) => (r.c.lost > 0.05 ? <span className="text-ff-neg">−{fmt(r.c.lost, 2)}</span> : <span className="text-ff-muted">·</span>),
            },
            {
              key: 'gain',
              label: 'Inherits',
              align: 'right',
              hideBelow: 'sm',
              sort: (r) => r.c.gained,
              render: (r) => (r.c.gained > 0.05 ? <span className="text-ff-pos">+{fmt(r.c.gained, 2)}</span> : <span className="text-ff-muted">·</span>),
            },
            { key: 'net', label: 'Net', align: 'right', sort: (r) => Math.abs(r.c.adjusted - r.c.raw), render: (r) => <Num value={r.c.adjusted - r.c.raw} signed digits={2} /> },
            { key: 'play', label: 'Plays', align: 'right', sort: (r) => r.c.play, render: (r) => <span className={r.c.play < 0.8 ? 'text-ff-neg' : ''}>{pct(r.c.play)}</span> },
            {
              key: 'hist',
              label: 'History',
              align: 'right',
              hideBelow: 'md',
              title: 'Games played of team games in the seasons counted, and the shrunk rate',
              sort: (r) => r.c.availability?.rate ?? 1,
              render: (r) => (r.c.availability ? `${r.c.availability.played}/${r.c.availability.games} · ${pct(r.c.availability.rate)}` : '–'),
            },
          ]}
        />
      </Panel>
    </div>
  )
}

// ---------- Trade engine ----------

const CONFIG_NOTES: Record<keyof TradeConfig, string> = {
  maxGive: 'Most players you send in one deal.',
  maxGet: 'Most players you take back.',
  maxPlayers: 'Both sides together.',
  getPerTeam: 'Their players seeding the search, by what each adds to you.',
  beamWidth: 'Partial deals kept per partner at each growth step.',
  minMyGain: 'Pts/wk the deal must add to your optimal lineup.',
  minTheirGain: 'Pts/wk it must add to theirs. Default; the Limits sliders on Trades override it.',
  maxValueAsk: 'Market value you may ask for beyond what you send. Default; the Limits sliders on Trades override it.',
  scoredPerTeam: 'Shortlist per partner that gets exact week-by-week scoring.',
  perPartner: 'Most suggestions from one roster.',
  limit: 'Suggestions returned.',
}

const EngineTab = ({ data, analysis, baseline }: { data: LeagueData; analysis: Analysis; baseline: Analysis }) => {
  const positions = Object.keys(analysis.horizonStarter).filter((p) => analysis.horizonReplacement[p] != null)
  const rows = positions.map((pos) => ({ pos, repl: analysis.horizonReplacement[pos] ?? 0, starter: analysis.horizonStarter[pos] ?? 0, base: baseline.horizonReplacement[pos] ?? 0 }))
  const maxStarter = Math.max(1, ...rows.map((r) => r.starter))
  const playoff = new Set(data.playoffWeeks)
  const totalWeight = data.horizon.reduce((a, w) => a + (w.weight ?? 1), 0) || 1
  const modeLabel = data.horizonMode === 'next6' ? 'Next 6 weeks' : data.horizonMode === 'regular' ? 'Rest of regular season' : 'Rest of season + playoffs'

  return (
    <div className="space-y-3">
      <StatGrid className="xl:grid-cols-4">
        <Stat label="Pricing horizon" value={`${data.horizon.length} wk`} sub={modeLabel} />
        <Stat
          label="Playoff weight"
          value={data.horizonMode === 'playoffs' && data.playoffWeeks.length ? `×${data.playoffWeight}` : '–'}
          sub={data.playoffWeeks.length ? `wks ${data.playoffWeeks.join(', ')}` : 'no playoff weeks'}
        />
        <Stat label="Roster capacity" value={analysis.capacity} sub="extra bodies force a cut" />
        <Stat label="Waiver depth" value={DEFAULT_WAIVER_DEPTH} sub="replacement bodies per position" />
      </StatGrid>

      <Panel title="Horizon weeks and weights" actions={<span className="font-mono text-[10.5px]">source: {data.horizonSource}</span>}>
        {data.horizon.length ? (
          <div className="ff-scroll flex gap-[2px] overflow-x-auto pb-1">
            {data.horizon.map((w) => {
              const share = (w.weight ?? 1) / totalWeight
              return (
                <div key={w.week} className="flex min-w-[22px] flex-1 flex-col items-center gap-1" title={`Week ${w.week}: weight ${fmt(w.weight ?? 1, 2)} (${pct(share)} of the price)`}>
                  <div className="flex h-16 w-full items-end rounded-[3px] bg-ff-sunken">
                    <span
                      className={cx('w-full rounded-t-[4px]', playoff.has(w.week) ? 'bg-ff-s3' : 'bg-ff-s1')}
                      style={{ height: `${Math.max(4, (share / Math.max(...data.horizon.map((x) => (x.weight ?? 1) / totalWeight))) * 100)}%` }}
                    />
                  </div>
                  <span className="num text-[10.5px] text-ff-text2">{w.week}</span>
                  <span className="num text-[10px] text-ff-muted">{pct(share)}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-[12.5px] text-ff-muted">No weeks left to price.</p>
        )}
        <div className="mt-2">
          <Legend items={[{ label: 'Regular season', slot: 's1' }, ...(data.playoffWeeks.some((w) => data.horizon.some((h) => h.week === w)) ? [{ label: 'Fantasy playoffs', slot: 's3' }] : [])]} />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Position pricing over the horizon" pad={false}>
          <Table
            rows={rows}
            rowKey={(r) => r.pos}
            dense
            columns={[
              { key: 'pos', label: 'Pos', render: (r) => <span className="font-mono text-[11.5px] text-ff-text">{r.pos}</span> },
              { key: 'repl', label: 'Waiver floor', align: 'right', title: 'Replacement level per active week: what an empty slot is filled with', render: (r) => fmt(r.repl) },
              ...(analysis !== baseline ? [{ key: 'd', label: 'Δ', align: 'right' as const, render: (r: (typeof rows)[number]) => <Num value={r.repl - r.base} signed /> }] : []),
              { key: 'st', label: 'Avg starter', align: 'right', render: (r) => <span className="text-ff-text">{fmt(r.starter)}</span> },
              {
                key: 'gap',
                label: 'Starter premium',
                align: 'right',
                title: 'Average starter minus waiver floor: what a hole at this position costs per week',
                render: (r) => (
                  <span className="flex items-center justify-end gap-2">
                    <span className="hidden h-2 w-20 overflow-hidden rounded-[2px] bg-ff-sunken sm:block">
                      <span className="block h-full rounded-r-[3px] bg-ff-s1" style={{ width: `${Math.max(0, (r.starter - r.repl) / maxStarter) * 100}%` }} />
                    </span>
                    <span className="text-ff-text">{fmt(r.starter - r.repl)}</span>
                  </span>
                ),
              },
            ]}
          />
        </Panel>
        <Panel title="Search config, as the Trades page runs it" pad={false}>
          <Spec
            rows={(Object.keys(DEFAULT_TRADE_CONFIG) as (keyof TradeConfig)[]).map((k) => {
              const live = SUGGESTED_TRADE_CONFIG[k] ?? DEFAULT_TRADE_CONFIG[k]
              return { k, v: live, note: live !== DEFAULT_TRADE_CONFIG[k] ? `${CONFIG_NOTES[k]} Library default ${DEFAULT_TRADE_CONFIG[k]}.` : CONFIG_NOTES[k] }
            })}
          />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Search objective">
          <Code>{`objective = myGain
          + 0.30 · min(theirGain, myGain)
          − 2.50 · max(0, minTheirGain − theirGain)
          − 0.60 · max(0, valueAsk − maxValueAsk)
          − 0.15 · max(0, players − 2)`}</Code>
          <p className="mt-2 text-[12px] leading-relaxed text-ff-muted">
            Ranks partial deals while the beam grows. The final list is scored exactly: each week&apos;s optimal lineup, before and after, for both teams, with the side taking extra bodies cutting its
            least useful player.
          </p>
        </Panel>
        <Panel title="Pipeline" pad={false}>
          <ol className="divide-y divide-ff-line">
            {[
              ['seed', `Every 1-for-1: their top ${DEFAULT_TRADE_CONFIG.getPerTeam} by what they add to you × all of yours.`],
              ['grow', `Add one player to either side, keep the best ${DEFAULT_TRADE_CONFIG.beamWidth} per partner, only when the objective improves by > 0.05.`],
              ['diversify', 'Keep each makeup’s best (1-for-1, consolidate, depth, swap) so one shape can’t crowd out the rest.'],
              ['score', `Exact week-by-week scoring on ${DEFAULT_TRADE_CONFIG.scoredPerTeam} per partner.`],
              ['trim', 'Drop any player whose removal leaves both sides at least as well off.'],
              ['dedupe', 'Near-copies (≥ 60% overlap) fold into versions, at most 3, each better for them.'],
            ].map(([k, v], i) => (
              <li key={k} className="grid grid-cols-[22px_74px_minmax(0,1fr)] items-baseline gap-2 px-3 py-1.5 text-[12px]">
                <span className="num text-ff-muted">{i + 1}</span>
                <code className="font-mono text-[11.5px] text-ff-text">{k}</code>
                <span className="text-ff-text2">{v}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  )
}

// ---------- Data ----------

const DataTab = ({ data, analysis, reload }: { data: LeagueData; analysis: Analysis; reload: () => void }) => {
  const matchupWeeks = Object.keys(data.matchupsByWeek).length
  const scheduleGames = data.schedule ? Object.values(data.schedule.opp).reduce((a, o) => a + Object.keys(o).length, 0) / 2 : 0
  const rows: { src: string; what: string; n: ReactNode; ttl: string }[] = [
    { src: '/players/nfl', what: 'Player database', n: Object.keys(data.players).length, ttl: '24h' },
    { src: '/league/{id}', what: data.league.name, n: `${data.league.total_rosters} teams`, ttl: '30m' },
    { src: '/league/{id}/rosters', what: 'Rosters', n: data.rosters.length, ttl: '10m' },
    { src: '/league/{id}/matchups/{w}', what: 'Weekly matchups', n: `${matchupWeeks} wks`, ttl: 'past 24h · live 5m' },
    { src: '/stats/nfl/regular/{s}/{w}', what: `Weekly stats (${data.valueSeason})`, n: `${data.valueWeeks.length} wks`, ttl: 'past 24h · live 10m' },
    { src: '/projections/nfl/regular/{s}/{w}', what: 'Weekly projections', n: `${data.rawHorizon.length} wks`, ttl: '3h near · 12h far' },
    { src: '/stats/nfl/regular/{s}', what: 'Season games played (history)', n: `${Object.keys(data.availability).length} players`, ttl: '7d' },
    { src: '/schedule/nfl/regular/{s}', what: 'NFL schedule', n: `${Math.round(scheduleGames)} games`, ttl: '12h' },
    { src: '/players/nfl/trending/add', what: 'Trending adds', n: data.trending.length, ttl: '1h' },
    { src: '/league/{id}/transactions/{w}', what: `Transactions${data.history ? ` (+${data.history.season})` : ''}`, n: data.transactions.length + (data.history?.transactions.length ?? 0), ttl: 'past 24h · live 10m' },
    { src: '/lines/available?sports[]=nfl', what: `Prop lines${data.market ? ` (wk ${data.market.week})` : ''}`, n: data.market ? `${data.market.props} props · ${data.market.players} players` : 'none open', ttl: '20m' },
    { src: 'github:dynastyprocess/…/db_fpecr_latest.csv', what: `FantasyPros ECR ${data.consensus?.date ?? ''}`, n: data.consensus ? `${data.consensus.matched} matched` : 'unavailable', ttl: '12h' },
  ]
  return (
    <div className="space-y-3">
      <StatGrid className="xl:grid-cols-4">
        <Stat label="Week" value={data.state.week ?? '–'} sub={`${data.state.season} ${data.state.season_type}`} />
        <Stat label="Points source" value={<span className="text-[15px]">{data.pointsSource}</span>} sub="for player value" />
        <Stat label="Horizon source" value={<span className="text-[15px]">{data.horizonSource}</span>} sub="for trade pricing" />
        <Stat label="Players modelled" value={Object.keys(analysis.values).length} sub={`${Object.keys(analysis.rosteredBy).length} rostered`} />
      </StatGrid>
      <Panel title="Sources" pad={false} actions={<span className="font-mono text-[10.5px]">sleeper · github raw</span>}>
        <Table
          rows={rows}
          rowKey={(r) => r.src}
          dense
          columns={[
            { key: 'src', label: 'Endpoint', render: (r) => <code className="font-mono text-[11.5px] text-ff-text2">{r.src}</code> },
            { key: 'what', label: 'Feeds', hideBelow: 'sm', render: (r) => <span className="text-ff-text">{r.what}</span> },
            { key: 'n', label: 'Rows', align: 'right', render: (r) => r.n },
            { key: 'ttl', label: 'Cache', align: 'right', hideBelow: 'md', render: (r) => <span className="text-ff-muted">{r.ttl}</span> },
          ]}
        />
      </Panel>
      {data.warnings.length > 0 && (
        <Panel title="Warnings">
          <ul className="space-y-1 text-[12.5px] text-ff-warn">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Cache">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-[12.5px] text-ff-muted">
            Responses are cached in this browser under <code className="font-mono text-ff-text2">ff:v2:*</code>. Clearing forces every endpoint above to refetch.
          </p>
          <Button
            onClick={() => {
              clearFantasyCache()
              reload()
            }}
          >
            Clear cache and reload
          </Button>
        </div>
      </Panel>
    </div>
  )
}

export default ModelView
