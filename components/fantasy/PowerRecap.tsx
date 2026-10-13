import React, { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { RECAP_SIMS, type Odds, type Part, type Reason, type Recap, type RecapGame, type RecapTeam } from '../../lib/fantasy/recap'
import { useFantasy } from './FantasyContext'
import { Crown } from './RevealBanner'
import { Avatar, PlayerAvatar, PosTag, Segmented, cx, fmt, pct } from './ui'

// What the reveal settles into: the new ranking with each team's move, and the week that made it. On wide screens
// the ranking holds the left column and the week reads down the right; on phones they are three pages under tabs.
// Every figure comes from the recap (lib/fantasy/recap), which reads the league's own matchups.

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties
const pad2 = (n: number) => String(n).padStart(2, '0')

/** A team's name, avatar optional, your team in the accent. Plain text: inside the reveal nothing opens a sheet. */
export const TeamLabel = ({ id, avatar = 0, className }: { id: number; avatar?: number; className?: string }) => {
  const { analysis } = useFantasy()
  const t = analysis.teamById[id]
  if (!t) return <span className="text-ff-muted">#{id}</span>
  return (
    <span className={cx('inline-flex min-w-0 max-w-full items-center gap-1.5 align-bottom', className)}>
      {avatar > 0 && <Avatar src={t.avatar} name={t.name} size={avatar} />}
      <span className={cx('truncate', id === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')} title={t.name}>
        {t.name}
      </span>
    </span>
  )
}

/** A reason's words with team names set in. */
export const Phrase = ({ parts }: { parts: Part[] }) => (
  <>
    {parts.map((p, i) =>
      typeof p === 'string' ? (
        <React.Fragment key={i}>{p}</React.Fragment>
      ) : (
        <span key={i} className="font-medium">
          <TeamLabel id={p.team} />
        </span>
      ),
    )}
  </>
)

/** Places gained or lost: ▲2 in the gain colour, ▼1 in the loss colour, a dash for holding. */
export const MoveChip = ({ move, className }: { move: number; className?: string }) => (
  <span
    className={cx('num inline-flex items-center justify-end text-[11.5px]', move > 0 ? 'text-ff-pos' : move < 0 ? 'text-ff-neg' : 'text-ff-muted', className)}
    aria-label={move > 0 ? `up ${move}` : move < 0 ? `down ${-move}` : 'no change'}
  >
    {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '–'}
  </span>
)

/**
 * One team in the ranking, the same row in the reveal's sort and in the recap, so one hands over to the other
 * without a seam: rank, avatar (crowned at No. 1), name and record, move, power.
 */
export const RowBody = ({
  team,
  rank,
  showRank = true,
  showMove = true,
  score,
  moveIn,
  moveStandIn,
  crowned,
  hatDelay = 0,
  trailing,
}: {
  team: RecapTeam
  rank: number
  showRank?: boolean
  showMove?: boolean
  /** Fade the move in after this many ms, as it first appears. */
  moveIn?: number
  /** Something else in the move's place while it is not shown (the week's points, during the sort). */
  moveStandIn?: ReactNode
  score?: ReactNode
  crowned?: boolean
  hatDelay?: number
  trailing?: ReactNode
}) => {
  const { analysis } = useFantasy()
  const t = analysis.teamById[team.rosterId]
  const mine = team.rosterId === analysis.myRosterId
  return (
    <>
      <span className={cx('num w-6 shrink-0 text-[12px]', showRank ? (rank === 1 ? 'ff-rv-gold font-medium' : 'text-ff-muted') : 'invisible')}>{pad2(rank)}</span>
      <span className="relative shrink-0">
        <Avatar src={t?.avatar ?? null} name={t?.name ?? '?'} size={24} />
        {crowned && (
          <span className="ff-rv-hat absolute -left-[5px] -top-[7px] -rotate-[14deg]" style={d(hatDelay)}>
            <Crown size={14} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cx('block truncate text-[13.5px]', mine ? 'font-medium text-ff-accent' : 'text-ff-text')} title={t?.name}>
          {t?.name ?? `#${team.rosterId}`}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-ff-muted">
          {team.wins}-{team.losses}
          {team.ties ? `-${team.ties}` : ''}
          {team.result && (
            <>
              {' · '}
              <span className={team.result === 'W' ? 'text-ff-pos' : team.result === 'L' ? 'text-ff-neg' : ''}>{team.result}</span> {fmt(team.points)}
            </>
          )}
        </span>
      </span>
      {!showMove && moveStandIn != null ? (
        <span className="w-11 shrink-0 text-right">{moveStandIn}</span>
      ) : (
        <span className={cx('w-11 shrink-0 text-right', !showMove && 'invisible', showMove && moveIn != null && 'ff-rv-rise')} style={moveIn != null ? d(moveIn) : undefined}>
          <MoveChip move={team.move} />
        </span>
      )}
      <span className="num w-10 shrink-0 text-right text-[13px] text-ff-text">{score ?? fmt(team.scoreAfter, 1)}</span>
      {trailing}
    </>
  )
}

/** A small labelled block in the recap. */
const Section = ({ title, aside, children, className, style }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) => (
  <section className={cx('border-t border-ff-line px-4 py-3.5 first:border-t-0', className)} style={style}>
    <div className="mb-2.5 flex items-baseline justify-between gap-2">
      <h3 className="ff-label">{title}</h3>
      {aside && <span className="font-mono text-[10.5px] text-ff-muted">{aside}</span>}
    </div>
    {children}
  </section>
)

/** One award: a label, a big figure, and whose it is. */
const Award = ({ label, value, unit, who, note, tone }: { label: string; value: ReactNode; unit?: string; who: ReactNode; note?: ReactNode; tone?: 'gold' | 'pos' | 'neg' }) => (
  <div className="min-w-0 border-b border-r border-ff-line bg-ff-panel px-3 py-2.5 max-sm:px-2.5">
    <div className="ff-label truncate">{label}</div>
    <div className={cx('num mt-1 text-[20px] leading-none', tone === 'gold' ? 'ff-rv-gold' : tone === 'pos' ? 'text-ff-pos' : tone === 'neg' ? 'text-ff-neg' : 'text-ff-text')}>
      {value}
      {unit && <span className="ml-1 text-[11px] text-ff-muted">{unit}</span>}
    </div>
    <div className="mt-1.5 truncate text-[12px]">{who}</div>
    {note && <div className="mt-0.5 truncate font-mono text-[10.5px] text-ff-muted">{note}</div>}
  </div>
)

const reasonDot = (r: Reason) => (r.tone === 'pos' ? 'bg-ff-pos' : r.tone === 'neg' ? 'bg-ff-neg' : 'bg-ff-muted')

const Reasons = ({ reasons }: { reasons: Reason[] }) =>
  reasons.length ? (
    <ul className="space-y-1">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ff-text2">
          <span aria-hidden className={cx('mt-[6px] h-1.5 w-1.5 shrink-0', reasonDot(r))} />
          <span className="min-w-0">
            <Phrase parts={r.parts} />
          </span>
        </li>
      ))}
    </ul>
  ) : null

/** Playoff odds before and after the week, as "41% → 58%" with the change. */
const OddsMove = ({ o, className }: { o: Odds; className?: string }) => {
  const a = o.before.playoffs
  const b = o.after.playoffs
  const dlt = Math.round((b - a) * 100)
  const label = (s: Odds['after']) => (s.clinch === 'in' ? 'IN' : s.clinch === 'out' ? 'OUT' : pct(s.playoffs))
  return (
    <span className={cx('num inline-flex items-baseline gap-1.5 whitespace-nowrap text-[12px]', className)}>
      <span className="text-ff-muted">{label(o.before)}</span>
      <span aria-hidden className="text-ff-muted">→</span>
      <span className="text-ff-text">{label(o.after)}</span>
      {dlt !== 0 && <span className={cx('text-[11px]', dlt > 0 ? 'text-ff-pos' : 'text-ff-neg')}>{dlt > 0 ? `+${dlt}` : `−${-dlt}`}</span>}
    </span>
  )
}

/** The selected team's week: where it went and why, its game, its lineup, its playoff odds. */
const Focus = ({ recap, team, odds }: { recap: Recap; team: RecapTeam; odds: Record<number, Odds> | null }) => {
  const { data } = useFantasy()
  const n = recap.teams.length
  const o = odds?.[team.rosterId]
  const miss = team.miss
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium leading-tight">
            <TeamLabel id={team.rosterId} avatar={28} />
          </div>
          <div className="mt-1 font-mono text-[11px] text-ff-muted">
            {team.rankBefore === team.rankAfter ? `holds No. ${team.rankAfter}` : `No. ${team.rankBefore} → No. ${team.rankAfter}`} · power {fmt(team.scoreBefore)} → {fmt(team.scoreAfter)}
          </div>
        </div>
        <span className={cx('num text-[26px] leading-none', team.rankAfter === 1 ? 'ff-rv-gold' : 'text-ff-text')}>#{team.rankAfter}</span>
        {team.move !== 0 && <MoveChip move={team.move} className="mt-1 text-[13px]" />}
      </div>
      <Reasons reasons={team.reasons} />
      <dl className="grid grid-cols-2 gap-px border border-ff-line bg-ff-line sm:grid-cols-4">
        <div className="bg-ff-panel px-2.5 py-2">
          <dt className="ff-label">Scored</dt>
          <dd className="num mt-0.5 text-[15px] text-ff-text">{fmt(team.points)}</dd>
          <dd className="font-mono text-[10.5px] text-ff-muted">
            {team.weekRank ? `${team.weekRank} of ${n}` : '–'}
            {team.expected != null ? ` · proj ${fmt(team.expected, 0)}` : ''}
          </dd>
        </div>
        <div className="bg-ff-panel px-2.5 py-2">
          <dt className="ff-label">Result</dt>
          <dd className={cx('num mt-0.5 text-[15px]', team.result === 'W' ? 'text-ff-pos' : team.result === 'L' ? 'text-ff-neg' : 'text-ff-text')}>
            {team.result ?? '–'} {team.oppPoints != null ? `${fmt(team.points)}–${fmt(team.oppPoints)}` : ''}
          </dd>
          <dd className="truncate font-mono text-[10.5px] text-ff-muted">
            {team.opponent != null ? (
              <>
                vs <TeamLabel id={team.opponent} />
              </>
            ) : (
              'no game'
            )}
          </dd>
        </div>
        <div className="bg-ff-panel px-2.5 py-2">
          <dt className="ff-label">Lineup</dt>
          <dd className="num mt-0.5 text-[15px] text-ff-text">{team.optimal > 0 ? pct(team.accuracy) : '–'}</dd>
          <dd className="font-mono text-[10.5px] text-ff-muted">{team.bench > 0 ? `${fmt(team.bench)} on bench` : 'best possible'}</dd>
        </div>
        <div className="bg-ff-panel px-2.5 py-2">
          <dt className="ff-label">Playoffs</dt>
          <dd className="mt-0.5 text-[15px]">{o ? <OddsMove o={o} className="text-[13px]" /> : <span className="num text-ff-muted">{odds ? '–' : '…'}</span>}</dd>
          <dd className="font-mono text-[10.5px] text-ff-muted">{team.winProb != null ? `had ${pct(team.winProb)} to win` : 'before → after'}</dd>
        </div>
      </dl>
      {miss && miss.diff >= 3 && (
        <p className="text-[12px] leading-snug text-ff-muted">
          <span className={miss.decisive ? 'text-ff-neg' : 'text-ff-text2'}>
            Benched {data.players[miss.sat]?.name ?? miss.sat} ({fmt(miss.satPts)}) for {data.players[miss.started]?.name ?? miss.started} ({fmt(miss.startedPts)})
          </span>
          {miss.decisive ? ': it decided the game.' : `: ${fmt(miss.diff)} pts.`}
        </p>
      )}
    </div>
  )
}

