import React from 'react'
import { PROP_LABEL } from '../../lib/fantasy/lines'
import { useFantasy } from './FantasyContext'
import { fmt } from './ui'

/** A player's prop lines for the coming week, each read as an expected stat, beside what they add up to. */
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


export default LinesBlock
