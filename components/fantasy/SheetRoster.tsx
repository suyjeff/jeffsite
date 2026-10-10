import React, { useMemo } from 'react'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import { blankEmpty, rosterRows, type RosterRow as Row } from '../../lib/fantasy/roster'
import { INSIGHT_ROW, InsightMark } from './InsightMark'
import { Table, cx, fmt, pct, type Column } from './ui'

/**
 * A team's whole roster in a sheet, dense: slot, player (opens his sheet; his NFL team and injury tag ride with the
 * name), next bye, how likely he plays and points a week ahead. Runs edge to edge in its section; the first and last cells keep the sheet's inset so the slot column lines
 * up with the section title above it.
 */
const SheetRoster = ({ rosterId, marked }: { rosterId: number; /** Players an insight above is about. */ marked?: Set<string> }) => {
  const { data, analysis } = useFantasy()
  const team = analysis.teamById[rosterId]
  const rows = useMemo(() => (team ? rosterRows(team, data.league.roster_positions) : []), [team, data.league.roster_positions])
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
        render: (r) =>
          r.empty ? (
            <span className="text-ff-muted">empty</span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <PlayerName player={players[r.id]} id={r.id} size={20} className="min-w-0" />
              {marked?.has(r.id) && (
                <span className="shrink-0">
                  <InsightMark title="The summary above is about him" />
                </span>
              )}
            </span>
          ),
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
        key: 'play',
        label: 'Plays',
        title: 'Share of the weeks ahead he is expected to play',
        align: 'right',
        sort: (r) => data.context[r.id]?.play ?? 1,
        render: (r) => {
          const play = data.context[r.id]?.play
          return <span className={play != null && play < 0.8 ? 'text-ff-neg' : 'text-ff-muted'}>{pct(play)}</span>
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
    [players, data.context, week, perWeek, marked],
  )

  return <Table rows={rows} columns={blankEmpty(columns)} rowKey={(r) => r.id} dense rowClass={(r) => cx(r.starter ? '' : 'bg-ff-sunken/40', marked?.has(r.id) && INSIGHT_ROW)} />
}

export default SheetRoster
