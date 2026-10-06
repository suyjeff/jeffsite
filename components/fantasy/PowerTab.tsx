import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { Avatar, Card, Meter, Muted, Pill, Sparkline, Table, fmt, fmtSigned, pct, type Column } from './ui'

type Row = { rosterId: number }

const PowerTab = ({ data, analysis, onSelectTeam }: { data: LeagueData; analysis: Analysis; onSelectTeam: (rosterId: number) => void }) => {
  const [mode, setMode] = useState<'power' | 'standings'>('power')
  const { teamById, seasonById, powerById, strength, myRosterId } = analysis
  const maxStrength = Math.max(...Object.values(strength), 0.0001)
  const rows: Row[] = useMemo(() => {
    const ids = analysis.teams.map((t) => t.rosterId)
    if (mode === 'power') return analysis.power.map((p) => ({ rosterId: p.rosterId }))
    return ids
      .sort((a, b) => {
        const sa = seasonById[a]
        const sb = seasonById[b]
        return sb.wins - sa.wins || sa.losses - sb.losses || sb.pf - sa.pf
      })
      .map((rosterId) => ({ rosterId }))
  }, [mode, analysis, seasonById])

  const played = data.regularWeeks.length
  const columns: Column<Row>[] = [
    {
      key: 'rank',
      label: '#',
      sort: (r) => (mode === 'power' ? -powerById[r.rosterId].rank : rows.findIndex((x) => x.rosterId === r.rosterId) * -1),
      render: (r) => <span className="text-stone-400 dark:text-stone-500">{mode === 'power' ? powerById[r.rosterId].rank : rows.findIndex((x) => x.rosterId === r.rosterId) + 1}</span>,
    },
    {
      key: 'team',
      label: 'Team',
      sort: (r) => teamById[r.rosterId].name,
      render: (r) => {
        const t = teamById[r.rosterId]
        return (
          <span className="flex items-center gap-2 min-w-[160px]">
            <Avatar src={t.avatar} name={t.name} />
            <span className="leading-tight">
              <span className="block font-medium tracking-tight">{t.name}</span>
              <span className="block text-xs text-stone-400 dark:text-stone-500">{t.owner}</span>
            </span>
            {r.rosterId === myRosterId && <Pill tone="accent">you</Pill>}
          </span>
        )
      },
    },
    {
      key: 'score',
      label: 'Power',
      align: 'right',
      sort: (r) => powerById[r.rosterId].score,
      title: 'Composite of all-play record, scoring, recent form, roster strength and lineup efficiency (0-100)',
      render: (r) => (
        <span className="inline-flex items-center gap-2 justify-end">
          <Meter value={powerById[r.rosterId].score} max={100} width={60} />
          <span className="w-8 inline-block">{fmt(powerById[r.rosterId].score, 0)}</span>
        </span>
      ),
    },
    {
      key: 'record',
      label: 'Record',
      align: 'right',
      sort: (r) => seasonById[r.rosterId].wins + seasonById[r.rosterId].ties / 2,
      render: (r) => {
        const s = seasonById[r.rosterId]
        if (!s.games) return <Muted>–</Muted>
        return `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`
      },
    },
    {
      key: 'allplay',
      label: 'All-play',
      align: 'right',
      title: 'Record if you played every team every week. The luck-free version of your record.',
      sort: (r) => seasonById[r.rosterId].allPlayPct,
      render: (r) => {
        const s = seasonById[r.rosterId]
        if (!s.games) return <Muted>–</Muted>
        return (
          <span>
            {fmt(s.allPlayWins, 0)}-{fmt(s.allPlayLosses, 0)} <Muted>({pct(s.allPlayPct)})</Muted>
          </span>
        )
      },
    },
    {
      key: 'luck',
      label: 'Luck',
      align: 'right',
      title: 'Actual wins minus expected wins from all-play. Positive means the schedule has been kind.',
      sort: (r) => seasonById[r.rosterId].luck,
      render: (r) => {
        const l = seasonById[r.rosterId].luck
        if (!seasonById[r.rosterId].games) return <Muted>–</Muted>
        return <span className={l > 0.75 ? 'text-emerald-700 dark:text-emerald-400' : l < -0.75 ? 'text-rose-700 dark:text-rose-400' : ''}>{fmtSigned(l, 1)}</span>
      },
    },
    { key: 'pf', label: 'PF/G', align: 'right', sort: (r) => seasonById[r.rosterId].ppg, render: (r) => (seasonById[r.rosterId].games ? fmt(seasonById[r.rosterId].ppg) : <Muted>–</Muted>) },
    { key: 'pa', label: 'PA/G', align: 'right', sort: (r) => seasonById[r.rosterId].papg, render: (r) => (seasonById[r.rosterId].games ? fmt(seasonById[r.rosterId].papg) : <Muted>–</Muted>) },
    { key: 'recent', label: 'Last 3', align: 'right', title: 'Points per game over the last three weeks', sort: (r) => seasonById[r.rosterId].recentPpg, render: (r) => (seasonById[r.rosterId].games ? fmt(seasonById[r.rosterId].recentPpg) : <Muted>–</Muted>) },
    {
      key: 'roster',
      label: 'Roster',
      align: 'right',
      title: 'Forward-looking roster strength: recent WAR/game of the optimal lineup plus a discounted bench',
      sort: (r) => strength[r.rosterId],
      render: (r) => (
        <span className="inline-flex items-center gap-2 justify-end">
          <Meter value={strength[r.rosterId]} max={maxStrength} width={50} />
          <span className="w-10 inline-block">{fmtSigned(strength[r.rosterId], 2)}</span>
        </span>
      ),
    },
    { key: 'eff', label: 'Eff', align: 'right', title: 'Actual points as a share of the best possible lineup each week', sort: (r) => seasonById[r.rosterId].efficiency, render: (r) => (seasonById[r.rosterId].games ? pct(seasonById[r.rosterId].efficiency) : <Muted>–</Muted>) },
    {
      key: 'sos',
      label: 'SOS',
      align: 'right',
      title: 'Average power score of remaining regular-season opponents',
      sort: (r) => powerById[r.rosterId].sos ?? -1,
      render: (r) => fmt(powerById[r.rosterId].sos, 0),
    },
    { key: 'streak', label: 'Strk', align: 'right', render: (r) => seasonById[r.rosterId].streak || '–' },
    {
      key: 'spark',
      label: 'Weekly',
      render: (r) => {
        const s = seasonById[r.rosterId]
        return <Sparkline points={s.weeks.map((w) => w.points)} labels={s.weeks.map((w) => `Wk ${w.week}`)} />
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Card
        title={mode === 'power' ? 'Power rankings' : 'Standings'}
        aside={
          <span className="space-x-3">
            <button onClick={() => setMode('power')} className={mode === 'power' ? 'text-stone-900 dark:text-stone-100 underline' : 'hover:underline'}>
              Power
            </button>
            <button onClick={() => setMode('standings')} className={mode === 'standings' ? 'text-stone-900 dark:text-stone-100 underline' : 'hover:underline'}>
              Standings
            </button>
            <span>· {played} wk{played === 1 ? '' : 's'} played</span>
          </span>
        }
      >
        <Table rows={rows} columns={columns} rowKey={(r) => r.rosterId} onRowClick={(r) => onSelectTeam(r.rosterId)} rowClass={(r) => (r.rosterId === myRosterId ? 'bg-sky-50/60 dark:bg-sky-950/20' : '')} />
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Power blends all-play record, scoring, recent form, roster strength and lineup efficiency. Weights live in the Model tab.
          {played === 0 && ' No games yet, so only roster strength counts.'}
        </p>
      </Card>
    </div>
  )
}

export default PowerTab
