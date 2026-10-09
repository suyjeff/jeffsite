import React, { useMemo } from 'react'
import { scoutTeam } from '../../lib/fantasy/scout'
import { useFantasy } from './FantasyContext'
import { MoveList, useMoves } from './Moves'
import PlayerName from './PlayerName'
import FreeAgentPick from './FreeAgentPick'
import Sheet, { SheetBody, SheetClose, SheetSection } from './Sheet'
import { Avatar, Badge, Button, DeltaChip, Stat, fmt, pct, simOdds } from './ui'

/**
 * One team at a glance, over the page: where it stands, what it projects, how it got here and what it starts this
 * week, with a way through to the full team page. Opens from the Teams index and anywhere a team is named.
 */
const TeamSheet = ({ rosterId, onClose }: { rosterId: number; onClose: () => void }) => {
  const { data, analysis, models, go } = useFantasy()
  const team = analysis.teamById[rosterId]
  const season = analysis.seasonById[rosterId]
  const power = analysis.powerById[rosterId]
  const need = analysis.needs[rosterId]
  const sim = models.forecast?.sim[rosterId]
  const mine = rosterId === analysis.myRosterId
  const scout = useMemo(() => scoutTeam(data, analysis, models, rosterId), [data, analysis, models, rosterId])
  const moves = useMoves(mine ? rosterId : null, 3)
  const league = useMemo(() => {
    const xs = analysis.teams.map((t) => analysis.needs[t.rosterId]?.lineup ?? 0).filter((x) => x > 0)
    return xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
  }, [analysis])
  const game = models.forecast?.nextWeek.find((g) => g.a === rosterId || g.b === rosterId)
  if (!team || !season) return null
  const opp = game ? (game.a === rosterId ? game.b : game.a) : null
  const p = game ? (game.a === rosterId ? game.pA : 1 - game.pA) : null
  const recent = season.weeks.slice(-6)
  const open = () => {
    onClose()
    go('teams', String(rosterId))
  }

  return (
    <Sheet label={`${team.name} summary`} onClose={onClose} width={440}>
      {({ close, phone }) => (
        <>
          <header className="flex items-start gap-3 px-4 pb-3 pt-4">
            <Avatar src={team.avatar} name={team.name} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="num text-[11px] text-ff-muted">#{power?.rank ?? '–'} power</span>
                {mine && <Badge tone="accent">you</Badge>}
              </div>
              <h2 className="mt-0.5 truncate text-[19px] font-medium leading-tight tracking-[-0.01em] text-ff-text">{team.name}</h2>
              {team.owner && team.owner !== team.name && <div className="truncate font-mono text-[11px] text-ff-muted">@{team.owner}</div>}
            </div>
            <SheetClose phone={phone} onClick={close} />
          </header>

          <SheetBody phone={phone}>
            <div className="grid grid-cols-2 gap-px border-y border-ff-line bg-ff-line [&>*]:border-0">
              <Stat label="Record" value={`${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''}`} sub={`${fmt(season.ppg)} pts a game`} />
              <Stat label="Playoffs" value={sim ? simOdds(sim, 'playoffs') : '–'} meter={sim?.playoffs} sub={sim ? `title ${simOdds(sim, 'title')}` : 'no forecast'} />
              <Stat label="Power" value={power ? `${fmt(power.score, 0)}%` : '–'} sub="vs an average team" />
              <Stat
                label="Lineup"
                value={fmt(need?.lineup)}
                delta={need && league ? <DeltaChip value={need.lineup - league} title="Against the league's average lineup" /> : undefined}
                sub={need?.worstPos ? `thinnest at ${need.worstPos}` : 'pts/wk ahead'}
              />
            </div>

            {scout.summary && <p className="px-4 py-3 text-[13px] leading-[1.5] text-ff-text2">{scout.summary}</p>}

            {game && opp != null && p != null && (
              <SheetSection title={`Week ${game.week}`} aside="projected">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-ff-muted">vs</span>
                  <Avatar src={analysis.teamById[opp]?.avatar ?? null} name={analysis.teamById[opp]?.name ?? '?'} size={18} />
                  <span className="min-w-0 flex-1 truncate text-ff-text">{analysis.teamById[opp]?.name}</span>
                  <span className="num text-ff-text">{pct(p)}</span>
                  <span className="text-[11.5px] text-ff-muted">to win</span>
                </div>
              </SheetSection>
            )}

            {recent.length > 0 && (
              <SheetSection title="Recent results" aside={`last ${recent.length}`}>
                <ol className="grid gap-px border border-ff-line bg-ff-line" style={{ gridTemplateColumns: `repeat(${recent.length}, minmax(0, 1fr))` }}>
                  {recent.map((w) => (
                    <li
                      key={w.week}
                      className="bg-ff-panel px-1 py-1 text-center"
                      title={`Week ${w.week}: ${fmt(w.points)}–${fmt(w.opponentPoints)}${w.opponentId != null ? ` vs ${analysis.teamById[w.opponentId]?.name}` : ''}`}
                    >
                      <span className="block font-mono text-[9px] text-ff-muted">wk {w.week}</span>
                      <Badge tone={w.result === 'W' ? 'pos' : w.result === 'L' ? 'neg' : 'neutral'} className="mt-0.5">
                        {w.result ?? '–'}
                      </Badge>
                      <span className="num mt-0.5 block text-[10.5px] text-ff-text2">{fmt(w.points, 0)}</span>
                    </li>
                  ))}
                </ol>
              </SheetSection>
            )}

            {mine && moves.length > 0 && (
              <section className="border-t border-ff-line">
                <h3 className="ff-label px-4 pb-1 pt-3">Moves to make</h3>
                <MoveList moves={moves} compact />
              </section>
            )}

            {need && (
              <SheetSection title={`Starters, week ${data.horizon[0]?.week ?? ''}`} aside="pts/wk ahead">
                <ul className="-mx-1 divide-y divide-ff-line/60">
                  {need.slots.map((s) => (
                    <li key={s.index} className="flex h-8 items-center gap-2 px-1 text-[12.5px]">
                      <span className="w-8 shrink-0 font-mono text-[10.5px] text-ff-muted">{s.slot.replace('SUPER_FLEX', 'SF')}</span>
                      <span className="min-w-0 flex-1">
                        {s.starter ? (
                          <PlayerName player={data.players[s.starter]} id={s.starter} size={20} />
                        ) : (
                          <FreeAgentPick eligible={s.eligible} week={data.horizon[0]?.week} size={20} />
                        )}
                      </span>
                      <span className="num w-10 shrink-0 text-right text-ff-text2">{fmt(s.pts)}</span>
                    </li>
                  ))}
                </ul>
              </SheetSection>
            )}
          </SheetBody>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ff-line px-4 py-2.5">
            <span className="min-w-0 truncate text-[11.5px] text-ff-muted">Roster, results and slots on the team page</span>
            <Button size="sm" variant="primary" onClick={open}>
              Open team page →
            </Button>
          </footer>
        </>
      )}
    </Sheet>
  )
}

export default TeamSheet
