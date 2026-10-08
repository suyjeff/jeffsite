import React, { useMemo, useState } from 'react'
import { acceptRead } from '../../../lib/fantasy/behavior'
import { pastProjection } from '../../../lib/fantasy/analysis'
import { deadStarters } from '../../../lib/fantasy/lineup'
import { isWaiverFill, makeLineupEval } from '../../../lib/fantasy/trades'
import { PROP_LABEL } from '../../../lib/fantasy/lines'
import { searchTrades, waiverTargets } from '../../../lib/fantasy/search'
import AdjustControl from '../AdjustControl'
import { describeNote } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import { Avatar, Badge, CenterMeter, Empty, Num, PlayerAvatar, PosTag, Segmented, Sparkline, ago, compact, cx, fmt, fmtSigned, odds, pct } from '../ui'

/** A widget reads and writes the selection on its channel: a team, a player, or both. */
export type Selection = { team?: number; player?: string }
export type WidgetProps = { sel: Selection; select: (s: Selection) => void; w: number; h: number }

export type WidgetKind =
  | 'matchup'
  | 'odds'
  | 'scoreboard'
  | 'trades'
  | 'lineup'
  | 'power'
  | 'standings'
  | 'injuries'
  | 'waivers'
  | 'player'
  | 'team'
  | 'consensus'
  | 'activity'
  | 'props'

type Meta = { title: string; blurb: string; w: number; h: number; Body: (p: WidgetProps) => JSX.Element; reads?: 'team' | 'player' }

// ---------- Shared bits ----------

const Row = ({ children, onClick, active, className }: { children: React.ReactNode; onClick?: () => void; active?: boolean; className?: string }) => (
  <div
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    className={cx('flex h-8 items-center gap-2 border-b border-ff-line/60 px-3 text-[12.5px] last:border-0', onClick && 'cursor-pointer hover:bg-ff-raised', active && 'bg-ff-raised', className)}
  >
    {children}
  </div>
)

const Th = ({ children }: { children: React.ReactNode }) => <div className="ff-label sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-ff-line bg-ff-panel px-3">{children}</div>

/** A bar inside a cell: hairline track, solid fill, square ends. */
const Bar = ({ value, max = 1, slot = 'accent', width = 48 }: { value: number; max?: number; slot?: string; width?: number }) => (
  <span className="inline-block h-[6px] bg-ff-sunken align-middle" style={{ width }}>
    <span className="block h-full" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: `rgb(var(--ff-${slot}))` }} />
  </span>
)

const TeamTag = ({ id, me }: { id: number; me?: boolean }) => {
  const { analysis } = useFantasy()
  const t = analysis.teamById[id]
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      <Avatar src={t?.avatar ?? null} name={t?.name ?? '?'} size={16} />
      <span className={cx('truncate', me || id === analysis.myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t?.name ?? `#${id}`}</span>
    </span>
  )
}

const NoForecast = () => <Empty title="No forecast">Needs Sleeper projections for the weeks ahead.</Empty>

// ---------- Widgets ----------

/**
 * Teams whose lineup in Sleeper has a starter who cannot score this week (bye,
 * out, or an empty slot), with what that lineup projects as set. The forecast
 * already assumes the best lineup, so this only explains a gap with Sleeper.
 */
const useUnsetLineups = (week: number | null) => {
  const { data, analysis } = useFantasy()
  return useMemo(() => {
    const out: Record<number, { names: string[]; asSet: number }> = {}
    const h = week != null ? data.horizon.find((x) => x.week === week) : null
    if (!h) return out
    for (const m of data.matchupsByWeek[week!] ?? []) {
      const dead = deadStarters(analysis.slots, m.starters ?? undefined, h.pts)
      if (!dead.length) continue
      const asSet = (m.starters ?? []).reduce((a, id) => a + (id && id !== '0' ? (h.pts[id] ?? 0) : 0), 0)
      out[m.roster_id] = { names: dead.map((d) => (d.id ? (data.players[d.id]?.name ?? d.id) : `empty ${d.slot.name}`)), asSet }
    }
    return out
  }, [week, data, analysis.slots])
}

const unsetNote = (u: { names: string[]; asSet: number }) =>
  `Lineup not set: ${u.names.join(', ')} can't score this week. As set in Sleeper it projects ${fmt(u.asSet)}; this assumes the manager swaps in the best option.`

