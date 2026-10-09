import React from 'react'
import { useFantasy } from './FantasyContext'
import GameSheet from './GameSheet'
import MatchupSheet from './MatchupSheet'
import PlayerSheet from './PlayerSheet'
import Sheet, { SheetNavContext } from './Sheet'
import TeamSheet from './TeamSheet'

/** What a sheet can show. Every entity in the app opens one of these. */
export type SheetRef = { kind: 'player'; id: string } | { kind: 'team'; id: number } | { kind: 'game'; key: string } | { kind: 'matchup'; week: number; a: number; b: number }

export const sheetKey = (r: SheetRef) =>
  r.kind === 'player' ? `p:${r.id}` : r.kind === 'team' ? `t:${r.id}` : r.kind === 'game' ? `g:${r.key}` : `m:${r.week}:${Math.min(r.a, r.b)}:${Math.max(r.a, r.b)}`

/**
 * The one sheet: whatever is open shows here, always the same width, and opening something from inside it (a player
 * from a team, a manager from a matchup) swaps the content in place, with a way back, rather than stacking panels.
 */
const SheetHost = ({ stack, onBack, onClose }: { stack: SheetRef[]; onBack: () => void; onClose: () => void }) => {
  const { data, analysis } = useFantasy()
  const top = stack[stack.length - 1]
  // A ref to something no longer in the league (a switch mid-render, a stale link) opens nothing rather than an empty sheet.
  if (!top || (top.kind === 'player' && !data.players[top.id]) || (top.kind === 'team' && !analysis.teamById[top.id])) return null
  const name = (r: SheetRef | undefined): string => {
    if (!r) return ''
    if (r.kind === 'player') return data.players[r.id]?.name.split(' ').slice(-1)[0] ?? 'player'
    if (r.kind === 'team') return analysis.teamById[r.id]?.name ?? 'team'
    if (r.kind === 'game') return r.key.split(':')[1]?.replace('@', ' @ ') ?? 'game'
    return 'matchup'
  }
  const label =
    top.kind === 'player'
      ? `${data.players[top.id]?.name ?? 'Player'} details`
      : top.kind === 'team'
        ? `${name(top)} summary`
        : top.kind === 'game'
          ? `${name(top)} game`
          : `${analysis.teamById[top.a]?.name ?? ''} vs ${analysis.teamById[top.b]?.name ?? ''}`
  const prev = stack[stack.length - 2]
  return (
    <Sheet label={label} onClose={onClose} contentKey={sheetKey(top)}>
      {({ close, phone }) => (
        <SheetNavContext.Provider value={{ close, phone, back: prev ? onBack : undefined, backLabel: prev ? name(prev) : undefined }}>
          {top.kind === 'player' ? (
            <PlayerSheet key={sheetKey(top)} id={top.id} />
          ) : top.kind === 'team' ? (
            <TeamSheet key={sheetKey(top)} rosterId={top.id} />
          ) : top.kind === 'game' ? (
            <GameSheet key={sheetKey(top)} gameKey={top.key} />
          ) : (
            <MatchupSheet key={sheetKey(top)} week={top.week} a={top.a} b={top.b} />
          )}
        </SheetNavContext.Provider>
      )}
    </Sheet>
  )
}

export default SheetHost
