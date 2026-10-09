import React from 'react'
import { BASE_AVAILABILITY, type ContextNote, type PlayerContext } from '../../lib/fantasy/context'
import type { PlayerMap } from '../../lib/fantasy/types'
import type { Reason } from './ui'

const last = (name: string | undefined, id: string) => (name ? name.split(' ').slice(-1)[0] : id)

const weekRange = (weeks: number[]) => {
  if (!weeks.length) return ''
  const sorted = [...weeks].sort((a, b) => a - b)
  const contiguous = sorted.every((w, i) => i === 0 || w === sorted[i - 1] + 1)
  if (sorted.length === 1) return `wk ${sorted[0]}`
  return contiguous ? `wks ${sorted[0]}–${sorted[sorted.length - 1]}` : `wks ${sorted.join(', ')}`
}

type Tone = 'warn' | 'bad' | 'good' | 'info'
const TONES: Record<Tone, string> = {
  warn: 'bg-ff-warn/15 text-ff-warn',
  bad: 'bg-ff-neg/10 text-ff-neg',
  good: 'bg-ff-pos/10 text-ff-pos',
  info: 'bg-ff-sunken text-ff-text2',
}

/** One note as a short label and the sentence behind it. */
export const describeNote = (note: ContextNote, players: PlayerMap): { tone: Tone; label: string; title: string } => {
  switch (note.kind) {
    case 'status':
      return {
        tone: 'warn',
        label: `${note.status} · ${Math.round(note.play * 100)}% wk ${note.week}`,
        title: `Listed ${note.status}, but projected to play in week ${note.week}. Counted at ${Math.round(note.play * 100)}%; the rest goes to teammates.`,
      }
    case 'history':
      return {
        tone: 'bad',
        label: `played ${note.played}/${note.games}`,
        title: `Played ${note.played} of his team's last ${note.games} games. Expected to play ${Math.round(note.rate * 100)}% ahead (typical starter: ${Math.round(BASE_AVAILABILITY * 100)}%).`,
      }
    case 'bump': {
      const who = note.from.map((id) => last(players[id]?.name, id)).join(', ')
      return {
        tone: 'good',
        label: `+${note.pts.toFixed(1)} covering ${who}`,
        title: `Gains ${note.pts.toFixed(1)} pts/wk on average from games ${who} should miss.`,
      }
    }
    case 'temporary': {
      const who = note.behind.map((id) => last(players[id]?.name, id)).join(', ')
      return {
        tone: 'warn',
        label: `bigger role ${weekRange(note.weeks)} only`,
        title: `${note.during.toFixed(1)}/wk while ${who} is out (${weekRange(note.weeks)}), then about ${note.after.toFixed(1)}. Sell high if someone prices the short-term number.`,
      }
    }
    case 'returns':
      return note.week
        ? { tone: 'bad', label: `out until wk ${note.week}`, title: `Projected to return in week ${note.week}.` }
        : { tone: 'bad', label: 'out all horizon', title: 'Not projected to play in any week of the horizon.' }
    case 'usage': {
      const up = note.last > note.prior
      return {
        tone: up ? 'good' : 'warn',
        label: `work ${Math.round(note.prior)}→${note.last}`,
        title: `Carries + targets: ${note.prior.toFixed(1)} a game before, ${note.last} last game (${Math.round(note.lastSnaps * 100)}% of snaps).${!up && note.injury ? ` Listed ${note.injury}: maybe an in-game injury, not a role change.` : ''} About ${Math.round(note.carryover * 100)}% of a swing like this carries over, and Sleeper already prices that. If the news says otherwise, set a read.`,
      }
    }
    case 'playoffs':
      return {
        tone: note.vsNormal > 0 ? 'good' : 'warn',
        label: `playoffs ${note.vsNormal > 0 ? '+' : ''}${Math.round(note.vsNormal * 100)}%`,
        title: `${Math.abs(Math.round(note.vsNormal * 100))}% ${note.vsNormal > 0 ? 'above' : 'below'} his usual week in ${weekRange(note.weeks)}, on Sleeper's matchup projections.`,
      }
  }
}

const ORDER: ContextNote['kind'][] = ['returns', 'status', 'temporary', 'history', 'bump', 'usage', 'playoffs']

export const ContextNotes = ({ context, players, max = 4 }: { context?: PlayerContext; players: PlayerMap; max?: number }) => {
  if (!context?.notes.length) return null
  const notes = [...context.notes].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).slice(0, max)
  return (
    <span className="flex flex-wrap gap-1">
      {notes.map((n, i) => {
        const d = describeNote(n, players)
        return (
          <span key={i} title={d.title} className={`inline-block cursor-help whitespace-nowrap rounded-sm px-1.5 py-[1px] text-[10.5px] font-medium leading-[16px] ${TONES[d.tone]}`}>
            {d.label}
          </span>
        )
      })}
    </span>
  )
}

/** Every note as a full sentence with its tone, for an expanded row or a justification list. */
export const contextReasons = (context: PlayerContext | undefined, players: PlayerMap): Reason[] =>
  context
    ? [...context.notes]
        .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
        .map((n) => {
          const d = describeNote(n, players)
          return {
            text: (
              <>
                <span className="font-medium text-ff-text">{d.label}.</span> {d.title}
              </>
            ),
            tone: d.tone === 'bad' ? 'neg' : d.tone === 'good' ? 'pos' : d.tone === 'warn' ? 'warn' : 'neutral',
          } satisfies Reason
        })
    : []

/** Opponents in the fantasy playoff weeks, the schedule people actually trade for. */
export const PlayoffSchedule = ({ context, weeks }: { context?: PlayerContext; weeks: number[] }) => {
  if (!context || !weeks.length) return null
  const games = weeks.map((w) => context.schedule.find((s) => s.week === w))
  if (games.every((g) => !g)) return null
  return (
    <span className="num whitespace-nowrap text-xs">
      {games.map((g, i) => (
        <span key={weeks[i]} className={g && !g.opp ? 'text-ff-neg' : ''}>
          {i > 0 && <span className="text-ff-line2"> · </span>}
          {g ? (g.opp ?? 'BYE') : '–'}
        </span>
      ))}
    </span>
  )
}