/** One game: both sides, the winner in ink, the margin, and the odds it beat. */
const GameRow = ({ g, recap }: { g: RecapGame; recap: Recap }) => {
  const max = Math.max(...recap.games.flatMap((x) => [x.pa, x.pb]), 1)
  const upset = g.pWinner != null && g.pWinner < 0.4
  // Winner in the accent, loser in a muted red; a tie leaves both neutral.
  const bar = (id: number) => (g.winner == null ? 'bg-ff-muted/50' : g.winner === id ? 'bg-ff-accent' : 'bg-ff-neg/70')
  const side = (id: number, pts: number, right?: boolean) => (
    <span className={cx('flex min-w-0 flex-1 items-center gap-2', right && 'flex-row-reverse text-right')}>
      <span className={cx('min-w-0 flex-1 truncate text-[12.5px]', g.winner === id ? 'font-medium' : 'opacity-70')}>
        <TeamLabel id={id} />
      </span>
      <span className={cx('num text-[13px]', g.winner === id ? 'text-ff-text' : 'text-ff-muted')}>{fmt(pts)}</span>
    </span>
  )
  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        {side(g.a, g.pa)}
        <span className="num w-12 shrink-0 text-center text-[10.5px] text-ff-muted">Δ{fmt(g.margin)}</span>
        {side(g.b, g.pb, true)}
      </div>
      <div className="mt-1.5 flex items-center gap-[3px]" aria-hidden>
        <span className="flex h-1 flex-1 justify-end bg-ff-sunken">
          <span className={cx('h-full', bar(g.a))} style={{ width: `${(g.pa / max) * 100}%` }} />
        </span>
        <span className="flex h-1 flex-1 bg-ff-sunken">
          <span className={cx('h-full', bar(g.b))} style={{ width: `${(g.pb / max) * 100}%` }} />
        </span>
      </div>
      {upset && (
        <div className="mt-1 font-mono text-[10.5px] text-ff-warn">
          upset · <TeamLabel id={g.winner!} /> had {pct(g.pWinner)} to win
        </div>
      )}
    </li>
  )
}