/** This week's pairings with each side's expectation and win probability. */
const Scoreboard = ({ sel, select }: WidgetProps) => {
  const { models, data } = useFantasy()
  const f = models.forecast
  const unset = useUnsetLineups(f?.nextWeek[0]?.week ?? null)
  if (!f || !f.nextWeek.length) return <NoForecast />
  const week = f.nextWeek[0].week
  const live = data.matchupsByWeek[week] ?? []
  const pts = (rid: number) => live.find((m) => m.roster_id === rid)?.points ?? 0
  // Once the week has started, every row shows live points; before, every row shows expectations. Never a mix.
  const started = live.some((m) => (m.points ?? 0) > 0)
  return (
    <div>
      <Th>
        <span className="w-full">wk {week}</span>
        <span className="shrink-0">{started ? 'live' : 'exp'}</span>
        <span className="w-16 shrink-0 text-center" title={started ? 'Pre-game win probability' : undefined}>
          {started ? 'pre' : 'win'}
        </span>
        <span className="shrink-0">{started ? 'live' : 'exp'}</span>
      </Th>
      {f.nextWeek.map((g) => (
        <Row key={`${g.a}-${g.b}`} active={sel.team === g.a || sel.team === g.b}>
          <button onClick={() => select({ team: g.a })} className="min-w-0 flex-1 text-left">
            <TeamTag id={g.a} />
          </button>
          <span className="num w-10 shrink-0 text-right text-ff-text" title={!started && unset[g.a] ? unsetNote(unset[g.a]) : undefined}>
            {!started && unset[g.a] && <span className="text-ff-warn">*</span>}
            {fmt(started ? pts(g.a) : g.muA)}
          </span>
          <span className="flex w-16 shrink-0 items-center gap-1">
            <span className="num w-7 text-right text-[10.5px] text-ff-text2">{Math.round(g.pA * 100)}</span>
            <span className="flex h-[6px] flex-1 bg-ff-s2/60">
              <span className="h-full bg-ff-s1" style={{ width: `${g.pA * 100}%` }} />
            </span>
          </span>
          <span className="num w-10 shrink-0 text-ff-text" title={!started && unset[g.b] ? unsetNote(unset[g.b]) : undefined}>
            {fmt(started ? pts(g.b) : g.muB)}
            {!started && unset[g.b] && <span className="text-ff-warn">*</span>}
          </span>
          <button onClick={() => select({ team: g.b })} className="flex min-w-0 flex-1 justify-end text-right">
            <TeamTag id={g.b} />
          </button>
        </Row>
      ))}
      <div className="px-3 py-1.5 font-mono text-[10px] text-ff-muted">
        bar = left team&apos;s pre-game chance · {started ? 'scores are live' : 'scores are expectations'}
        {!started && Object.keys(unset).length > 0 && <> · <span className="text-ff-warn">*</span> lineup has a bye/out starter; expectation assumes the swap</>}
      </div>
    </div>
  )
}

/** Season simulation: projected wins, playoff, bye and title odds. */
const Odds = ({ sel, select }: WidgetProps) => {
  const { models, analysis } = useFantasy()
  const f = models.forecast
  if (!f) return <NoForecast />
  const rows = [...f.ratings].sort((a, b) => f.sim[b.rosterId].title - f.sim[a.rosterId].title || f.sim[b.rosterId].playoffs - f.sim[a.rosterId].playoffs)
  const maxTitle = Math.max(0.01, ...rows.map((r) => f.sim[r.rosterId].title))
  return (
    <div>
      <Th>
        <span className="flex-1">team</span>
        <span className="hidden w-9 text-right sm:inline">rec</span>
        <span className="w-10 text-right" title="Expected points per week">rtg</span>
        <span className="hidden w-9 text-right sm:inline" title="Mean simulated wins">W</span>
        <span className="w-10 text-right">PO</span>
        <span className="hidden w-9 text-right sm:inline">bye</span>
        <span className="w-[78px] text-right">title</span>
      </Th>
      {rows.map((r) => {
        const s = f.sim[r.rosterId]
        const season = analysis.seasonById[r.rosterId]
        return (
          <Row key={r.rosterId} onClick={() => select({ team: r.rosterId })} active={sel.team === r.rosterId}>
            <span className="min-w-0 flex-1">
              <TeamTag id={r.rosterId} />
            </span>
            <span className="num hidden w-9 text-right text-ff-text2 sm:inline">
              {season.wins}-{season.losses}
            </span>
            <span className="num w-10 text-right text-ff-text">{fmt(r.rating)}</span>
            <span className="num hidden w-9 text-right text-ff-text2 sm:inline">{fmt(s.wins)}</span>
            <span className={cx('num w-10 text-right', s.playoffs >= 0.5 ? 'text-ff-text' : 'text-ff-muted')}>{odds(s.playoffs, 0, s.clinch)}</span>
            <span className="num hidden w-9 text-right text-ff-text2 sm:inline">{odds(s.bye, 0, s.clinch === 'out' ? 'out' : null)}</span>
            <span className="flex w-[78px] items-center justify-end gap-1.5">
              <Bar value={s.title} max={maxTitle} width={30} />
              <span className="num w-9 text-right text-ff-text">{odds(s.title, s.title < 0.1 ? 1 : 0, s.clinch === 'out' ? 'out' : null)}</span>
            </span>
          </Row>
        )
      })}
      <div className="px-3 py-1.5 font-mono text-[10px] text-ff-muted">
        {f.sims.toLocaleString()} seasons · weekly σ {fmt(f.sigma)} · season τ {fmt(f.tau)}
      </div>
    </div>
  )
}

/** Next week's lineups, side by side, from the adjusted projections. */
const useWeekLineup = (rosterId: number | null, week: number | null) => {
  const { data, analysis } = useFantasy()
  return useMemo(() => {
    if (rosterId == null || week == null) return null
    const h = data.horizon.find((x) => x.week === week)
    if (!h) return null
    const ev = makeLineupEval(analysis.slots, data.players, h.pts, analysis.horizonReplacement)
    const res = ev.assign(analysis.teamById[rosterId].players)
    return analysis.slots.map((slot, i) => {
      const p = res.assignments[i]
      return { slot: slot.name.replace('SUPER_FLEX', 'SF'), id: p && !isWaiverFill(p.id) ? p.id : null, pts: p ? p.pts : 0 }
    })
  }, [rosterId, week, data, analysis])
}

