// Pieces of the playoff simulator (views/PlayoffsView): the season played out as a story feed, a bracket and
// final standings, and the small marks the race table uses.
import React from 'react'
import type { BracketGame, Story, Trace } from '../../lib/fantasy/playoffSim'
import { useFantasy } from './FantasyContext'
import TeamName from './TeamName'
import { Avatar, cx, fmt } from './ui'

export const SIMS = 2000
/** The odds and every what-if share one stream of draws, so a difference is the pick and not the dice. */
export const SEED = 11
export const LEVER_SIMS = 600

export type Chaos = 'calm' | 'normal' | 'chaos'
export const CHAOS: Record<Chaos, number> = { calm: 0.7, normal: 1, chaos: 1.5 }
/** The picks and luck a season was played under, compared by content so undoing a pick is no change. */
export const setupKey = (locks: Record<string, number>, chaos: Chaos) =>
  `${chaos}|${Object.entries(locks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`

/** A change in a probability, in points: "+12", "−3", nothing when it rounds to zero. */
export const Delta = ({ v, className }: { v: number; className?: string }) => {
  const n = Math.round(v * 100)
  if (!n) return <span className={cx('num inline-block w-8 text-right text-[10.5px] text-ff-muted/0', className)}>0</span>
  return <span className={cx('num inline-block w-8 text-right text-[10.5px]', n > 0 ? 'text-ff-pos' : 'text-ff-neg', className)}>{n > 0 ? `+${n}` : `−${-n}`}</span>
}

/** Two managers squaring off: the winner, then the other, dimmed. One avatar for a story about one team. */
const FaceOff = ({ a, b }: { a: number; b: number | null }) => {
  const { analysis } = useFantasy()
  const A = analysis.teamById[a]
  const B = b != null ? analysis.teamById[b] : null
  return (
    <span aria-hidden className="flex w-[60px] shrink-0 items-center gap-1 pt-0.5">
      <Avatar src={A?.avatar ?? null} name={A?.name ?? '?'} size={22} />
      {B && (
        <>
          <span className="font-mono text-[8.5px] uppercase text-ff-muted">vs</span>
          <span className="opacity-55 grayscale-[0.6]">
            <Avatar src={B.avatar} name={B.name} size={22} />
          </span>
        </>
      )}
    </span>
  )
}

const KIND: Record<Story['kind'], { label: string; tone: string }> = {
  title: { label: 'TITLE', tone: 'text-ff-accent' },
  upset: { label: 'UPSET', tone: 'text-ff-warn' },
  escape: { label: 'ESCAPE', tone: 'text-ff-text2' },
  bubble: { label: 'THE LINE', tone: 'text-ff-warn' },
  thriller: { label: 'THRILLER', tone: 'text-ff-text2' },
  rout: { label: 'ROUT', tone: 'text-ff-neg' },
  streak: { label: 'HOT', tone: 'text-ff-pos' },
  slump: { label: 'COLD', tone: 'text-ff-neg' },
  you: { label: 'YOU', tone: 'text-ff-accent' },
}