/** The week's three headlines, from the first that apply: the climb, the drop, the upset, the closest game, the top score. */
const headlines = (recap: Recap): ReactNode[] => {
  const a = recap.awards
  const over = (g: RecapGame) => <TeamLabel id={g.winner === g.a ? g.b : g.a} />
  const out: ReactNode[] = []
  if (a.riser) out.push(<Award key="up" label="Biggest climb" value={`▲${a.riser.move}`} tone="pos" who={<TeamLabel id={a.riser.rosterId} avatar={18} />} note={`No. ${a.riser.rankBefore} → No. ${a.riser.rankAfter}`} />)
  if (a.faller) out.push(<Award key="down" label="Biggest drop" value={`▼${-a.faller.move}`} tone="neg" who={<TeamLabel id={a.faller.rosterId} avatar={18} />} note={`No. ${a.faller.rankBefore} → No. ${a.faller.rankAfter}`} />)
  if (a.upset)
    out.push(
      <Award
        key="upset"
        label="Upset of the week"
        value={pct(a.upset.pWinner)}
        unit="to win"
        tone="gold"
        who={<TeamLabel id={a.upset.winner!} avatar={18} />}
        note={
          <>
            beat {over(a.upset)} by {fmt(a.upset.margin)}
          </>
        }
      />,
    )
  if (a.closest && a.closest !== a.upset)
    out.push(
      <Award
        key="close"
        label="Closest game"
        value={fmt(a.closest.margin)}
        unit="pts"
        who={<TeamLabel id={a.closest.winner ?? a.closest.a} avatar={18} />}
        note={<>over {over(a.closest)}</>}
      />,
    )
  if (a.high) out.push(<Award key="high" label="Top score" value={fmt(a.high.pts)} tone="gold" who={<TeamLabel id={a.high.rosterId} avatar={18} />} />)
  if (!a.riser && !a.faller) out.unshift(<Award key="held" label="The order" value="held" who="No team changed places" />)
  return out
}