const Matchup = ({ select }: WidgetProps) => {
  const { models, analysis, data } = useFantasy()
  const f = models.forecast
  const me = analysis.myRosterId
  const game = f?.nextWeek.find((g) => g.a === me || g.b === me)
  const flip = game && game.b === me
  const mine = game ? (flip ? game.b : game.a) : null
  const opp = game ? (flip ? game.a : game.b) : null
  const left = useWeekLineup(mine, game?.week ?? null)
  const right = useWeekLineup(opp, game?.week ?? null)
  const unset = useUnsetLineups(game?.week ?? null)
  if (!f || !game || mine == null || opp == null) return <NoForecast />
  const p = flip ? 1 - game.pA : game.pA
  const muMe = flip ? game.muB : game.muA
  const muOpp = flip ? game.muA : game.muB
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 border-b border-ff-line px-3 py-3">
        <div className="min-w-0">
          <TeamTag id={mine} />
          <div className="num mt-1 text-[26px] leading-none text-ff-text">{fmt(muMe)}</div>
        </div>
        <div className="pb-0.5 text-center">
          <div className="ff-label">wk {game.week} · win</div>
          <div className={cx('num text-[26px] leading-none', p >= 0.5 ? 'text-ff-pos' : 'text-ff-neg')}>{Math.round(p * 100)}%</div>
        </div>
        <div className="flex min-w-0 flex-col items-end">
          <TeamTag id={opp} />
          <div className="num mt-1 text-[26px] leading-none text-ff-text2">{fmt(muOpp)}</div>
        </div>
      </div>
      <div className="flex h-1.5">
        <span className="h-full bg-ff-s1" style={{ width: `${p * 100}%` }} />
        <span className="h-full flex-1 bg-ff-s2/70" />
      </div>
      {[mine, opp].map((rid) =>
        unset[rid] ? (
          <div key={rid} className="border-b border-ff-line px-3 py-1.5 text-[11.5px] leading-snug text-ff-text2">
            <span className="text-ff-warn">{rid === mine ? 'Your' : `${analysis.teamById[rid].name}'s`} lineup isn&apos;t set</span>: {unset[rid].names.join(', ')} can&apos;t score. As set it projects{' '}
            <span className="num">{fmt(unset[rid].asSet)}</span>; the {fmt(rid === mine ? muMe : muOpp)} assumes {rid === mine ? 'you swap' : 'they swap'}.
          </div>
        ) : null,
      )}
      <div className="grid flex-1 grid-cols-2 divide-x divide-ff-line">
        {[left, right].map((side, k) => (
          <div key={k}>
            {(side ?? []).map((s, i) => (
              <div key={i} className="flex h-7 items-center gap-2 border-b border-ff-line/60 px-3 text-[12px]">
                <span className="w-8 shrink-0 font-mono text-[10px] text-ff-muted">{s.slot}</span>
                {s.id ? (
                  <button onClick={() => select({ player: s.id! })} className="min-w-0 flex-1 truncate text-left text-ff-text hover:underline">
                    {data.players[s.id]?.name}
                  </button>
                ) : (
                  <span className="flex-1 text-ff-muted">waiver</span>
                )}
                <span className="num shrink-0 text-ff-text2">{fmt(s.pts)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const TradeIdeas = () => {
  const { data, analysis, models, go } = useFantasy()
  const ideas = useMemo(() => searchTrades(data, analysis).ideas, [data, analysis])
  if (!ideas.length) return <Empty title="No deals clear the bar">Loosen the limits on the Trades page.</Empty>
  // One per partner, best for you first.
  const seen = new Set<number>()
  const top = [...ideas].sort((a, b) => b.myGain - a.myGain).filter((i) => (seen.has(i.partnerId) ? false : (seen.add(i.partnerId), true)))
  const name = (id: string) => data.players[id]?.name.split(' ').slice(-1)[0] ?? id
  return (
    <div>
      <Th>
        <span className="w-[120px] shrink-0">partner</span>
        <span className="flex-1">send → get</span>
        <span className="w-12 text-right">you</span>
        <span className="w-12 text-right">them</span>
        <span className="hidden w-16 text-right sm:inline">odds</span>
      </Th>
      {top.map((i) => {
        const read = acceptRead(i, analysis.myRosterId ?? -1, models.behavior, models.perceived)
        return (
          <Row key={`${i.partnerId}-${i.give.join()}-${i.get.join()}`} onClick={() => go('trades')}>
            <span className="w-[120px] shrink-0">
              <TeamTag id={i.partnerId} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
              <span className="text-ff-text2">{i.give.map(name).join(' + ')}</span>
              <span className="px-1.5 text-ff-muted">→</span>
              <span className="text-ff-text">{i.get.map(name).join(' + ')}</span>
            </span>
            <Num value={i.myGain} signed className="w-12 text-right" />
            <Num value={i.theirGain} signed className="w-12 text-right" />
            <span className="hidden w-16 text-right font-mono text-[10.5px] sm:inline" title={read.reasons.join('; ')}>
              <span className={read.band === 'likely' ? 'text-ff-pos' : read.band === 'possible' ? 'text-ff-text2' : 'text-ff-muted'}>{read.index}</span>
              <span className="text-ff-muted"> /100</span>
            </span>
          </Row>
        )
      })}
    </div>
  )
}

const Lineup = ({ sel, select }: WidgetProps) => {
  const { models, analysis, data } = useFantasy()
  const week = models.forecast?.nextWeek[0]?.week ?? data.horizon[0]?.week ?? null
  const rows = useWeekLineup(analysis.myRosterId, week)
  if (!rows) return <NoForecast />
  return (
    <div>
      <Th>
        <span className="w-9">slot</span>
        <span className="flex-1">wk {week} optimal</span>
        <span className="w-12 text-right">exp</span>
        <span className="w-10 text-right">plays</span>
      </Th>
      {rows.map((r, i) => (
        <Row key={i} onClick={r.id ? () => select({ player: r.id! }) : undefined} active={!!r.id && sel.player === r.id}>
          <span className="w-9 font-mono text-[10.5px] text-ff-muted">{r.slot}</span>
          <span className="min-w-0 flex-1">{r.id ? <PlayerName player={data.players[r.id]} id={r.id} size={18} avatar={false} /> : <span className="text-ff-muted">waiver fill</span>}</span>
          <span className="num w-12 text-right text-ff-text">{fmt(r.pts)}</span>
          <span className="num w-10 text-right text-ff-text2">{r.id ? pct(data.context[r.id]?.play) : ''}</span>
        </Row>
      ))}
    </div>
  )
}

type PowerModel = 'forecast' | 'composite' | 'elo'
const Power = ({ sel, select }: WidgetProps) => {
  const { models, analysis } = useFantasy()
  const [m, setM] = useState<PowerModel>(models.forecast ? 'forecast' : 'composite')
  const rows = analysis.teams.map((t) => {
    const v = m === 'forecast' ? (models.forecast?.byId[t.rosterId]?.rating ?? 0) : m === 'elo' ? (models.elo.final[t.rosterId] ?? 1500) : analysis.powerById[t.rosterId].score
    return { id: t.rosterId, v }
  })
  rows.sort((a, b) => b.v - a.v)
  // Bars grow from the league average, so a gap reads at its true size instead of stretched end to end.
  const mid = m === 'composite' ? 50 : m === 'elo' ? 1500 : rows.reduce((a, r) => a + r.v, 0) / (rows.length || 1)
  const reach = Math.max(...rows.map((r) => Math.abs(r.v - mid)), m === 'composite' ? 25 : m === 'elo' ? 150 : 15)
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5">
        <Segmented<PowerModel>
          size="sm"
          label="Ranking model"
          value={m}
          onChange={setM}
          options={[
            ...(models.forecast ? [{ key: 'forecast' as const, label: 'Forecast', title: 'Expected points per week: projected lineup × lineup efficiency' }] : []),
            { key: 'composite', label: 'Composite', title: 'Results-weighted composite (Power page weights)' },
            { key: 'elo', label: 'Elo', title: 'Results-only Elo with a carried-over prior' },
          ]}
        />
        <span className="font-mono text-[10px] text-ff-muted">{m === 'forecast' ? 'pts/wk' : m === 'elo' ? 'elo' : 'win % vs avg'}</span>
      </div>
      {rows.map((r, i) => (
        <Row key={r.id} onClick={() => select({ team: r.id })} active={sel.team === r.id}>
          <span className="num w-5 text-ff-muted">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <TeamTag id={r.id} />
          </span>
          <CenterMeter value={(r.v - mid) / reach} width={56} />
          <span className="num w-12 text-right text-ff-text">{m === 'elo' ? Math.round(r.v) : fmt(r.v, m === 'forecast' ? 1 : 0)}</span>
        </Row>
      ))}
    </div>
  )
}

const Standings = ({ sel, select }: WidgetProps) => {
  const { analysis, data } = useFantasy()
  const cut = Number(data.league.settings?.playoff_teams ?? 6)
  const rows = [...analysis.seasons].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pf - a.pf)
  return (
    <div>
      <Th>
        <span className="w-5">#</span>
        <span className="flex-1">team</span>
        <span className="w-10 text-right">w-l</span>
        <span className="w-14 text-right">pf</span>
        <span className="hidden w-14 text-right sm:inline">pa</span>
        <span className="w-8 text-right">str</span>
      </Th>
      {rows.map((s, i) => (
        <Row key={s.rosterId} onClick={() => select({ team: s.rosterId })} active={sel.team === s.rosterId} className={cx(i === cut - 1 && 'border-b border-dashed border-b-ff-line2')}>
          <span className="num w-5 text-ff-muted">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <TeamTag id={s.rosterId} />
          </span>
          <span className="num w-10 text-right text-ff-text">
            {s.wins}-{s.losses}
          </span>
          <span className="num w-14 text-right text-ff-text2">{fmt(s.pf, 0)}</span>
          <span className="num hidden w-14 text-right text-ff-muted sm:inline">{fmt(s.pa, 0)}</span>
          <span className={cx('num w-8 text-right text-[11px]', s.streak.startsWith('W') ? 'text-ff-pos' : s.streak.startsWith('L') ? 'text-ff-neg' : 'text-ff-muted')}>{s.streak}</span>
        </Row>
      ))}
    </div>
  )
}

const Injuries = ({ sel, select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const [scope, setScope] = useState<'mine' | 'league'>('mine')
  const rows = useMemo(
    () =>
      Object.keys(analysis.rosteredBy)
        .filter((id) => (scope === 'mine' ? analysis.rosteredBy[id] === analysis.myRosterId : analysis.rosteredBy[id] !== analysis.myRosterId))
        .map((id) => ({ id, c: data.context[id] }))
        .filter((r) => r.c && (r.c.play < 0.9 || r.c.notes.some((n) => n.kind === 'status' || n.kind === 'bump' || n.kind === 'temporary')))
        .sort((a, b) => b.c.raw - a.c.raw)
        .slice(0, 30),
    [scope, data.context, analysis],
  )
  return (
    <div>
      <div className="flex items-center justify-between border-b border-ff-line px-3 py-1.5">
        <Segmented<'mine' | 'league'> size="sm" label="Scope" value={scope} onChange={setScope} options={[{ key: 'mine', label: 'Mine' }, { key: 'league', label: 'League' }]} />
        <span className="font-mono text-[10px] text-ff-muted">{rows.length} flagged</span>
      </div>
      {rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-ff-muted">Nothing flagged.</div>}
      {rows.map(({ id, c }) => {
        const note = c.notes.find((n) => n.kind === 'status' || n.kind === 'temporary' || n.kind === 'bump') ?? c.notes[0]
        const d = note ? describeNote(note, data.players) : null
        return (
          <Row key={id} onClick={() => select({ player: id })} active={sel.player === id}>
            <span className="min-w-0 flex-1">
              <PlayerName player={data.players[id]} id={id} size={18} avatar={false} />
            </span>
            {d && (
              <span className={cx('hidden max-w-[45%] truncate font-mono text-[10.5px] sm:inline', d.tone === 'good' ? 'text-ff-pos' : d.tone === 'bad' ? 'text-ff-neg' : d.tone === 'warn' ? 'text-ff-warn' : 'text-ff-muted')} title={d.title}>
                {d.label}
              </span>
            )}
            <span className={cx('num w-10 text-right', c.play < 0.8 ? 'text-ff-neg' : 'text-ff-text2')}>{pct(c.play)}</span>
          </Row>
        )
      })}
    </div>
  )
}

const Waivers = ({ sel, select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const me = analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
  const trending = useMemo(() => Object.fromEntries(data.trending.map((t) => [t.player_id, t.count])), [data.trending])
  const rows = useMemo(() => (me ? waiverTargets(data, analysis, { pool: 120, limit: 15 }) : []), [me, data, analysis])
  if (!rows.length) return <Empty title="Nobody on waivers helps">Your lineup beats every free agent at every slot.</Empty>
  return (
    <div>
      <Th>
        <span className="flex-1">free agent</span>
        <span className="w-12 text-right">+/wk</span>
        <span className="w-14 text-right">adds</span>
      </Th>
      {rows.map((t) => (
        <Row key={t.id} onClick={() => select({ player: t.id })} active={sel.player === t.id}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[t.id]} id={t.id} size={18} avatar={false} sub={t.slot ? `fills ${t.slot}` : undefined} />
          </span>
          <Num value={t.add} signed digits={2} className="w-12 text-right" />
          <span className="num w-14 text-right text-[11px] text-ff-muted">{trending[t.id] ? `↑${compact(trending[t.id])}` : ''}</span>
        </Row>
      ))}
    </div>
  )
}

const PlayerCard = ({ sel }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const fallback = useMemo(() => {
    const me = analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
    return me ? [...me.players].sort((a, b) => (analysis.market[b] ?? -99) - (analysis.market[a] ?? -99))[0] : Object.keys(analysis.market)[0]
  }, [analysis])
  const id = sel.player ?? fallback
  const p = id ? data.players[id] : undefined
  const marketRank = useMemo(() => {
    if (!p) return null
    const same = Object.keys(analysis.market).filter((x) => data.players[x]?.pos === p.pos).sort((a, b) => analysis.market[b] - analysis.market[a])
    return same.indexOf(id!) + 1 || null
  }, [p, id, analysis.market, data.players])
  if (!id || !p) return <Empty title="Pick a player">Select one in any widget on this channel.</Empty>
  const c = data.context[id]
  const v = analysis.values[id]
  const ecr = data.consensus?.byId[id]
  const owner = analysis.rosteredBy[id]
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-3 border-b border-ff-line p-3">
        <PlayerAvatar id={id} player={p} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PosTag pos={p.pos} />
            <span className="font-mono text-[11px] text-ff-muted">{p.team ?? 'FA'}</span>
            {p.injury && <Badge tone="warn">{p.injury}</Badge>}
          </div>
          <div className="mt-1 truncate text-[17px] font-medium leading-tight text-ff-text">{p.name}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-ff-muted">{owner === undefined ? 'free agent' : owner === analysis.myRosterId ? 'on your roster' : analysis.teamById[owner]?.name}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px border-b border-ff-line bg-ff-line">
        {[
          ['exp/wk', fmt(analysis.horizon.perWeek[id])],
          ['plays', pct(c?.play)],
          ['value', fmtSigned(analysis.market[id])],
          ['model rk', marketRank ? `${p.pos}${marketRank}` : '–'],
          ['ecr ros', ecr?.posRank ? `${p.pos}${Math.round(ecr.posRank)}` : '–'],
          ['ecr wk', ecr?.weekRank ? `${p.pos}${Math.round(ecr.weekRank)}` : '–'],
        ].map(([k, val]) => (
          <div key={k} className="bg-ff-panel px-3 py-1.5">
            <div className="ff-label">{k}</div>
            <div className="num text-[14px] text-ff-text">{val}</div>
          </div>
        ))}
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        <AdjustControl id={id} />
        {p.newsAt ? <div className="font-mono text-[10.5px] text-ff-muted">sleeper news {ago(p.newsAt)} ago</div> : null}
        {v && v.weekly.length > 0 && (
          <div>
            <div className="ff-label mb-1">weekly · {v.games} g · ppg {fmt(v.ppg)} · faded = projected</div>
            <Sparkline points={v.weekly.map((w) => w.pts)} projected={pastProjection(data, id, v.weekly.map((w) => w.week))} labels={v.weekly.map((w) => `Wk ${w.week}`)} width={220} height={36} />
          </div>
        )}
        {c?.schedule && c.schedule.length > 0 && (
          <div>
            <div className="ff-label mb-1">ahead</div>
            <div className="grid grid-cols-7 gap-px border border-ff-line bg-ff-line">
              {c.schedule.slice(0, 14).map((s) => (
                <span key={s.week} className={cx('bg-ff-panel py-0.5 text-center font-mono text-[10px]', s.playoff ? 'text-ff-accent' : s.opp ? 'text-ff-text2' : 'text-ff-muted')} title={`Week ${s.week}${s.playoff ? ' · fantasy playoffs' : ''}`}>
                  {s.opp ?? 'BYE'}
                </span>
              ))}
            </div>
          </div>
        )}
        {data.market?.byId[id] && <LinesBlock id={id} />}
        {c?.notes.length ? (
          <div className="space-y-0.5">
            {c.notes.map((n, i) => {
              const d = describeNote(n, data.players)
              return (
                <div key={i} className="font-mono text-[10.5px] text-ff-text2" title={d.title}>
                  › {d.label}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const TeamCard = ({ sel, select }: WidgetProps) => {
  const { data, analysis, models } = useFantasy()
  const id = sel.team ?? analysis.myRosterId ?? analysis.teams[0].rosterId
  const team = analysis.teamById[id]
  const r = models.forecast?.byId[id]
  const s = models.forecast?.sim[id]
  const roster = [...team.players].sort((a, b) => (analysis.horizon.perWeek[b] ?? 0) - (analysis.horizon.perWeek[a] ?? 0))
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-ff-line px-3 py-2">
        <Avatar src={team.avatar} name={team.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className={cx('truncate text-[14px] font-medium', id === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')}>{team.name}</div>
          <div className="truncate font-mono text-[10.5px] text-ff-muted">
            {analysis.seasonById[id].wins}-{analysis.seasonById[id].losses} · {team.owner}
          </div>
        </div>
        {r && s && (
          <div className="grid grid-cols-3 gap-3 text-right">
            {[
              ['rtg', fmt(r.rating)],
              ['po', odds(s.playoffs, 0, s.clinch)],
              ['title', odds(s.title, s.title < 0.1 ? 1 : 0, s.clinch === 'out' ? 'out' : null)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="ff-label">{k}</div>
                <div className="num text-[13px] text-ff-text">{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Th>
        <span className="flex-1">player</span>
        <span className="w-12 text-right">exp</span>
        <span className="w-12 text-right">value</span>
      </Th>
      <div className="flex-1">
        {roster.map((pid) => (
          <Row key={pid} onClick={() => select({ player: pid })} active={sel.player === pid}>
            <span className="min-w-0 flex-1">
              <PlayerName player={data.players[pid]} id={pid} size={18} avatar={false} />
            </span>
            <span className="num w-12 text-right text-ff-text">{fmt(analysis.horizon.perWeek[pid])}</span>
            <Num value={analysis.market[pid]} digits={1} className="w-12 text-right text-ff-text2" />
          </Row>
        ))}
      </div>
    </div>
  )
}

/** Where the model and the expert consensus disagree most. */
const Consensus = ({ sel, select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const [scope, setScope] = useState<'mine' | 'rostered' | 'fa'>('mine')
  const rows = useMemo(() => {
    if (!data.consensus) return []
    const ranked = Object.keys(analysis.market)
      .filter((id) => data.players[id])
      .sort((a, b) => analysis.market[b] - analysis.market[a])
    const modelRank: Record<string, number> = {}
    ranked.forEach((id, i) => (modelRank[id] = i + 1))
    return Object.keys(data.consensus.byId)
      .filter((id) => {
        // Kickers and defenses rank on a different basis in each list; their gaps are noise.
        if (data.players[id]?.pos === 'K' || data.players[id]?.pos === 'DEF') return false
        const owner = analysis.rosteredBy[id]
        return scope === 'mine' ? owner === analysis.myRosterId : scope === 'fa' ? owner === undefined : owner !== undefined
      })
      .map((id) => ({ id, ecr: data.consensus!.byId[id].rank, model: modelRank[id] }))
      .filter((r): r is { id: string; ecr: number; model: number } => r.ecr != null && r.model != null && Math.min(r.ecr, r.model) <= 150)
      .map((r) => ({ ...r, gap: r.ecr - r.model }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 25)
  }, [data, analysis, scope])
  if (!data.consensus) return <Empty title="Consensus unavailable">FantasyPros rankings could not be read this session.</Empty>
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5">
        <Segmented<'mine' | 'rostered' | 'fa'>
          size="sm"
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { key: 'mine', label: 'Mine' },
            { key: 'rostered', label: 'Rostered' },
            { key: 'fa', label: 'FA' },
          ]}
        />
        <span className="font-mono text-[10px] text-ff-muted">ECR {data.consensus.date ?? ''}</span>
      </div>
      <Th>
        <span className="flex-1">player</span>
        <span className="w-10 text-right">model</span>
        <span className="w-10 text-right">ecr</span>
        <span className="w-16 text-right">read</span>
      </Th>
      {rows.map((r) => (
        <Row key={r.id} onClick={() => select({ player: r.id })} active={sel.player === r.id}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[r.id]} id={r.id} size={18} avatar={false} />
          </span>
          <span className="num w-10 text-right text-ff-text">{r.model}</span>
          <span className="num w-10 text-right text-ff-text2">{Math.round(r.ecr)}</span>
          <span className={cx('w-16 text-right font-mono text-[10.5px]', r.gap > 0 ? 'text-ff-pos' : 'text-ff-neg')} title={r.gap > 0 ? 'The model ranks this player higher than the experts: cheaper to buy than he is worth to you.' : 'The experts rank this player higher than the model: worth more in a trade than in your lineup.'}>
            {r.gap > 0 ? `buy +${Math.round(r.gap)}` : `sell ${Math.round(r.gap)}`}
          </span>
        </Row>
      ))}
    </div>
  )
}

const Activity = ({ select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const rows = useMemo(() => [...data.transactions].filter((t) => t.status === 'complete').sort((a, b) => b.created - a.created).slice(0, 40), [data.transactions])
  if (!rows.length) return <Empty title="Quiet league">No moves yet this season.</Empty>
  const TAG: Record<string, string> = { trade: 'TRD', waiver: 'WVR', free_agent: 'ADD', commissioner: 'CMR' }
  return (
    <div>
      {rows.map((t, i) => {
        const adds = Object.entries(t.adds ?? {})
        const drops = Object.entries(t.drops ?? {})
        return (
          <div key={i} className="flex items-start gap-2 border-b border-ff-line/60 px-3 py-1.5 text-[12px] last:border-0">
            <span className="num w-7 shrink-0 pt-px text-[10px] text-ff-muted">{ago(t.created)}</span>
            <span className={cx('w-8 shrink-0 pt-px font-mono text-[10px]', t.type === 'trade' ? 'text-ff-accent' : 'text-ff-text2')}>{TAG[t.type] ?? t.type.slice(0, 3).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <TeamTag id={t.roster_ids[0]} />
              </span>
              <span className="block truncate font-mono text-[10.5px]">
                {adds.map(([pid]) => (
                  <button key={pid} onClick={() => select({ player: pid })} className="mr-1.5 text-ff-pos hover:underline">
                    +{data.players[pid]?.name ?? pid}
                  </button>
                ))}
                {drops.map(([pid]) => (
                  <span key={pid} className="mr-1.5 text-ff-muted">
                    −{data.players[pid]?.name ?? pid}
                  </span>
                ))}
                {t.type === 'trade' && t.roster_ids.length > 1 && <span className="text-ff-muted">with {analysis.teamById[t.roster_ids[1]]?.name}</span>}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** One player's prop lines: the line, the de-vigged chance of the over, and what it implies. */
const LinesBlock = ({ id }: { id: string }) => {
  const { data } = useFantasy()
  const m = data.market!.byId[id]
  return (
    <div>
      <div className="ff-label mb-1 flex justify-between">
        <span>lines · wk {data.market!.week}</span>
        <span className="normal-case tracking-normal">
          <span className="text-ff-text">{fmt(m.pts)}</span> vs sleeper {fmt(m.sleeper)}
        </span>
      </div>
      <div className="border border-ff-line">
        {m.props.map((p) => (
          <div key={p.stat} className="flex items-center gap-2 border-b border-ff-line/60 px-2 py-0.5 font-mono text-[10.5px] last:border-0">
            <span className="flex-1 truncate text-ff-text2">{PROP_LABEL[p.stat] ?? p.stat}</span>
            <span className="w-10 text-right text-ff-text">{p.stat === 'anytime_touchdowns' ? '' : p.line}</span>
            <span className="w-9 text-right text-ff-muted" title="Chance of the over, margin removed">
              {p.stat === 'anytime_touchdowns' ? '' : 'o'}
              {Math.round(p.pOver * 100)}%
            </span>
            <span className="w-14 shrink-0 whitespace-nowrap text-right text-ff-text2" title="Implied expected value">
              {p.stat === 'anytime_touchdowns' ? `${p.mean.toFixed(2)} td` : `≈${p.mean.toFixed(p.mean < 10 ? 1 : 0)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The week's prop board, read as fantasy points next to Sleeper's projection. */
const Props = ({ sel, select }: WidgetProps) => {
  const { data, analysis, models } = useFantasy()
  const [scope, setScope] = useState<'mine' | 'opp' | 'league'>('mine')
  const m = data.market
  const opp = useMemo(() => {
    const g = models.forecast?.nextWeek.find((x) => x.a === analysis.myRosterId || x.b === analysis.myRosterId)
    return g ? (g.a === analysis.myRosterId ? g.b : g.a) : null
  }, [models.forecast, analysis.myRosterId])
  const rows = useMemo(() => {
    if (!m) return []
    return Object.keys(m.byId)
      .filter((id) => {
        const owner = analysis.rosteredBy[id]
        // Gaps only mean something where Sleeper has the player playing; its zeros are left out of the blend too.
        if (scope === 'league' && !(m.byId[id].sleeper > 0)) return false
        return scope === 'mine' ? owner === analysis.myRosterId : scope === 'opp' ? owner === opp : true
      })
      .map((id) => ({ id, ...m.byId[id], gap: m.byId[id].pts - m.byId[id].sleeper }))
      .sort((a, b) => (scope === 'league' ? Math.abs(b.gap) - Math.abs(a.gap) : b.pts - a.pts))
      .slice(0, 40)
  }, [m, scope, analysis, opp])
  if (!m) return <Empty title="No lines yet">The prop board fills in during the week before kickoff.</Empty>
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5">
        <Segmented<'mine' | 'opp' | 'league'>
          size="sm"
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { key: 'mine', label: 'Mine' },
            ...(opp != null ? [{ key: 'opp' as const, label: 'Opponent' }] : []),
            { key: 'league', label: 'Biggest gaps' },
          ]}
        />
        <span className="font-mono text-[10px] text-ff-muted">
          wk {m.week} · {m.players} priced
        </span>
      </div>
      <Th>
        <span className="flex-1">player</span>
        <span className="w-11 text-right" title="Fantasy points implied by the prop lines, league scoring">
          lines
        </span>
        <span className="w-11 text-right">sleeper</span>
        <span className="w-11 text-right">Δ</span>
        <span className="hidden w-11 text-right sm:inline" title="Chance of a rushing or receiving TD, margin removed">
          td%
        </span>
      </Th>
      {rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-ff-muted">Nobody here has lines yet.</div>}
      {rows.map((r) => (
        <Row key={r.id} onClick={() => select({ player: r.id })} active={sel.player === r.id}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[r.id]} id={r.id} size={18} avatar={false} />
          </span>
          <span className="num w-11 text-right text-ff-text">{fmt(r.pts)}</span>
          <span className="num w-11 text-right text-ff-muted">{fmt(r.sleeper)}</span>
          <Num value={r.gap} signed className="w-11 text-right" />
          <span className="num hidden w-11 text-right text-ff-text2 sm:inline">{r.anytimeTd != null ? pct(r.anytimeTd) : ''}</span>
        </Row>
      ))}
      <div className="px-3 py-1.5 font-mono text-[10px] text-ff-muted">lines = prop medians and prices read as expected stats, scored with your league&apos;s settings</div>
    </div>
  )
}

export const WIDGETS: Record<WidgetKind, Meta> = {
  matchup: { title: 'My matchup', blurb: 'Next week, both lineups, and your chance to win.', w: 4, h: 11, Body: Matchup },
  odds: { title: 'Playoff odds', blurb: 'Simulated seasons: wins, playoff, bye and title odds.', w: 5, h: 11, Body: Odds },
  scoreboard: { title: 'Scoreboard', blurb: "This week's games with expected scores and win odds.", w: 6, h: 7, Body: Scoreboard },
  trades: { title: 'Trade ideas', blurb: 'Best deal from each partner, and how likely each lands.', w: 7, h: 9, Body: TradeIdeas },
  lineup: { title: 'My lineup', blurb: "Next week's optimal lineup from adjusted projections.", w: 4, h: 9, Body: Lineup },
  power: { title: 'Power', blurb: 'Rankings under any of the three models.', w: 4, h: 9, Body: Power },
  standings: { title: 'Standings', blurb: 'Record, points and the playoff line.', w: 6, h: 7, Body: Standings },
  injuries: { title: 'Injury watch', blurb: 'Flagged players and who inherits their work.', w: 4, h: 9, Body: Injuries },
  waivers: { title: 'Waiver wire', blurb: 'Free agents who would start for you.', w: 4, h: 9, Body: Waivers },
  player: { title: 'Player', blurb: 'Everything on one player. Follows its channel.', w: 3, h: 11, Body: PlayerCard, reads: 'player' },
  team: { title: 'Team', blurb: 'One roster with its rating and odds. Follows its channel.', w: 5, h: 9, Body: TeamCard, reads: 'team' },
  consensus: { title: 'Model vs consensus', blurb: 'Where FantasyPros and the model disagree: buys and sells.', w: 4, h: 9, Body: Consensus },
  activity: { title: 'League activity', blurb: 'Trades, claims and pickups as they happen.', w: 4, h: 9, Body: Activity },
  props: { title: 'Prop board', blurb: 'Betting lines read as fantasy points, against Sleeper.', w: 4, h: 9, Body: Props },
}
