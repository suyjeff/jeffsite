import React, { useMemo } from 'react'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import { Table, cx, fmt, type Column } from './ui'

type Row = { id: string; slot: string; starter: boolean; n: number }

const NON_START = new Set(['BN', 'IR', 'TAXI'])

/** A team's players as Sleeper has them set: starters in slot order, then bench, IR and taxi. */
export const useRosterRows = (rosterId: number): Row[] => {
  const { data, analysis } = useFantasy()
  const team = analysis.teamById[rosterId]
  return useMemo(() => {
    if (!team) return []
    // Index slots on the unfiltered list: an empty slot ('0') still holds its place.
    const slotted = team.roster.starters ?? []
    const starterSet = new Set(slotted.filter((s) => s && s !== '0'))
    const slotNames = (data.league.roster_positions ?? []).filter((p) => !NON_START.has(p))
    const out: Omit<Row, 'n'>[] = slotted.flatMap((id, i) => (id && id !== '0' ? [{ id, slot: (slotNames[i] ?? 'ST').replace('SUPER_FLEX', 'SF'), starter: true }] : []))
    const reserve = new Set(team.roster.reserve ?? [])
    const taxi = new Set(team.roster.taxi ?? [])
    for (const id of team.players) {
      if (starterSet.has(id)) continue
      out.push({ id, slot: reserve.has(id) ? 'IR' : taxi.has(id) ? 'TX' : 'BN', starter: false })
    }
    return out.map((r, n) => ({ ...r, n }))
  }, [team, data.league.roster_positions])
}

/**
 * A team's whole roster in a sheet, dense: slot, player (opens his sheet), NFL team, next bye and points a week
 * ahead. Runs edge to edge in its section; the first and last cells keep the sheet's inset so the slot column lines
 * up with the section title above it.
 */
const RosterTable = ({ rosterId }: { rosterId: number }) => {
  const { data, analysis } = useFantasy()
  const rows = useRosterRows(rosterId)
  const players = data.players
  const week = data.horizon[0]?.week ?? 0
  const perWeek = analysis.horizon.perWeek

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: 'slot',
        label: 'Slot',
        className: '!pl-4',
        sort: (r) => -r.n,
        render: (r) => <span className={cx('font-mono text-[11px]', r.starter ? 'text-ff-text2' : 'text-ff-muted')}>{r.slot}</span>,
      },
      {
        key: 'player',
        label: 'Player',
        className: 'max-w-[150px] overflow-hidden sm:max-w-[190px]',
        sort: (r) => players[r.id]?.name ?? r.id,
        render: (r) => <PlayerName player={players[r.id]} id={r.id} size={20} />,
      },
      {
        key: 'team',
        label: 'Tm',
        title: 'NFL team',
        render: (r) => <span className="font-mono text-[11px] text-ff-muted">{players[r.id]?.team ?? 'FA'}</span>,
      },
      {
        key: 'bye',
        label: 'Bye',
        title: 'His next bye week',
        align: 'right',
        sort: (r) => data.context[r.id]?.byes.find((w) => w >= week) ?? 99,
        render: (r) => {
          const bye = data.context[r.id]?.byes.find((w) => w >= week)
          if (bye == null) return <span className="text-ff-muted">–</span>
          return <span className={bye === week ? 'text-ff-warn' : 'text-ff-muted'}>{bye}</span>
        },
      },
      {
        key: 'pts',
        label: 'Pts/wk',
        title: 'Expected points per week ahead, after injury odds and teammates’ absences',
        align: 'right',
        className: '!pr-4',
        sort: (r) => perWeek[r.id] ?? 0,
        render: (r) => <span className="text-ff-text">{fmt(perWeek[r.id])}</span>,
      },
    ],
    [players, data.context, week, perWeek],
  )

  return <Table rows={rows} columns={columns} rowKey={(r) => r.id} dense rowClass={(r) => (r.starter ? '' : 'bg-ff-sunken/40')} />
}

export default RosterTable