const StoryText = ({ s }: { s: Story }) => {
  const { analysis } = useFantasy()
  return (
    <>
      {s.parts.map((p, i) =>
        typeof p === 'string' ? (
          <React.Fragment key={i}>{p}</React.Fragment>
        ) : (
          <b key={i} className={cx('font-medium', p.team === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')}>
            {analysis.teamById[p.team]?.name ?? `#${p.team}`}
          </b>
        ),
      )}
    </>
  )
}

/** The season's stories as a short feed, each line revealed in turn. */
export const Feed = ({ stories, run }: { stories: Story[]; run: number }) => (
  <ol className="divide-y divide-ff-line/60">
    {stories.map((s, i) => (
      <li
        key={`${run}:${s.key}`}
        className={cx(
          'ff-rise grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-3 py-2.5',
          s.kind === 'you' && 'bg-ff-accent/[0.06] shadow-[inset_2px_0_0_rgb(var(--ff-accent))]',
        )}
        style={{ animationDelay: `${100 + i * 100}ms` }}
      >
        <FaceOff a={s.a} b={s.b} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 font-mono text-[10px] tracking-[0.06em]">
            <span className={KIND[s.kind].tone}>{KIND[s.kind].label}</span>
            <span className="text-ff-muted">{s.when}</span>
          </div>
          <p className="mt-0.5 text-[13px] leading-[1.45] text-ff-text2">
            <StoryText s={s} />
          </p>
        </div>
      </li>
    ))}
  </ol>
)

/** One bracket game: both sides with seed and score, the winner lit. */
const Match = ({ g }: { g: BracketGame }) => {
  const { analysis } = useFantasy()
  const side = (id: number | null, seed: number | null, pts: number | null) => {
    const t = id != null ? analysis.teamById[id] : null
    const won = id != null && g.winner === id && g.a != null && g.b != null
    return (
      <div className={cx('flex h-7 items-center gap-1.5 px-2 text-[12px]', won ? 'text-ff-text' : 'text-ff-muted')}>
        <span className="num w-3.5 shrink-0 text-right text-[10px] text-ff-muted">{seed ?? ''}</span>
        {t && id != null ? (
          <span className={cx('flex min-w-0 flex-1', won ? 'font-medium' : '[&_.truncate]:text-ff-muted')}>
            <TeamName id={id} size={16} />
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-ff-muted">bye</span>
        )}
        {pts != null && <span className={cx('num shrink-0 text-[11.5px]', won ? 'text-ff-text' : 'text-ff-muted')}>{fmt(pts)}</span>}
      </div>
    )
  }
  if (g.a == null || g.b == null)
    return (
      <div className="border border-dashed border-ff-line bg-ff-panel">
        {side(g.a ?? g.b, g.a != null ? g.seedA : g.seedB, null)}
        <div className="flex h-5 items-center px-2 font-mono text-[10px] text-ff-muted">bye</div>
      </div>
    )
  return (
    <div className="divide-y divide-ff-line/60 border border-ff-line bg-ff-panel">
      {side(g.a, g.seedA, g.sa)}
      {side(g.b, g.seedB, g.sb)}
    </div>
  )
}

/** The bracket, a column per round, revealed round by round. */
export const Bracket = ({ t, run }: { t: Trace; run: number }) => {
  const { analysis } = useFantasy()
  const champ = t.champion != null ? analysis.teamById[t.champion] : null
  return (
    <div className="ff-scroll overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-3 p-3">
        {t.rounds.map((rd, i) => (
          <div key={`${run}:${i}`} className="ff-rise flex w-[160px] flex-col" style={{ animationDelay: `${100 + i * 100}ms` }}>
            <div className="ff-label mb-1.5 flex justify-between">
              <span>{rd.name}</span>
              <span className="num">wk {rd.week}</span>
            </div>
            <div className="flex flex-1 flex-col justify-around gap-2">
              {rd.games.map((g, j) => (
                <Match key={j} g={g} />
              ))}
            </div>
          </div>
        ))}
        {champ && (
          <div key={`${run}:champ`} className="ff-rise flex w-[112px] flex-col" style={{ animationDelay: `${100 + t.rounds.length * 100}ms` }}>
            <div className="ff-label mb-1.5">Champion</div>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 border border-ff-accent/50 bg-ff-accent/[0.07] px-2 py-3 text-center">
              <Avatar src={champ.avatar} name={champ.name} size={40} />
              <span className={cx('line-clamp-2 text-[12.5px] font-medium leading-tight', t.champion === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')}>
                {champ.name}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The season in one line: who won it, how you did, and your tally across the seasons played. */
export const Headline = ({ t, run, tally }: { t: Trace; run: number; tally: { n: number; in: number; titles: number } }) => {
  const { analysis } = useFantasy()
  const me = analysis.myRosterId
  const champ = t.champion != null ? analysis.teamById[t.champion] : null
  const mine = me != null ? t.standings.find((r) => r.rosterId === me) : null
  return (
    <div key={run} className="ff-rise flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ff-line bg-ff-sunken/40 px-3 py-2.5">
      {champ && (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar src={champ.avatar} name={champ.name} size={32} />
          <span className="min-w-0 leading-tight">
            <span className="ff-label block">Champion</span>
            <span className={cx('block truncate text-[15px] font-medium', t.champion === me ? 'text-ff-accent' : 'text-ff-text')}>
              {t.champion === me ? 'You won it all' : champ.name}
            </span>
          </span>
        </span>
      )}
      {mine && (
        <span className="leading-tight">
          <span className="ff-label block">You</span>
          <span className="num text-[13px] text-ff-text">
            {mine.wins}-{mine.losses} · seed {mine.seed}
            <span className={cx('ml-1.5 font-sans text-[12px]', mine.seed <= t.nPlayoff ? 'text-ff-pos' : 'text-ff-neg')}>{mine.seed <= t.nPlayoff ? 'in' : 'out'}</span>
          </span>
        </span>
      )}
      {me != null && tally.n > 1 && (
        <span className="ml-auto text-right leading-tight">
          <span className="ff-label block">This visit</span>
          <span className="num text-[12px] text-ff-text2">
            {tally.n} seasons · in {tally.in} · {tally.titles} {tally.titles === 1 ? 'title' : 'titles'}
          </span>
        </span>
      )}
    </div>
  )
}

/** Final standings of the season played out, the playoff line drawn under the last seed in. */
export const Standings = ({ t }: { t: Trace }) => {
  const { analysis } = useFantasy()
  return (
    <ol className="text-[12px]">
      {t.standings.map((r) => {
        const team = analysis.teamById[r.rosterId]
        const gained = r.wins - r.was.wins
        const played = gained + r.losses - r.was.losses
        return (
          <li
            key={r.rosterId}
            className={cx('flex h-7 items-center gap-2 px-3', r.seed === t.nPlayoff ? 'border-b border-dashed border-ff-line2' : 'border-b border-ff-line/50 last:border-0')}
          >
            <span className="num w-4 text-right text-[10.5px] text-ff-muted">{r.seed}</span>
            <span className={cx('flex min-w-0 flex-1', r.rosterId === analysis.myRosterId && 'font-medium', r.seed > t.nPlayoff && '[&_.truncate]:text-ff-muted')}>
              <TeamName id={r.rosterId} size={16} />
            </span>
            <span className="num w-10 text-right text-ff-text">
              {r.wins}-{r.losses}
            </span>
            <span className="num hidden w-10 whitespace-nowrap text-right text-[10.5px] text-ff-muted sm:inline" title={`Went ${gained}-${played - gained} in the simulated weeks`}>
              {played ? `${gained}-${played - gained}` : ''}
            </span>
            <span className="num w-12 text-right text-[10.5px] text-ff-muted">{Math.round(r.pf).toLocaleString()}</span>
          </li>
        )
      })}
    </ol>
  )
}

