import React, { useEffect, useMemo, useState } from 'react'
import { readDeal, rostersOf, tidyDeal, type Deal, type DealSide } from '../../lib/fantasy/deal'
import type { TradeIdea } from '../../lib/fantasy/trades'
import { useFantasy, useTradeRead } from './FantasyContext'
import { AddIcon, TradeIcon } from './icons'
import { Callout } from './Callout'
import { Disclosure } from './Disclosure'
import PlayerName from './PlayerName'
import TeamName from './TeamName'
import { Badge, Button, Dropdown, Panel, PlayerAvatar, WeekBars, cx, fmt, fmtSigned } from './ui'

const MAX_TEAMS = 4

/** A signed points-per-week figure, coloured by direction, with an optional range under it. */
const Figure = ({ v, range, unit = '/wk', big }: { v: number; range?: [number, number]; unit?: string; big?: boolean }) => (
  <span className="leading-none">
    <span className={cx('num font-medium', big ? 'text-[22px]' : 'text-[15px]', v > 0.05 ? 'text-ff-pos' : v < -0.05 ? 'text-ff-neg' : 'text-ff-text')}>{fmtSigned(v, 1)}</span>
    <span className="ml-0.5 font-mono text-[10px] text-ff-muted">{unit}</span>
    {range && Math.abs(range[1] - range[0]) >= 0.1 && (
      <span className="num mt-1 block text-[10.5px] text-ff-muted">
        {fmtSigned(range[0], 1)} to {fmtSigned(range[1], 1)}
      </span>
    )}
  </span>
)

/**
 * The trade builder: any number of teams, players moving any direction, FAAB with them. Pick players from the
 * rosters; the trade itself sits above, one column per team, each priced on its own: what its lineup gains week by
 * week, what the FAAB is worth to it (a range, since managers value waiver money unevenly), and how likely it is
 * to say yes.
 */
