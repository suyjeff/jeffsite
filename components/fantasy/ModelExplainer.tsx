import React from 'react'
import { ELO, EFFICIENCY_PRIOR_GAMES, SIM } from '../../lib/fantasy/forecast'
import { RESULTS_PRIOR_GAMES } from '../../lib/fantasy/power'
import { N } from './ui'

export type RankingModel = 'forecast' | 'composite' | 'elo'

const TEXT: Record<RankingModel, { title: string; body: React.ReactNode }> = {
  forecast: {
    title: 'How the forecast works',
    body: (
      <>
        <p>
          Rating = each week&apos;s best projected lineup × how well the manager turns projections into points. That efficiency is shrunk toward the league&apos;s, as if every
          manager had <N>{EFFICIENCY_PRIOR_GAMES}</N> average games behind them.
        </p>
        <p>
          Playoff odds replay the season <N>{SIM.sims.toLocaleString()}</N> times, carrying <N>{Math.round(SIM.persistence * 100)}%</N> of each team&apos;s edge forward. Both
          settings were fitted on <N>148</N> finished 2025 leagues. It predicts single games best of the three models.
        </p>
      </>
    ),
  },
  composite: {
    title: 'How the composite works',
    body: (
      <>
        <p>
          Five signals, each against the league: all-play record, points per game, form, roster strength and lineup efficiency. Early results count as if mixed with{' '}
          <N>{RESULTS_PRIOR_GAMES}</N> average games, since a few weeks are mostly luck.
        </p>
        <p>
          The score is the chance to beat an average team in a week: <N>50</N> is average. Weights are in Tuning.
        </p>
      </>
    ),
  },
  elo: {
    title: 'How Elo works',
    body: (
      <>
        <p>
          Who beat whom and by how much, judged against the lineups each side had. Teams start at <N>{ELO.base}</N>, or last season&apos;s rating pulled{' '}
          <N>{Math.round(ELO.regress * 100)}%</N> back. Each game is expected to go the way the ratings and the two projected lineups point, and a win takes points from the
          loser, more for upsets and blowouts (538&apos;s NFL formula, <N>K={ELO.k}</N>). Losing with your starters out costs less than losing at full strength.
        </p>
        <p>
          The rating shown adds <N>{Math.round(ELO.lineupShare * 100)}%</N> of each team&apos;s projected-lineup edge over an average lineup, converted at the odds that points edge would give, after 538&apos;s ELWAY. A <N>100</N>-point gap wins about <N>64%</N> of the time.
        </p>
      </>
    ),
  },
}

/** A quiet "how this works" under a ranking: closed by default, there for the curious. */
const ModelExplainer = ({ model }: { model: RankingModel }) => (
  <details className="group border border-t-0 border-ff-line bg-ff-panel">
    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-mono text-[11px] text-ff-muted hover:text-ff-text [&::-webkit-details-marker]:hidden">
      <span className="inline-block transition-transform group-open:rotate-90">›</span>
      {TEXT[model].title}
    </summary>
    <div className="max-w-[72ch] space-y-2 px-3 pb-3 text-[12.5px] leading-relaxed text-ff-text2">{TEXT[model].body}</div>
  </details>
)

export default ModelExplainer
