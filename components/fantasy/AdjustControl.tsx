import React from 'react'
import { appliesTo } from '../../lib/fantasy/adjust'
import { useFantasy } from './FantasyContext'
import { Segmented, cx, fmt, signedPct } from './ui'

const STEPS = [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5]

/**
 * The selected step takes its sign's colour, stronger with size. Light and middling steps are tints under normal
 * text with a 1px ring in the same colour, because a tint alone sits near 1.3:1 on the panel and would not read as
 * selected; the largest is solid with the panel colour on top (all clear 4.5:1 in every theme). Zero stays neutral.
 * Written out in full so Tailwind sees every class.
 */
const NEG_RING = 'shadow-[inset_0_0_0_1px_rgb(var(--ff-neg))]'
const POS_RING = 'shadow-[inset_0_0_0_1px_rgb(var(--ff-pos))]'
const TONE: Record<string, string> = {
  '-0.5': 'bg-ff-neg text-ff-panel',
  '-0.25': `bg-ff-neg/35 text-ff-text ${NEG_RING}`,
  '-0.1': `bg-ff-neg/15 text-ff-text ${NEG_RING}`,
  '0.1': `bg-ff-pos/15 text-ff-text ${POS_RING}`,
  '0.25': `bg-ff-pos/35 text-ff-text ${POS_RING}`,
  '0.5': 'bg-ff-pos text-ff-panel',
}

/**
 * Your read on a player, applied everywhere: a percentage on his projection
 * for the coming week or every week ahead. For news the projections have not
 * caught: a benching, a coach's hint, a role you expect to change.
 */
const AdjustControl = ({ id, className }: { id: string; className?: string }) => {
  const { data, adjust } = useFantasy()
  const week = adjust.week
  if (week == null) return null
  const cur = adjust.all[id]
  const pct = cur?.pct ?? 0
  const scope = cur?.scope ?? 'week'
  const now = data.horizon[0]?.pts[id] ?? 0
  // The horizon already carries the nudge; undo it to show what it started from.
  const before = cur && appliesTo(cur, week) && 1 + cur.pct > 0 ? now / (1 + cur.pct) : now
  return (
    <div className={cx('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="ff-label">your read</span>
        <span className="num text-[10.5px] text-ff-muted">
          wk {week}: {fmt(before)}
          {pct ? <span className="text-ff-accent"> → {fmt(now)}</span> : null}
        </span>
      </div>
      <Segmented<string>
        size="sm"
        block
        label="Adjust projection"
        value={String(pct)}
        onChange={(v) => adjust.set(id, Number(v) ? { pct: Number(v), scope, week } : null)}
        options={STEPS.map((s) => ({ key: String(s), label: s ? signedPct(s) : '0', title: s ? `${signedPct(s)} on his projection` : 'No adjustment', activeClassName: TONE[String(s)] }))}
      />
      {pct !== 0 && (
        <Segmented<'week' | 'season'>
          size="sm"
          block
          label="How long"
          value={scope}
          onChange={(s) => adjust.set(id, { pct, scope: s, week })}
          options={[
            { key: 'week', label: `wk ${week} only` },
            { key: 'season', label: 'rest of season' },
          ]}
        />
      )}
    </div>
  )
}

export default AdjustControl