const TradeBuilder = ({ deal, setDeal }: { deal: Deal; setDeal: (d: Deal) => void }) => {
  const { data, analysis, models } = useFantasy()
  const tradeRead = useTradeRead()
  const me = analysis.myRosterId!
  const players = data.players
  const perWeek = analysis.horizon.perWeek
  // Only where trades can carry FAAB (not ESPN): otherwise the money controls never show.
  const faab = data.tradeFaab ? models.faab : null
  const rosters = useMemo(() => rostersOf(analysis), [analysis])
  const [view, setView] = useState<number>(deal.teams.find((t) => t !== me) ?? me)
  // A deal loaded from elsewhere (a suggested trade) brings its own partner: show that roster, not the last one.
  const teamsKey = deal.teams.join(',')
  useEffect(() => {
    if (!deal.teams.includes(view)) setView(deal.teams.find((t) => t !== me) ?? me)
  }, [teamsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = deal.teams.includes(view) ? view : deal.teams[0]

  const read = useMemo(
    () =>
      data.horizon.length
        ? readDeal(deal, {
            slots: analysis.slots,
            players,
            horizon: data.horizon,
            floor: analysis.horizonReplacement,
            capacity: analysis.capacity,
            pts: perWeek,
            tradeMarket: analysis.tradeMarket,
            rosters,
            currency: analysis.currency,
            faab,
          })
        : null,
    [deal, data.horizon, analysis, players, perWeek, rosters, faab],
  )
  const active = deal.moves.length > 0 || deal.faab.some((x) => x.dollars > 0)

  // How each other team's manager would read their side, from the same read the suggested trades use.
  const accept = useMemo(() => {
    const out: Record<number, ReturnType<typeof tradeRead>> = {}
    if (!read) return out
    const mine = read.sides.find((s) => s.rosterId === me)
    for (const s of read.sides) {
      if (s.rosterId === me || (!s.receives.length && !s.sends.length && !s.faab)) continue
      const idea: TradeIdea = {
        partnerId: s.rosterId,
        give: s.receives,
        get: s.sends,
        shape: s.sends.length === s.receives.length ? 'swap' : s.sends.length > s.receives.length ? 'depth' : 'consolidate',
        myGain: mine?.lineup ?? 0,
        theirGain: s.net.mid,
        myCost: 0,
        valueAsk: -s.value,
        weeksBetter: s.weeksBetter,
        weeks: s.perWeek.length,
        fills: null,
        myCuts: [],
        theirCuts: s.cuts,
        mutual: Math.min(mine?.lineup ?? 0, s.net.mid),
        perWeek: [],
      }
      out[s.rosterId] = tradeRead(idea, false)
    }
    return out
  }, [read, me, tradeRead])
  const odds = Object.values(accept).reduce((a, r) => a * (r.index / 100), 1)

  // ---- Editing the deal ----
  const ownerOf = (id: string) => deal.teams.find((t) => rosters[t]?.includes(id)) ?? null
  const togglePlayer = (id: string) => {
    const existing = deal.moves.find((m) => m.player === id)
    if (existing) return setDeal({ ...deal, moves: deal.moves.filter((m) => m.player !== id) })
    const from = ownerOf(id)
    if (from == null) return
    const others = deal.teams.filter((t) => t !== from)
    if (!others.length) return
    const to = from === me ? others[0] : others.includes(me) ? me : others[0]
    setDeal({ ...deal, moves: [...deal.moves, { player: id, from, to }] })
  }
  const redirect = (id: string, to: number) => setDeal({ ...deal, moves: deal.moves.map((m) => (m.player === id ? { ...m, to } : m)) })
  // Each team sends at most one FAAB payment; picking its destination before the amount is remembered as a $0 payment.
  const setFaab = (from: number, dollars: number, to?: number) => {
    const rest = deal.faab.filter((x) => x.from !== from)
    const dest = to ?? deal.faab.find((x) => x.from === from)?.to ?? deal.teams.find((t) => t !== from)!
    setDeal({ ...deal, faab: dollars > 0 || to != null ? [...rest, { from, to: dest, dollars }] : rest })
  }
  const addTeam = (id: number) => {
    setDeal(tidyDeal({ ...deal, teams: [...deal.teams, id] }))
    setView(id)
  }
  const removeTeam = (id: number) => setDeal(tidyDeal({ ...deal, teams: deal.teams.filter((t) => t !== id) }))
  const others = analysis.teams.filter((t) => !deal.teams.includes(t.rosterId))

  const sideCard = (s: DealSide) => {
    const r = accept[s.rosterId]
    const mineSide = s.rosterId === me
    const out = deal.faab.find((x) => x.from === s.rosterId && x.dollars > 0)
    const outAny = deal.faab.find((x) => x.from === s.rosterId)
    const left = faab?.remaining[s.rosterId] ?? 0
    const verdict = s.net.mid > 0.25 ? 'better' : s.net.mid < -0.25 ? 'worse' : 'about even'
    return (
      <section key={s.rosterId} className="flex min-w-0 flex-col border border-ff-line bg-ff-panel">
        <header className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-2">
          <span className="flex min-w-0">
            <TeamName id={s.rosterId} size={20} className="text-[13px] font-medium" />
          </span>
          <Badge tone={verdict === 'better' ? 'pos' : verdict === 'worse' ? 'neg' : 'neutral'}>{verdict}</Badge>
        </header>

        <div className="space-y-2.5 px-3 py-2.5">
          <div>
            <div className="ff-label mb-1">Gets</div>
            {s.receives.length || s.faab > 0 ? (
              <ul className="space-y-1">
                {s.receives.map((id) => {
                  const from = deal.moves.find((m) => m.player === id)?.from
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <PlayerName
                          player={players[id]}
                          id={id}
                          size={22}
                          sub={
                            deal.teams.length > 2 && from != null ? (
                              <>
                                from <TeamName id={from} avatar={false} />
                              </>
                            ) : (
                              `${fmt(perWeek[id])}/wk`
                            )
                          }
                        />
                      </span>
                    </li>
                  )
                })}
                {s.faab > 0 && <li className="font-mono text-[12px] text-ff-text">+${s.faab} FAAB</li>}
              </ul>
            ) : (
              <p className="text-[12px] text-ff-muted">Nothing yet</p>
            )}
          </div>
          <div>
            <div className="ff-label mb-1">Gives</div>
            {s.sends.length || out ? (
              <ul className="space-y-1">
                {s.sends.map((id) => {
                  const to = deal.moves.find((m) => m.player === id)?.to
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <PlayerName player={players[id]} id={id} size={22} sub={`${fmt(perWeek[id])}/wk`} />
                      </span>
                      {deal.teams.length > 2 && to != null && (
                        <Dropdown
                          label={`Send ${players[id]?.name} to`}
                          value={String(to)}
                          onChange={(v) => redirect(id, Number(v))}
                          options={deal.teams.filter((t) => t !== s.rosterId).map((t) => ({ value: String(t), label: analysis.teamById[t]?.name ?? String(t) }))}
                          menuClassName="!right-0 !left-auto w-[200px]"
                          renderButton={(cur, open) => (
                            <span className="flex h-7 max-w-[120px] items-center gap-1 border border-ff-line px-1.5 font-mono text-[10.5px] text-ff-text2 hover:border-ff-line2">
                              <span className="text-ff-muted">to</span>
                              <span className="truncate">{cur?.label}</span>
                              <span aria-hidden className="text-ff-muted">
                                {open ? '▴' : '▾'}
                              </span>
                            </span>
                          )}
                        />
                      )}
                    </li>
                  )
                })}
                {out && (
                  <li className="font-mono text-[12px] text-ff-text">
                    −${out.dollars} FAAB{deal.teams.length > 2 ? ` to ${analysis.teamById[out.to]?.name}` : ''}
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-[12px] text-ff-muted">Nothing yet</p>
            )}
          </div>
          {faab && (
            <label className="flex items-center gap-2 text-[12px] text-ff-text2">
              <span className="ff-label">Add FAAB</span>
              <span className="flex h-7 items-center border border-ff-line bg-ff-bg focus-within:border-ff-line2">
                <span className="pl-1.5 font-mono text-[11px] text-ff-muted">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={left}
                  value={out?.dollars || ''}
                  placeholder="0"
                  onChange={(e) => setFaab(s.rosterId, Math.max(0, Math.min(left, Math.round(Number(e.target.value) || 0))))}
                  className="num h-full w-14 appearance-none bg-transparent px-1 text-[16px] text-ff-text outline-none [-moz-appearance:textfield] sm:text-[12.5px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  aria-label={`FAAB ${analysis.teamById[s.rosterId]?.name} sends`}
                />
              </span>
              <span className="font-mono text-[10.5px] text-ff-muted">of ${left}</span>
              {deal.teams.length > 2 && (
                <Dropdown
                  label={`Send ${analysis.teamById[s.rosterId]?.name}'s FAAB to`}
                  value={String(outAny?.to ?? deal.teams.find((t) => t !== s.rosterId))}
                  onChange={(v) => setFaab(s.rosterId, outAny?.dollars ?? 0, Number(v))}
                  options={deal.teams.filter((t) => t !== s.rosterId).map((t) => ({ value: String(t), label: analysis.teamById[t]?.name ?? String(t) }))}
                  menuClassName="!right-0 !left-auto w-[200px]"
                  renderButton={(cur, open) => (
                    <span className="flex h-7 max-w-[120px] items-center gap-1 border border-ff-line px-1.5 font-mono text-[10.5px] text-ff-text2 hover:border-ff-line2">
                      <span className="text-ff-muted">to</span>
                      <span className="truncate">{cur?.label}</span>
                      <span aria-hidden className="text-ff-muted">
                        {open ? '▴' : '▾'}
                      </span>
                    </span>
                  )}
                />
              )}
            </label>
          )}
        </div>

        {/* What it does for this team, in the order to read it. */}
        <div className="mt-auto grid grid-cols-2 gap-px border-t border-ff-line bg-ff-line">
          <div className="bg-ff-panel px-3 py-2">
            <div className="ff-label">Lineup</div>
            <div className="mt-1">
              <Figure v={s.lineup} />
              <span className="mt-1 block text-[10.5px] text-ff-muted">
                better {s.weeksBetter} of {s.perWeek.length} weeks
              </span>
            </div>
          </div>
          <div className="bg-ff-panel px-3 py-2">
            <div className="ff-label">{s.faab ? 'With FAAB' : 'Trade value'}</div>
            <div className="mt-1">
              {s.faab ? (
                <Figure v={s.net.mid} range={[s.net.low, s.net.high]} />
              ) : (
                <>
                  <Figure v={s.value} unit=" value" />
                  <span className="mt-1 block text-[10.5px] text-ff-muted">
                    {s.value > 0.2 ? 'gets more than it gives' : s.value < -0.2 ? 'gives more than it gets' : 'fair by value'}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="col-span-2 flex items-center justify-between gap-2 bg-ff-panel px-3 py-2">
            <WeekBars weeks={s.perWeek.map((w) => ({ week: w.week, value: w.delta }))} highlight={data.playoffWeeks} barWidth={7} height={26} />
            <span className="text-right font-mono text-[10px] leading-tight text-ff-muted">
              wk {s.perWeek[0]?.week}–{s.perWeek[s.perWeek.length - 1]?.week}
              <span className="block">by week</span>
            </span>
          </div>
          {!mineSide && r && (
            <div className="col-span-2 bg-ff-panel px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="ff-label">Would they?</div>
                <div className={cx('num text-[13px] font-medium', r.band === 'likely' ? 'text-ff-pos' : r.band === 'possible' ? 'text-ff-text' : 'text-ff-neg')}>
                  {r.index}% · {r.band}
                </div>
              </div>
              {r.signals[0] && (
                <p className="mt-0.5 text-[11px] text-ff-muted">
                  {r.signals
                    .map((x) => x.text)
                    .slice(0, 2)
                    .join('; ')}
                </p>
              )}
            </div>
          )}
          {(s.cuts.length > 0 || s.problems.length > 0) && (
            <div className="col-span-2 space-y-0.5 bg-ff-panel px-3 py-2 text-[11px]">
              {s.cuts.length > 0 && <p className="text-ff-muted">Would cut {s.cuts.map((id) => players[id]?.name ?? id).join(', ')} to fit</p>}
              {s.problems.map((p) => (
                <p key={p} className="text-ff-neg">
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
    )
  }

  const roster = rosters[shown] ?? []
  const sorted = [...roster].filter((id) => players[id]).sort((a, b) => (perWeek[b] ?? 0) - (perWeek[a] ?? 0))

  return (
    <div className="space-y-3">
      {/* Who is in it. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="ff-label">Teams</span>
        {deal.teams.map((t) => (
          <span key={t} className="flex h-8 items-center gap-1 border border-ff-line bg-ff-panel pl-2 pr-0.5">
            <TeamName id={t} size={18} plain className="text-[12.5px]" />
            {t !== me && (
              <button
                type="button"
                onClick={() => removeTeam(t)}
                aria-label={`Take ${analysis.teamById[t]?.name} out of the trade`}
                className="flex h-7 w-6 items-center justify-center font-mono text-[12px] text-ff-muted hover:text-ff-neg"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {deal.teams.length < MAX_TEAMS && others.length > 0 && (
          <Dropdown
            label="Add a team"
            value=""
            onChange={(v) => v && addTeam(Number(v))}
            options={others.map((t) => ({ value: String(t.rosterId), label: t.name }))}
            renderButton={() => (
              <span className="flex h-8 items-center gap-1.5 border border-dashed border-ff-line2 px-2.5 text-[12.5px] text-ff-text2 hover:border-ff-text2 hover:text-ff-text">
                <AddIcon size={12} />
                {deal.teams.length < 2 ? 'Add a partner' : 'Add a team'}
              </span>
            )}
          />
        )}
        {active && (
          <Button size="sm" variant="ghost" onClick={() => setDeal({ ...deal, moves: [], faab: [] })} className="ml-auto">
            Clear
          </Button>
        )}
      </div>

      {/* The trade itself. */}
      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <TradeIcon size={12} />
            The trade
          </span>
        }
        pad={false}
        actions={
          active && Object.keys(accept).length ? (
            <span title="Every other team saying yes, taken as independent">
              all say yes <span className={cx('num', odds >= 0.5 ? 'text-ff-pos' : odds >= 0.25 ? 'text-ff-text' : 'text-ff-neg')}>{Math.round(odds * 100)}%</span>
            </span>
          ) : null
        }
      >
        {!active || !read ? (
          <div className="p-3">
            <Callout kind="instruction" title={deal.teams.length < 2 ? 'Add a partner to start' : 'Pick players to move'}>
              {deal.teams.length < 2
                ? 'Any team in the league; add more for a three- or four-way deal.'
                : 'Tap players in the rosters below. Each goes to the other side, or to the team you choose in a bigger deal. Add FAAB to any side.'}
            </Callout>
          </div>
        ) : (
          <div
            className={cx(
              'grid grid-cols-1 gap-2 p-2',
              deal.teams.length === 2 ? 'md:grid-cols-2' : deal.teams.length === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2 2xl:grid-cols-4',
            )}
          >
            {read.sides.map(sideCard)}
          </div>
        )}
        {active && (
          <Disclosure from="md" inset summary="How it is priced" className="px-3 py-2 text-[11.5px] text-ff-muted md:border-t md:border-ff-line">
            Lineup: each team&apos;s best lineup week by week, before and after, extra bodies cut. Trade value: as managers price players (reputation, stars, streamers). FAAB counts at a fraction of what it buys
            on waivers, more for a team nearly out of it, shown as a range.
          </Disclosure>
        )}
      </Panel>

      {/* The rosters to pick from. */}
      <Panel
        title="Rosters"
        pad={false}
        actions={
          <span className="flex flex-wrap items-center gap-1">
            {deal.teams.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setView(t)}
                aria-pressed={t === shown}
                className={cx(
                  'h-7 max-w-[140px] truncate border px-2 font-sans text-[11.5px]',
                  t === shown ? 'border-ff-text bg-ff-text text-ff-panel' : 'border-ff-line text-ff-text2 hover:border-ff-line2',
                )}
              >
                {t === me ? 'You' : analysis.teamById[t]?.name}
              </button>
            ))}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-1.5 p-2 lg:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((id) => {
            const move = deal.moves.find((m) => m.player === id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => togglePlayer(id)}
                aria-pressed={!!move}
                className={cx(
                  'ff-press flex min-w-0 items-center gap-2 border px-2 py-1.5 text-left',
                  move ? 'border-ff-accent bg-ff-accent/10' : 'border-ff-line bg-ff-panel hover:border-ff-line2 hover:bg-ff-raised',
                )}
              >
                <PlayerAvatar id={id} player={players[id]} size={26} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[12.5px] text-ff-text">{players[id]?.name}</span>
                  <span className={cx('block font-mono text-[10px]', move ? 'text-ff-text2' : 'text-ff-muted')}>
                    {players[id]?.pos} · {fmt(perWeek[id])}/wk
                  </span>
                </span>
                {move && <span className="max-w-[90px] truncate font-mono text-[10px] text-ff-accent">→ {move.to === me ? 'you' : analysis.teamById[move.to]?.name}</span>}
              </button>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

export default TradeBuilder
