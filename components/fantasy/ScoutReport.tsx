import React, { useMemo } from 'react'
import { scoutTeam, type ScoutFact, type Scouting } from '../../lib/fantasy/scout'
import { Callout } from './Callout'
import { useFantasy } from './FantasyContext'
import { INSIGHT_ITEM, InsightMark } from './InsightMark'
import { Panel, cx, fmtSigned } from './ui'

/** The facts the summary line is built on: the biggest help and the biggest hurt. */
const leads = (s: Scouting) => [s.strengths[0], s.weaknesses[0]].filter(Boolean)

/**
 * The players the summary line is about, to mark where a roster is shown: the starters of a room it names, or the
 * players behind its injury cost. Luck, schedule and lineup calls are about the team, not a player. The facts carry
 * their players; the other arguments are no longer needed and are ignored.
 */
export const scoutPlayers = (s: Scouting, ..._unused: unknown[]) => new Set(leads(s).flatMap((f) => f.players ?? []))

/** A team's scouting report, for a page that marks the players it names. */
export const useScout = (rosterId: number) => {
  const { data, analysis, models } = useFantasy()
  return useMemo(() => scoutTeam(data, analysis, models, rosterId), [data, analysis, models, rosterId])
}

const Fact = ({ f, marked }: { f: ScoutFact; marked?: boolean }) => {
  const good = f.value > 0
  return (
    <li className={cx('flex items-start gap-3 border-b border-ff-line/60 px-3 py-2 last:border-b-0', marked && INSIGHT_ITEM)}>
      <span className={cx('mt-0.5 w-[62px] shrink-0 text-right', good ? 'text-ff-pos' : 'text-ff-neg')}>
        {f.unit === 'rank' ? (
          <span className="font-mono text-[10.5px] uppercase tracking-wide">{good ? 'easy' : 'hard'}</span>
        ) : (
          <>
            <span className="num text-[16px] font-medium leading-none">{fmtSigned(f.value, 1)}</span>
            <span className="ml-0.5 font-mono text-[9.5px] text-ff-muted">{f.unit === 'wins' ? 'W' : '/wk'}</span>
          </>
        )}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1.5 text-[12.5px] text-ff-text">
          {f.label}
          {marked && <InsightMark title="The summary above is built on this" />}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ff-muted" title={f.detail}>
          {f.detail}
        </span>
      </span>
    </li>
  )
}

/**
 * Why a team is good or bad: the few facts that explain most of it, each
 * sized in points per week against an average team where it can be.
 */
const ScoutReport = ({ rosterId, mine }: { rosterId: number; mine?: boolean }) => {
  const s = useScout(rosterId)
  const lead = new Set(leads(s).map((f) => f.key))
  if (!s.strengths.length && !s.weaknesses.length) return null
  return (
    <Panel
      title={mine ? 'Why your team is where it is' : 'Scouting report'}
      pad={false}
      actions={<span title="Each line is measured against the league's average team, in points per week where it can be">vs an average team</span>}
    >
      {s.summary && (
        <div className="border-b border-ff-line">
          <Callout kind="insight" compact>
            <span className="text-[13px] text-ff-text">{s.summary}</span>
          </Callout>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-ff-line">
        <div>
          <div className="ff-label border-b border-ff-line/60 bg-ff-pos/[0.05] px-3 py-1.5 text-ff-pos">Helping</div>
          {s.strengths.length ? (
            <ul>
              {s.strengths.map((f) => (
                <Fact key={f.key} f={f} marked={lead.has(f.key)} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-[11.5px] text-ff-muted">Nothing stands out above average.</p>
          )}
        </div>
        <div className="border-t border-ff-line sm:border-t-0">
          <div className="ff-label border-b border-ff-line/60 bg-ff-neg/[0.05] px-3 py-1.5 text-ff-neg">Hurting</div>
          {s.weaknesses.length ? (
            <ul>
              {s.weaknesses.map((f) => (
                <Fact key={f.key} f={f} marked={lead.has(f.key)} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-[11.5px] text-ff-muted">No real hole.</p>
          )}
        </div>
      </div>
    </Panel>
  )
}

export default ScoutReport
