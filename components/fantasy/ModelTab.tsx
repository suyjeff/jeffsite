import React from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import { DEFAULT_POWER_WEIGHTS, type PowerWeights } from '../../lib/fantasy/power'
import { clearFantasyCache } from '../../lib/fantasy/sleeper'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { DEFAULT_MODEL, type ModelConfig } from '../../lib/fantasy/war'
import { starterDemand } from '../../lib/fantasy/lineup'
import { Card, Slider, Table, fmt } from './ui'

const ModelTab = ({
  data,
  analysis,
  model,
  setModel,
  weights,
  setWeights,
  reload,
}: {
  data: LeagueData
  analysis: Analysis
  model: ModelConfig
  setModel: (m: ModelConfig) => void
  weights: PowerWeights
  setWeights: (w: PowerWeights) => void
  reload: () => void
}) => {
  const numTeams = data.league.total_rosters || data.rosters.length
  const demand = starterDemand(data.league.roster_positions ?? [], numTeams)
  const positions = Object.keys(demand)
  const levelRows = positions.map((pos) => {
    const xs = data.valueWeeks.map((w) => analysis.levels[w]?.[pos] ?? 0)
    const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
    return { pos, demand: demand[pos], rank: Math.round(demand[pos] * (1 + model.benchFactor)), avg }
  })

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card title="Value model">
        <div className="space-y-4">
          <Slider
            label="Replacement depth"
            value={model.benchFactor}
            min={0}
            max={1.5}
            step={0.05}
            onChange={(v) => setModel({ ...model, benchFactor: v })}
            format={(v) => v.toFixed(2)}
            hint="0 = worst weekly starter (classic VBD). Around 0.6 = best player on waivers in a typical 12-team league. Higher makes everyone look valuable."
          />
          <Slider
            label="Recency half-life (weeks)"
            value={model.halfLife}
            min={0}
            max={8}
            step={1}
            onChange={(v) => setModel({ ...model, halfLife: v })}
            format={(v) => (v === 0 ? 'off' : `${v} wk`)}
            hint='Drives the "Now" column and roster strength. A week that is one half-life old counts half as much.'
          />
          <Slider
            label="Risk aversion"
            value={model.riskAversion}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setModel({ ...model, riskAversion: v })}
            format={(v) => v.toFixed(2)}
            hint="Risk-adjusted PPG = PPG minus this times weekly standard deviation. Raise it if you'd rather have a floor than a ceiling."
          />
          <button onClick={() => setModel(DEFAULT_MODEL)} className="text-sm underline decoration-stone-400">
            Reset to defaults
          </button>
        </div>
      </Card>

      <Card title="Power ranking weights">
        <div className="space-y-4">
          {(
            [
              ['allPlay', 'All-play record', 'Wins against every team every week. Removes schedule luck.'],
              ['points', 'Points per game', 'Raw scoring.'],
              ['recent', 'Recent form', 'Points per game over the last three weeks.'],
              ['roster', 'Roster strength', 'Recency-weighted WAR of the optimal lineup plus a discounted bench. The only forward-looking piece.'],
              ['efficiency', 'Lineup efficiency', 'Actual points as a share of optimal. Rewards managers who set lineups well.'],
            ] as [keyof PowerWeights, string, string][]
          ).map(([k, label, hint]) => (
            <Slider key={k} label={label} value={weights[k]} min={0} max={1} step={0.05} onChange={(v) => setWeights({ ...weights, [k]: v })} format={(v) => v.toFixed(2)} hint={hint} />
          ))}
          <button onClick={() => setWeights(DEFAULT_POWER_WEIGHTS)} className="text-sm underline decoration-stone-400">
            Reset to defaults
          </button>
        </div>
      </Card>

      <Card title="Replacement levels" aside={`${data.valueSeason} · avg over ${data.valueWeeks.length} wks`}>
        <Table
          rows={levelRows}
          columns={[
            { key: 'pos', label: 'Pos', render: (r) => r.pos },
            { key: 'demand', label: 'Started/wk', align: 'right', title: 'League-wide starter demand, flex slots split by typical usage', render: (r) => fmt(r.demand) },
            { key: 'rank', label: 'Repl. rank', align: 'right', render: (r) => `${r.pos}${r.rank}` },
            { key: 'avg', label: 'Repl. pts', align: 'right', render: (r) => fmt(r.avg) },
          ]}
          rowKey={(r) => r.pos}
        />
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Team-score standard deviation used for wins: {fmt(analysis.sigma)} pts. Source: {data.pointsSource === 'stats' || data.pointsSource === 'proxy-stats' ? 'Sleeper stat feed, all players' : data.pointsSource === 'none' ? 'none' : 'league matchups, rostered players only'}.
        </p>
      </Card>

      <Card title="How it works">
        <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
          <p>
            <b>PAR</b> (points above replacement) is a player&apos;s weekly score minus the replacement level at their position that week. Replacement level is the score at the rank just past league-wide starter demand plus the bench buffer above.
          </p>
          <p>
            <b>WAR</b> converts PAR to wins. Against a random opponent an average team wins 50% of the time; adding PAR points moves that to Φ(PAR ÷ σ√2), where σ is the league&apos;s team-score standard deviation. The difference is wins added that week, summed over the season. A 40-point week can&apos;t be worth more than one win.
          </p>
          <p>
            <b>To me</b> ignores all of that and asks the question you actually care about: how many points per week would this player have added to <i>your</i> optimal lineup, given who you already have. A stud WR3 behind two stars is worth little to you and a lot to a team with a hole.
          </p>
          <p>
            <b>Roster strength</b> is the optimal lineup by recency-weighted WAR per game plus a quarter of the top three bench values.
          </p>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            Data is cached in this browser: player list 24h, past weeks 24h, live week 5 min.{' '}
            <button
              className="underline decoration-stone-400"
              onClick={() => {
                clearFantasyCache()
                reload()
              }}
            >
              Clear cache and reload
            </button>
          </p>
        </div>
      </Card>
    </div>
  )
}

export default ModelTab
