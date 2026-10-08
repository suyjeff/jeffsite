import React, { useMemo } from 'react'
import { scoutTeam, type ScoutFact } from '../../lib/fantasy/scout'
import { useFantasy } from './FantasyContext'
import { Panel, cx, fmtSigned } from './ui'

const Fact = ({ f }: { f: ScoutFact }) => {
  const good = f.value > 0
  return (
    <li className="flex items-start gap-3 border-b border-ff-line/60 px-3 py-2 last:border-b-0">
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
        <span className="block text-[12.5px] text-ff-text">{f.label}</span>
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
  const { data, analysis, models } = useFantasy()
  const s = useMemo(() => scoutTeam(data, analysis, models, rosterId), [data, analysis, models, rosterId])
  if (!s.strengths.length && !s.weaknesses.length) return null
  return (
    <Panel
      title={mine ? 'Why your team is where it is' : 'Scouting report'}
      pad={false}
      actions={<span title="Each line is measured against the league's average team, in points per week where it can be">vs an average team</span>}
    >
      {s.summary && <p className="border-b border-ff-line px-3 py-2 text-[13px] leading-snug text-ff-text">{s.summary}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-ff-line">
        <div>
          <div className="ff-label border-b border-ff-line/60 bg-ff-pos/[0.05] px-3 py-1.5 text-ff-pos">Helping</div>
          {s.strengths.length ? (
            <ul>
              {s.strengths.map((f) => (
                <Fact key={f.key} f={f} />
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
                <Fact key={f.key} f={f} />
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
