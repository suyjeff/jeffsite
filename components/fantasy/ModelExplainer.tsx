import React from 'react'
import { ELO, EFFICIENCY_PRIOR_GAMES, SIM } from '../../lib/fantasy/forecast'
import { RESULTS_PRIOR_GAMES } from '../../lib/fantasy/power'

export type RankingModel = 'forecast' | 'composite' | 'elo'

const TEXT: Record<RankingModel, { title: string; body: React.ReactNode }> = {
  forecast: {
    title: 'How the forecast works',
    body: (
      <>
        <p>
          A team&apos;s rating is the points it should score per week from here: its best possible lineup each week on Sleeper&apos;s projections (byes, injuries and prop lines
          priced in), times how well its manager has turned projections into points. That efficiency is pulled hard toward the league&apos;s rate, as if every manager had already
          played {EFFICIENCY_PRIOR_GAMES} average games, because a few weeks of it is mostly noise.
        </p>
        <p>
          Playoff odds come from playing the rest of the season out {SIM.sims.toLocaleString()} times with these ratings, real weekly randomness, and
          {` ${Math.round(SIM.persistence * 100)}%`} of each team&apos;s gap to average carried forward, since rosters drift toward the middle. Both settings were fitted on how 148
          real 2025 leagues finished. Of the three models it predicts single games best in the backtest (Model tab).
        </p>
      </>
    ),
  },
  composite: {
    title: 'How the composite works',
    body: (
      <>
        <p>
          A blend of five things, each compared with the rest of the league: all-play record (how often your score beat everyone else&apos;s each week), points per game, recent
          form, roster strength, and lineup efficiency. Results are discounted early in the season: a team&apos;s results count as if mixed with {RESULTS_PRIOR_GAMES} games of
          league-average play, because a few weeks of fantasy scores are mostly luck.
        </p>
        <p>The score is the chance of beating a league-average team in a given week, so 50 is average and 60 is clearly good. Weights are adjustable in Model.</p>
      </>
    ),
  },
  elo: {
    title: 'How Elo works',
    body: (
      <>
        <p>
          Elo knows only who beat whom and by how much. Every team starts at {ELO.base} (or last season&apos;s rating, pulled {Math.round(ELO.regress * 100)}% of the way back to{' '}
          {ELO.base} over the summer). After each game the winner takes rating points from the loser: more for an upset, more for a lopsided score, using FiveThirtyEight&apos;s NFL
          formula with a step size of {ELO.k}.
        </p>
        <p>
          A 100-point gap means the higher team wins about 64% of the time; 200 points, about 76%. Because it never looks at rosters, Elo is slow to notice trades and injuries.
          Read it as a record of what has happened, not a projection of what will.
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