/** The week: headline moves, every result, the awards, the best players, and the calls. */
const WeekPanels = ({ recap, at }: { recap: Recap; at: (i: number) => CSSProperties }) => {
  const { data } = useFantasy()
  const a = recap.awards
  const name = (id: string) => data.players[id]?.name ?? id
  return (
    <>
      <Section title="The week in three" style={at(0)} className="ff-rv-rise">
        <div className="grid grid-cols-3 border-l border-t border-ff-line">{headlines(recap).slice(0, 3)}</div>
      </Section>

      <Section title="Results" aside={`avg ${fmt(recap.leagueAvg)}`} style={at(1)} className="ff-rv-rise">
        <ul className="divide-y divide-ff-line/70">
          {recap.games.map((g) => (
            <GameRow key={`${g.a}-${g.b}`} g={g} recap={recap} />
          ))}
        </ul>
      </Section>

      <Section title="Awards" style={at(2)} className="ff-rv-rise">
        <div className="grid grid-cols-2 border-l border-t border-ff-line lg:grid-cols-3">
          {a.high && <Award label="Top score" value={fmt(a.high.pts)} who={<TeamLabel id={a.high.rosterId} avatar={18} />} tone="gold" />}
          {a.sharpest && <Award label="Sharpest lineup" value={pct(a.sharpest.accuracy)} unit="of best" who={<TeamLabel id={a.sharpest.rosterId} avatar={18} />} note="points played of points possible" />}
          {a.ceiling && <Award label="Best possible lineup" value={fmt(a.ceiling.pts)} who={<TeamLabel id={a.ceiling.rosterId} avatar={18} />} note="most in the roster" />}
          {a.bench && <Award label="Most left on the bench" value={fmt(a.bench.pts)} who={<TeamLabel id={a.bench.rosterId} avatar={18} />} tone="neg" />}
          {a.closest && (
            <Award
              label="Closest game"
              value={fmt(a.closest.margin)}
              unit="pts"
              who={<TeamLabel id={a.closest.winner ?? a.closest.a} avatar={18} />}
              note={
                <>
                  over <TeamLabel id={a.closest.winner === a.closest.a ? a.closest.b : a.closest.a} />
                </>
              }
            />
          )}
          {a.blowout && a.blowout !== a.closest && (
            <Award
              label="Biggest blowout"
              value={fmt(a.blowout.margin)}
              unit="pts"
              who={<TeamLabel id={a.blowout.winner!} avatar={18} />}
              note={
                <>
                  over <TeamLabel id={a.blowout.winner === a.blowout.a ? a.blowout.b : a.blowout.a} />
                </>
              }
            />
          )}
          {a.boom && <Award label="Biggest boom" value={`+${fmt(a.boom.pts - a.boom.proj)}`} tone="pos" who={name(a.boom.id)} note={`${fmt(a.boom.pts)} on ${fmt(a.boom.proj)} projected`} />}
          {a.low && <Award label="Low score" value={fmt(a.low.pts)} who={<TeamLabel id={a.low.rosterId} avatar={18} />} />}
          {a.loosest && <Award label="Loosest lineup" value={pct(a.loosest.accuracy)} unit="of best" who={<TeamLabel id={a.loosest.rosterId} avatar={18} />} />}
        </div>
      </Section>

      {recap.stars.length > 0 && (
        <Section title="Best at each position" aside="rostered anywhere" style={at(3)} className="ff-rv-rise">
          <ul className="grid gap-px border border-ff-line bg-ff-line sm:grid-cols-2">
            {recap.stars.map((s) => (
              <li key={s.pos} className="flex items-center gap-2.5 bg-ff-panel px-2.5 py-2">
                <PosTag pos={s.pos} />
                <PlayerAvatar id={s.id} player={data.players[s.id]} size={28} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] text-ff-text">{name(s.id)}</span>
                  <span className="block truncate font-mono text-[10.5px] text-ff-muted">
                    <TeamLabel id={s.owner} />
                    {!s.started && <span className="text-ff-warn"> · on the bench</span>}
                  </span>
                </span>
                <span className="num text-[15px] text-ff-text">{fmt(s.pts)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(recap.calls.good || recap.calls.bad) && (
        <Section title="Lineup calls" style={at(4)} className="ff-rv-rise">
          <ul className="space-y-2">
            {recap.calls.good && (
              <li className="flex gap-2.5 text-[12.5px] leading-snug">
                <span className="mt-0.5 shrink-0 bg-ff-pos/10 px-1 font-mono text-[10px] leading-[16px] text-ff-pos">GOOD</span>
                <span className="min-w-0 text-ff-text2">
                  <span className="font-medium">
                    <TeamLabel id={recap.calls.good.rosterId} />
                  </span>{' '}
                  started {name(recap.calls.good.started)} over the higher-projected {name(recap.calls.good.sat)}: {fmt(recap.calls.good.startedPts)} to {fmt(recap.calls.good.satPts)}.
                </span>
              </li>
            )}
            {recap.calls.bad && (
              <li className="flex gap-2.5 text-[12.5px] leading-snug">
                <span className="mt-0.5 shrink-0 bg-ff-neg/10 px-1 font-mono text-[10px] leading-[16px] text-ff-neg">MISS</span>
                <span className="min-w-0 text-ff-text2">
                  <span className="font-medium">
                    <TeamLabel id={recap.calls.bad.rosterId} />
                  </span>{' '}
                  benched {name(recap.calls.bad.sat)} ({fmt(recap.calls.bad.satPts)}) for {name(recap.calls.bad.started)} ({fmt(recap.calls.bad.startedPts)})
                  {recap.calls.bad.decisive ? `, then lost by ${fmt((recap.byId[recap.calls.bad.rosterId]?.oppPoints ?? 0) - (recap.byId[recap.calls.bad.rosterId]?.points ?? 0))}.` : '.'}
                </span>
              </li>
            )}
          </ul>
        </Section>
      )}
    </>
  )
}

/** The playoff race before and after the week, on the same simulation: who moved, who is in, who is out. */
const PlayoffPanel = ({ recap, odds, at }: { recap: Recap; odds: Record<number, Odds> | null; at: (i: number) => CSSProperties }) => {
  const { data, models } = useFantasy()
  const cut = Number(data.league.settings?.playoff_teams ?? 0)
  if (!models.forecast) return null
  if (!odds)
    return (
      <Section title="Playoff picture" style={at(5)} className="ff-rv-rise">
        <p className="font-mono text-[11px] text-ff-muted">simulating…</p>
      </Section>
    )
  const rows = recap.teams.map((t) => ({ t, o: odds[t.rosterId] })).filter((r) => r.o)
  rows.sort((x, y) => y.o.after.playoffs - x.o.after.playoffs || x.t.rankAfter - y.t.rankAfter)
  const swing = [...rows].sort((x, y) => Math.abs(y.o.after.playoffs - y.o.before.playoffs) - Math.abs(x.o.after.playoffs - x.o.before.playoffs))[0]
  const news = rows.filter((r) => r.o.after.clinch && r.o.after.clinch !== r.o.before.clinch)
  return (
    <Section title="Playoff picture" aside={`top ${cut} · ${RECAP_SIMS.toLocaleString()} sims each side`} style={at(5)} className="ff-rv-rise">
      {(swing || news.length > 0) && (
        <div className="mb-3 space-y-1 text-[12.5px] leading-snug text-ff-text2">
          {news.map((r) => (
            <p key={r.t.rosterId}>
              <span className={cx('mr-1.5 px-1 font-mono text-[10px]', r.o.after.clinch === 'in' ? 'bg-ff-pos/10 text-ff-pos' : 'bg-ff-neg/10 text-ff-neg')}>{r.o.after.clinch === 'in' ? 'CLINCHED' : 'ELIMINATED'}</span>
              <TeamLabel id={r.t.rosterId} />
            </p>
          ))}
          {swing && Math.abs(swing.o.after.playoffs - swing.o.before.playoffs) >= 0.02 && (
            <p>
              Biggest swing: <span className="font-medium"><TeamLabel id={swing.t.rosterId} /></span>, {pct(swing.o.before.playoffs)} to {pct(swing.o.after.playoffs)}.
            </p>
          )}
        </div>
      )}
      <ul>
        {rows.map((r, i) => {
          const b = r.o.before.playoffs
          const a = r.o.after.playoffs
          return (
            <li key={r.t.rosterId} className={cx('flex items-center gap-2.5 py-1.5', i === cut - 1 && cut > 0 && 'border-b border-dashed border-ff-accent/60 pb-2', i === cut && 'pt-2')}>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                <TeamLabel id={r.t.rosterId} avatar={18} />
              </span>
              {/* Before as a hairline tick, after as the bar: the gap is the week. */}
              <span className="relative h-2 w-24 shrink-0 bg-ff-sunken sm:w-32" aria-hidden>
                <span className={cx('absolute inset-y-0 left-0', a >= b ? 'bg-ff-accent' : 'bg-ff-accent/60')} style={{ width: `${a * 100}%` }} />
                <span className="absolute -inset-y-0.5 w-px bg-ff-text" style={{ left: `calc(${b * 100}% - 0.5px)` }} />
              </span>
              <OddsMove o={r.o} className="w-[118px] justify-end" />
            </li>
          )
        })}
      </ul>
      {cut > 0 && <p className="mt-2 font-mono text-[10.5px] text-ff-muted">dashed rule: the playoff line · tick: odds before the week</p>}
    </Section>
  )
}

type Tab = 'ranks' | 'week' | 'playoffs'

/**
 * The recap. `from` is where the reveal's ranking stood on screen as it handed over; the recap's ranking starts
 * there and slides home, so the list the crown landed on is the list you read.
 */
const PowerRecap = ({
  recap,
  odds,
  phone,
  rowH,
  from,
  entering,
}: {
  recap: Recap
  odds: Record<number, Odds> | null
  phone: boolean
  rowH: number
  from: DOMRect | null
  entering: boolean
}) => {
  const { analysis, models } = useFantasy()
  const [focus, setFocus] = useState<number>(analysis.myRosterId != null && recap.byId[analysis.myRosterId] ? analysis.myRosterId : recap.teams[0]?.rosterId)
  const [tab, setTab] = useState<Tab>('ranks')
  const [open, setOpen] = useState<number | null>(null)
  const list = useRef<HTMLOListElement>(null)
  // Staggered entrance for everything but the list, after the list has had a moment to travel.
  const base = from ? 380 : 60
  const at = (i: number) => (entering ? d(base + i * 60) : ({ animation: 'none' } as CSSProperties))

  useLayoutEffect(() => {
    const el = list.current
    if (!el || !from || !entering || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const to = el.getBoundingClientRect()
    const dx = from.left - to.left
    const dy = from.top - to.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    // The list's own scroller would clip it on the way in: let it out for the trip.
    const scroller = el.closest<HTMLElement>('.ff-scroll')
    if (scroller) scroller.style.overflow = 'visible'
    const a = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' })
    const restore = () => scroller && (scroller.style.overflow = '')
    a.onfinish = restore
    a.oncancel = restore
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const focusTeam = recap.byId[focus] ?? recap.teams[0]
  const ranking = (
    // Opaque, so the column rule never shows through the list as it slides in over it.
    <ol ref={list} className="relative bg-ff-panel" aria-label={`Power rank after week ${recap.week}`}>
      {recap.teams.map((t, i) => {
        const selected = phone ? open === t.rosterId : focus === t.rosterId
        return (
          <li key={t.rosterId} className={cx(entering && from && i > 0 && 'ff-rv-undim')}>
            <button
              type="button"
              aria-expanded={phone ? selected : undefined}
              aria-pressed={phone ? undefined : selected}
              onClick={() => (phone ? setOpen(selected ? null : t.rosterId) : setFocus(t.rosterId))}
              style={{ height: rowH, ...(entering && !from ? d(60 + i * 30) : {}) }}
              className={cx(
                'ff-rv-row relative flex w-full items-center gap-2.5 border-b border-ff-line/60 px-3 text-left',
                entering && !from && 'ff-rv-rise',
                i === 0 ? 'ff-rv-gold-row' : selected ? 'bg-ff-raised shadow-[inset_2px_0_0_rgb(var(--ff-accent))]' : 'hover:bg-ff-raised/60',
              )}
            >
              <RowBody team={t} rank={t.rankAfter} crowned={i === 0} hatDelay={entering && !from ? 400 : 0} />
              {phone && (
                <span aria-hidden className={cx('-mr-1 w-3 font-mono text-[10px] text-ff-muted motion-safe:transition-transform motion-safe:duration-200', selected && 'rotate-180')}>
                  ▾
                </span>
              )}
            </button>
            {phone && selected && (
              <div className="ff-fade-in border-y border-ff-line bg-ff-sunken/50 px-3 py-3">
                <Focus recap={recap} team={t} odds={odds} />
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
  const footnote = (
    <p className={cx('px-3 py-3 font-mono text-[10.5px] leading-relaxed text-ff-muted', entering && 'ff-rv-in')} style={at(0)}>
      The composite power ranking (Power → Composite). Power is the chance to beat an average team in a week. Last week&apos;s rank reads results through week {recap.week - 1} and each roster as set for week {recap.week}; this
      week&apos;s adds week {recap.week}&apos;s results and rosters as they stand now.
      {recap.estimated && <span className="text-ff-warn"> Estimated: games still being played are counted at their projections.</span>}
    </p>
  )
  const listHead = (
    <div className={cx('flex h-8 shrink-0 items-center gap-2.5 border-b border-ff-line px-3', entering && 'ff-rv-in')} style={at(0)}>
      <span className="ff-label w-6">Rk</span>
      <span className="ff-label w-6" />
      <span className="ff-label flex-1">Team</span>
      <span className="ff-label w-11 text-right">Move</span>
      <span className="ff-label w-10 text-right" title="Chance to beat an average team in a week">Pwr</span>
      {phone && <span className="w-3" />}
    </div>
  )

  if (phone)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={cx('shrink-0 border-b border-ff-line px-3 py-2', entering && 'ff-rv-in')} style={at(0)}>
          <Segmented<Tab>
            block
            size="sm"
            label="Recap page"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'ranks', label: 'Ranks' },
              { key: 'week', label: 'Week' },
              ...(models.forecast ? [{ key: 'playoffs' as const, label: 'Playoffs' }] : []),
            ]}
          />
        </div>
        {/* Scroll chains to the sheet, so a pull down from the top dismisses it. */}
        <div className="ff-scroll min-h-0 flex-1 overflow-y-auto overscroll-auto">
          {tab === 'ranks' && (
            <>
              {listHead}
              {ranking}
              {footnote}
            </>
          )}
          {tab === 'week' && (
            <div className="ff-fade-in">
              <WeekPanels recap={recap} at={() => ({ animation: 'none' })} />
            </div>
          )}
          {tab === 'playoffs' && (
            <div className="ff-fade-in">
              <PlayoffPanel recap={recap} odds={odds} at={() => ({ animation: 'none' })} />
            </div>
          )}
          <div className="h-6" />
        </div>
      </div>
    )

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[400px_minmax(0,1fr)]">
      <div className="relative z-10 flex min-h-0 flex-col border-r border-ff-line">
        {listHead}
        <div className="ff-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {ranking}
          {footnote}
        </div>
      </div>
      <div className="ff-scroll min-h-0 overflow-y-auto overscroll-contain">
        <Section title={focusTeam.rosterId === analysis.myRosterId ? 'Your week' : 'Their week'} aside="pick a team on the left" className="ff-rv-rise bg-ff-sunken/40" style={at(0)}>
          <Focus key={focusTeam.rosterId} recap={recap} team={focusTeam} odds={odds} />
        </Section>
        <WeekPanels recap={recap} at={(i) => at(i + 1)} />
        <PlayoffPanel recap={recap} odds={odds} at={(i) => at(i + 1)} />
        <div className="h-4" />
      </div>
    </div>
  )
}

export default PowerRecap
