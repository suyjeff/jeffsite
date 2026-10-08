import React, { useMemo } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { suggestBid, type BidAdvice } from '../../../lib/fantasy/faab'
import type { TradeTarget } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { contextReasons } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import { Badge, Empty, N, Panel, Reasons, Stat, StatGrid, fmtSigned, type Reason } from '../ui'

type Move = { target: TradeTarget; drop: string | null; bid: BidAdvice | null; why: Reason[]; rivals: number; alts: TradeTarget[] }

/**
 * The waiver moves worth making, ranked, each with the case for it: what it does to your lineup (Sleeper's projections, blended with
 * prop lines), what FantasyPros and the rest of Sleeper think of him, his role, and what to bid given how this league spends.
 */
const WaiverMoves = ({ data, analysis, adds, trending, drop }: { data: LeagueData; analysis: Analysis; adds: TradeTarget[]; trending: Record<string, number>; drop: string | null }) => {
  const { models } = useFantasy()
  const faab = models.faab
  const me = analysis.myRosterId
  const players = data.players

  // Model rank at the position, by rest-of-season value, to set beside FantasyPros'.
  const modelRank = useMemo(() => {
    const out: Record<string, number> = {}
    const byPos: Record<string, string[]> = {}
    for (const id of Object.keys(analysis.market)) {
      const pos = players[id]?.pos
      if (pos) (byPos[pos] ??= []).push(id)
    }
    for (const ids of Object.values(byPos)) ids.sort((a, b) => analysis.market[b] - analysis.market[a]).forEach((id, i) => (out[id] = i + 1))
    return out
  }, [analysis.market, players])

  const moves: Move[] = useMemo(() => {
    if (me == null) return []
    const others = analysis.teams.map((t) => t.rosterId).filter((r) => r !== me)
    const mine = analysis.teamById[me]?.players ?? []
    // One move per position, the best; the next two at it ride along as alternatives.
    const byPos = new Map<string, TradeTarget[]>()
    for (const t of adds.filter((x) => x.add >= 0.3)) {
      const pos = players[t.id]?.pos ?? ''
      byPos.set(pos, [...(byPos.get(pos) ?? []), t])
    }
    return [...byPos.values()]
      .map((list) => ({ t: list[0], alts: list.slice(1, 3) }))
      .sort((a, b) => b.t.add - a.t.add)
      .slice(0, 5)
      .map(({ t, alts }) => {
        const p = players[t.id]
        const pos = p?.pos ?? ''
        // A kicker or defense replaces yours at the spot; anyone else costs your least valuable bench player.
        const sameSpot = pos === 'K' || pos === 'DEF' ? mine.filter((id) => players[id]?.pos === pos).sort((a, b) => (analysis.horizon.perWeek[a] ?? 0) - (analysis.horizon.perWeek[b] ?? 0))[0] : undefined
        // Rivals for him: teams whose weakest spot is his position.
        const rivals = others.filter((r) => analysis.needs[r]?.worstPos === pos)
        const value = analysis.market[t.id] ?? 0
        const bid = faab ? suggestBid(faab, me, { gain: t.add, value, trending: trending[t.id] ?? 0, pos, rivals: rivals.length ? rivals : others }) : null
        const ecr = data.consensus?.byId[t.id]
        const why: Reason[] = [
          {
            text: (
              <>
                Adds <N tone="pos">{fmtSigned(t.add, 1)}</N> pts/wk to your best lineup{t.slot ? ` at ${t.slot.replace('SUPER_FLEX', 'SF')}` : ''}, on Sleeper&apos;s projections blended with
                prop lines
              </>
            ),
            tone: 'pos',
          },
        ]
        if (ecr?.posRank != null) {
          const m = modelRank[t.id]
          const ahead = m != null && ecr.posRank < m - 3
          why.push({
            text: (
              <>
                FantasyPros ranks him{' '}
                <N>
                  {pos}
                  {Math.round(ecr.posRank)}
                </N>{' '}
                rest of season{m ? (
                  <>
                    {' '}
                    (this model:{' '}
                    <N>
                      {pos}
                      {m}
                    </N>
                    )
                  </>
                ) : null}
                {ahead ? ': the experts like him more than the projections do' : ''}
              </>
            ),
            tone: ahead ? 'pos' : 'neutral',
          })
        }
        if ((trending[t.id] ?? 0) >= 200)
          why.push({
            text: (
              <>
                <N>{trending[t.id].toLocaleString()}</N> Sleeper managers added him in the last 24 hours
              </>
            ),
            tone: trending[t.id] >= 5000 ? 'warn' : 'neutral',
          })
        if (rivals.length)
          why.push({
            text: `${rivals.length} other ${rivals.length === 1 ? 'team is' : 'teams are'} weakest at ${pos} and may bid`,
            tone: 'warn',
          })
        why.push(...contextReasons(data.context[t.id], players))
        if (bid) why.push(...bid.reasons.map((r) => ({ text: r.text, tone: r.tone })))
        return { target: t, drop: sameSpot ?? drop, bid, why, rivals: rivals.length, alts }
      })
  }, [adds, me, analysis, players, faab, trending, data.consensus, data.context, modelRank, drop])

  if (me == null) return null
  const mine = faab ? (faab.remaining[me] ?? 0) : 0
  const richer = faab ? Object.entries(faab.remaining).filter(([r, v]) => Number(r) !== me && v > mine).length : 0
  const rich = faab
    ? Object.entries(faab.remaining)
        .filter(([r]) => Number(r) !== me)
        .sort((a, b) => b[1] - a[1])[0]
    : null
  const best = moves[0]?.target.add ?? 0

  return (
    <div className="space-y-3">
      {faab && (
        <StatGrid>
          <Stat label="Your FAAB" value={`$${mine}`} meter={mine / faab.budget} sub={`of $${faab.budget} · ${richer === 0 ? 'most in the league' : `${richer} ${richer === 1 ? 'team has' : 'teams have'} more`}`} />
          <Stat
            label="League going rate"
            value={faab.going.n ? `$${faab.going.p50}` : '–'}
            sub={faab.going.n ? `median winning bid · top quarter $${faab.going.p75}+ · ${faab.going.n} bids, ${faab.going.source}` : 'no winning bids yet'}
          />
          <Stat label="Richest rival" value={rich ? `$${rich[1]}` : '–'} sub={rich ? (analysis.teamById[Number(rich[0])]?.name ?? '–') : '–'} />
          <Stat
            label="Weeks left"
            value={faab.weeksLeft}
            tone={faab.weeksLeft <= 3 ? 'warn' : undefined}
            sub={faab.weeksLeft <= 3 ? 'spend it: leftover FAAB is worth nothing' : `regular season · ~$${Math.round(mine / Math.max(1, faab.weeksLeft))} a week to spend`}
          />
        </StatGrid>
      )}

      <Panel title="Recommended moves" actions={<span>ranked by gain to your lineup</span>} pad={false}>
        {moves.length === 0 ? (
          <div className="p-3">
            <Empty title="No add is worth making">
              Nobody on the wire beats your starters by enough to matter.{faab ? ' Hold your FAAB: the money is worth more after the next injury.' : ''}
            </Empty>
          </div>
        ) : (
          <ol className="divide-y divide-ff-line">
            {moves.map((m, i) => (
              <li key={m.target.id} className="px-3 py-3">
                <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2 gap-y-2 sm:grid-cols-[20px_minmax(0,1fr)_auto]">
                  <span className="num pt-1 text-[11px] text-ff-muted">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge tone="pos" className="w-11 justify-center">
                        ADD
                      </Badge>
                      <PlayerName player={players[m.target.id]} id={m.target.id} size={26} />
                    </div>
                    {m.drop && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone="neg" className="w-11 justify-center">
                          DROP
                        </Badge>
                        <PlayerName player={players[m.drop]} id={m.drop} size={26} sub={`${fmtSigned(analysis.market[m.drop] ?? 0, 1)}/wk value`} />
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 flex items-end gap-4 sm:col-span-1 sm:flex-col sm:items-end sm:gap-1.5">
                    <div className="text-right leading-none">
                      <div className="ff-label">gain</div>
                      <div className="num mt-1 text-[20px] font-medium text-ff-pos">{fmtSigned(m.target.add, 1)}</div>
                    </div>
                    {m.bid && (
                      <div className="text-right leading-none" title={`League pays $${m.bid.low}–${m.bid.high} for this much value`}>
                        <div className="ff-label">bid</div>
                        <div className="num mt-1 text-[20px] font-medium text-ff-text">${m.bid.bid}</div>
                        <div className="num mt-0.5 text-[10.5px] text-ff-muted">
                          ${m.bid.low}–{m.bid.high}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 space-y-2 sm:col-span-3">
                    <Reasons items={m.why} />
                    {m.alts.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-ff-muted">
                        <span className="ff-label">or</span>
                        {m.alts.map((a) => (
                          <span key={a.id} className="inline-flex items-baseline gap-1.5">
                            <PlayerName player={players[a.id]} id={a.id} avatar={false} />
                            <N tone="pos">{fmtSigned(a.add, 1)}</N>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      {faab && best < 0.75 && moves.length > 0 && (
        <p className="text-[12px] text-ff-muted">
          The best add is worth under <N>0.75</N> pts/wk to you: bid the minimum or hold. FAAB buys the most right after injuries.
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-ff-muted">
        Gain comes from your lineup re-solved week by week with him in and your weakest player out. Bids weigh what he is worth to you against what this league has paid for
        similar value{faab ? `, at about $${Math.round(faab.rate)} per pt/wk${faab.rateN ? ` (${faab.rateN} of this season's bids)` : ' (a default until more bids land)'}` : ''}, and
        never go past one dollar over the richest rival.
      </p>
    </div>
  )
}

export default WaiverMoves

