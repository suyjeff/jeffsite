import React, { type CSSProperties, type ReactNode } from 'react'

// Diagrams for the tour, one per section, in the house style: hairline wires, square nodes, mono labels,
// and a little signal moving through. Drawn on a 480 × 168 grid; styles and motion live in fantasy.css (.ff-dg).

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

const Box = ({ x, y, w, h, label, hot, at = 0, sub }: { x: number; y: number; w: number; h: number; label?: string; hot?: boolean; at?: number; sub?: string }) => (
  <g className="in" style={d(at)}>
    <rect x={x + 0.5} y={y + 0.5} width={w} height={h} className={hot ? 'box hot' : 'box'} />
    {label && (
      <text x={x + 7} y={y + 14} className={hot ? 'lbl hot' : 'lbl ink'}>
        {label}
      </text>
    )}
    {sub && (
      <text x={x + 7} y={y + 26} className="lbl">
        {sub}
      </text>
    )}
  </g>
)

/** An orthogonal wire that draws itself in, with a signal running along it once drawn. */
const Wire = ({ path, hot, at = 0, flow }: { path: string; hot?: boolean; at?: number; flow?: boolean }) => (
  <>
    <path d={path} pathLength={1} className={hot ? 'wire hot draw' : 'wire draw'} style={d(at)} />
    {flow && <path d={path} className="flow" style={d(at + 500)} />}
  </>
)

const Node = ({ x, y, hot, at = 0 }: { x: number; y: number; hot?: boolean; at?: number }) => (
  <rect x={x - 2.5} y={y - 2.5} width={5} height={5} className={hot ? 'fill' : 'fill dim'} style={d(at)} />
)

const Label = ({ x, y, children, tone, at = 0, anchor }: { x: number; y: number; children: ReactNode; tone?: 'ink' | 'hot'; at?: number; anchor?: 'end' | 'middle' }) => (
  <text x={x} y={y} className={cx('lbl in', tone)} style={d(at)} textAnchor={anchor}>
    {children}
  </text>
)

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

/** A horizontal bar that grows from its left edge. */
const Bar = ({ x, y, w, h = 6, tone, at = 0, hatch }: { x: number; y: number; w: number; h?: number; tone?: 'dim' | 'neg'; at?: number; hatch?: boolean }) => (
  <rect x={x} y={y} width={w} height={h} className={cx(hatch ? 'hatch' : cx('fill', tone), 'grow')} style={d(at)} />
)

const Frame = ({ children, title }: { children: ReactNode; title: string }) => (
  <svg viewBox="0 0 480 168" className="ff-dg block h-auto w-full" role="img" aria-label={title}>
    <defs>
      <pattern id="ff-dg-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="rgb(var(--ff-accent) / 0.08)" />
        <line x1="0" y1="0" x2="0" y2="4" stroke="rgb(var(--ff-accent) / 0.55)" strokeWidth="1.5" />
      </pattern>
    </defs>
    {/* Registration ticks at the corners, like a plotted sheet. */}
    {[
      [8, 8],
      [472, 8],
      [8, 160],
      [472, 160],
    ].map(([x, y]) => (
      <path key={`${x}${y}`} d={`M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`} className="grid" />
    ))}
    {children}
  </svg>
)

const Welcome = () => (
  <Frame title="Sleeper data flows into one model, which feeds every page">
    <Box x={16} y={62} w={110} h={44} label="SLEEPER" sub="league · stats" at={0} />
    <Box x={194} y={50} w={92} h={68} label="M.O.N.K.E." sub="one model" hot at={250} />
    <Box x={364} y={20} w={92} h={30} label="ODDS" at={700} />
    <Box x={364} y={69} w={92} h={30} label="TRADES" at={820} />
    <Box x={364} y={118} w={92} h={30} label="MOVES" at={940} />
    <Wire path="M126 84H194" hot at={200} flow />
    <Wire path="M286 84H325V35H364" at={600} flow />
    <Wire path="M286 84H364" at={650} flow />
    <Wire path="M286 84H325V133H364" at={700} flow />
    <Node x={325} y={84} hot at={600} />
  </Frame>
)

const Dash = () => (
  <Frame title="Widgets on a grid, two of them linked">
    {[
      [32, 22, 132, 58],
      [174, 22, 88, 58],
      [272, 22, 176, 58],
      [32, 90, 196, 56],
      [238, 90, 210, 56],
    ].map(([x, y, w, h], i) => (
      <Box key={i} x={x} y={y} w={w} h={h} hot={i === 0 || i === 4} label={['MATCHUP', 'ODDS', 'TRADES', 'STANDINGS', 'PLAYER'][i]} at={i * 120} />
    ))}
    <Bar x={40} y={58} w={70} at={700} />
    <Bar x={40} y={66} w={46} tone="dim" at={760} />
    <Wire path="M98 80V86H343V90" hot at={900} flow />
    <Node x={220} y={86} hot at={1000} />
    <Label x={226} y={83} tone="hot" at={1050}>
      LINK
    </Label>
  </Frame>
)

const Matchup = () => (
  <Frame title="Your lineup against theirs, actual points solid and projections hatched">
    <Label x={40} y={26} tone="ink">
      YOU
    </Label>
    <Label x={440} y={26} tone="ink" anchor="end">
      THEM
    </Label>
    {[0, 1, 2, 3, 4].map((i) => {
      const y = 38 + i * 22
      const mine = [70, 42, 88, 30, 56][i]
      const theirs = [54, 64, 40, 72, 36][i]
      const done = i < 2
      return (
        <g key={i}>
          <Label x={240} y={y + 7} anchor="middle" at={i * 80}>
            {['QB', 'RB', 'WR', 'TE', 'FLX'][i]}
          </Label>
          {done ? <Bar x={222 - mine} y={y} w={mine} at={200 + i * 80} /> : <Bar x={222 - mine} y={y} w={mine} hatch at={200 + i * 80} />}
          {done ? <Bar x={258} y={y} w={theirs} tone="dim" at={260 + i * 80} /> : <Bar x={258} y={y} w={theirs} hatch at={260 + i * 80} />}
        </g>
      )
    })}
    <path d="M240 34V150" className="grid" />
    <Label x={40} y={156} at={900}>
      ▪ FINAL
    </Label>
    <Label x={110} y={156} tone="hot" at={950}>
      ▨ PROJECTED
    </Label>
  </Frame>
)

const Gameday = () => (
  <Frame title="NFL games wired to the managers whose odds they move">
    {['DET @ ARI', 'BAL @ ATL', 'SF @ SEA'].map((g, i) => (
      <Box key={g} x={28} y={24 + i * 42} w={104} h={30} label={g} hot={i === 0} at={i * 120} />
    ))}
    <Box x={348} y={34} w={104} h={34} label="YOU" sub="win 58%" hot at={400} />
    <Box x={348} y={98} w={104} h={34} label="THEM" at={480} />
    <Wire path="M132 39H240V51H348" hot at={600} flow />
    <Wire path="M132 81H260V115H348" at={700} flow />
    <Wire path="M132 81H240V51" at={760} />
    <Wire path="M132 123H280V115" at={820} />
    <Label x={186} y={34} tone="hot" at={900}>
      ±18
    </Label>
    <Label x={196} y={76} at={950}>
      ±12
    </Label>
  </Frame>
)

const Trades = () => (
  <Frame title="Players swapping between two rosters, weighed on a balance">
    <Label x={56} y={24} tone="ink">
      YOU
    </Label>
    <Label x={424} y={24} tone="ink" anchor="end">
      THEM
    </Label>
    {[0, 1, 2, 3].map((i) => (
      <React.Fragment key={i}>
        <Box x={40} y={32 + i * 28} w={84} h={20} hot={i === 1} at={i * 80} />
        <Box x={356} y={32 + i * 28} w={84} h={20} hot={i === 2} at={i * 80 + 40} />
      </React.Fragment>
    ))}
    <Wire path="M124 70H240V98H356" hot at={500} flow />
    <Wire path="M356 98H300V70H124" at={650} />
    <path d="M200 140H280M240 140V128" className="wire" />
    <rect x="196" y="122" width="88" height="2" className="fill slide" style={{ ...d(900), '--dy': '-2px' } as CSSProperties} />
    <Label x={240} y={156} anchor="middle" at={900}>
      BOTH LINEUPS GAIN
    </Label>
  </Frame>
)

const Team = () => (
  <Frame title="Lineup slots measured against the league average">
    {['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX'].map((s, i) => {
      const y = 20 + i * 19
      const w = [62, 80, 36, 70, 52, 90, 44][i]
      return (
        <g key={i}>
          <Label x={40} y={y + 7} at={i * 60}>
            {s}
          </Label>
          <Bar x={76} y={y} w={w * 1.6} tone={i === 2 ? 'neg' : undefined} at={150 + i * 60} />
        </g>
      )
    })}
    <path d="M190 14V152" className="wire draw" pathLength={1} style={d(500)} />
    <Label x={194} y={12} at={600}>
      LEAGUE AVG
    </Label>
    <Box x={348} y={50} w={104} h={44} label="BIGGEST HOLE" sub="RB2 · −4.0/wk" hot at={900} />
    <Wire path="M134 63H300V72H348" hot at={1000} flow />
  </Frame>
)

const Waivers = () => (
  <Frame title="Free agents ranked by gain, the best one bid on and added">
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <Box x={28} y={22 + i * 32} w={150} h={24} hot={i === 0} at={i * 90} />
        <Bar x={36} y={32 + i * 32} w={[110, 84, 60, 40][i]} tone={i ? 'dim' : undefined} at={300 + i * 90} />
      </g>
    ))}
    <Box x={234} y={22} w={76} h={36} label="BID" sub="$14" hot at={700} />
    <Box x={366} y={22} w={86} h={36} label="ROSTER" at={800} />
    <Box x={366} y={98} w={86} h={36} label="DROP" at={860} />
    <Wire path="M178 34H234" hot at={750} flow />
    <Wire path="M310 40H366" hot at={850} flow />
    <Wire path="M409 58V98" at={950} />
  </Frame>
)

const Power = () => (
  <Frame title="Teams ranked by rating, with playoff odds">
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <g key={i}>
        <Label x={40} y={30 + i * 22} tone={i === 2 ? 'hot' : 'ink'} at={i * 70}>
          {String(i + 1).padStart(2, '0')}
        </Label>
        <Bar x={64} y={23 + i * 22} w={[300, 268, 240, 196, 150, 110][i]} tone={i === 2 ? undefined : 'dim'} at={200 + i * 70} />
        <Label x={440} y={30 + i * 22} anchor="end" at={700 + i * 50}>
          {['97%', '88%', '71%', '44%', '19%', '6%'][i]}
        </Label>
      </g>
    ))}
  </Frame>
)

const Teams = () => (
  <Frame title="One team's roster broken down by position">
    <Box x={190} y={60} w={100} h={48} label="TEAM" sub="power #3" hot at={0} />
    {['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p, i) => {
      const left = i < 3
      const x = left ? 40 : 360
      const y = 24 + (i % 3) * 46
      return (
        <g key={p}>
          <Box x={x} y={y} w={80} h={26} label={p} at={200 + i * 90} />
          <Wire path={left ? `M120 ${y + 13}H155V84H190` : `M290 84H325V${y + 13}H360`} at={300 + i * 90} flow={i === 1} hot={i === 1} />
        </g>
      )
    })}
  </Frame>
)

const Players = () => {
  const dots = [
    [70, 120],
    [96, 96],
    [118, 108],
    [150, 82],
    [176, 92],
    [210, 64],
    [236, 74],
    [270, 52],
    [300, 60],
    [334, 40],
    [364, 50],
    [400, 30],
  ]
  return (
    <Frame title="Players plotted by value, one picked out">
      <path d="M48 140H448M48 20V140" className="grid" />
      {dots.map(([x, y], i) => (
        <rect key={i} x={x - 3} y={y - 3} width={6} height={6} className={cx('fill in', i === 8 ? '' : 'dim')} style={d(i * 50)} />
      ))}
      <Wire path="M300 140V60H48" hot at={800} />
      <Box x={316} y={86} w={120} h={34} label="VALUE +6.2/WK" sub="ROS · ECR 14" hot at={1000} />
      <Label x={448} y={154} anchor="end">
        PROJECTED VALUE →
      </Label>
    </Frame>
  )
}

const Monke = () => (
  <Frame title="The model's pieces, wired in order from data to odds">
    {['DATA', 'VALUE', 'LINEUPS', 'FORECAST', 'ODDS'].map((n, i) => (
      <Box key={n} x={24 + i * 92} y={64} w={70} h={40} label={n} hot={i === 3} at={i * 120} />
    ))}
    {[0, 1, 2, 3].map((i) => (
      <Wire key={i} path={`M${94 + i * 92} 84H${116 + i * 92}`} hot={i === 2} at={300 + i * 120} flow />
    ))}
    <Wire path="M335 104V136H151V104" at={900} />
    <Label x={243} y={150} anchor="middle" at={1000}>
      BACKTEST · CHECKS IT AGAINST REAL WEEKS
    </Label>
  </Frame>
)

const Tuning = () => (
  <Frame title="Sliders that reshape the model's curve">
    {[0, 1, 2].map((i) => (
      <g key={i}>
        <Label x={40} y={34 + i * 40} tone="ink">
          {['HORIZON', 'WEIGHT', 'BENCH'][i]}
        </Label>
        <path d={`M40 ${46 + i * 40}H200`} className="wire" />
        <rect
          x={[80, 130, 100][i]}
          y={41 + i * 40}
          width={10}
          height={10}
          className="fill slide"
          style={{ ...d(600 + i * 200), '--dx': `${[40, -30, 50][i]}px` } as CSSProperties}
        />
      </g>
    ))}
    <path d="M240 140H448M240 24V140" className="grid" />
    <path d="M240 130C300 128 330 60 448 40" pathLength={1} className="wire hot draw" style={d(300)} />
    <path d="M240 134C320 132 360 90 448 70" pathLength={1} className="wire draw" style={d(500)} />
  </Frame>
)

const Finish = () => (
  <Frame title="The command palette, opened with Command K">
    <Box x={40} y={52} w={44} h={40} label="⌘" hot at={0} />
    <Box x={92} y={52} w={44} h={40} label="K" hot at={120} />
    <Wire path="M136 72H200" hot at={300} flow />
    <Box x={200} y={24} w={248} h={120} at={400} />
    <rect x={212} y={36} width={224} height={20} className="box hot in" style={d(500)} />
    <rect x={220} y={42} width={2} height={9} className="fill blink" />
    {[0, 1, 2].map((i) => (
      <Bar key={i} x={216} y={70 + i * 22} w={[150, 110, 130][i]} tone="dim" at={600 + i * 100} />
    ))}
  </Frame>
)

export const DIAGRAMS = {
  welcome: Welcome,
  dash: Dash,
  matchup: Matchup,
  slate: Gameday,
  trades: Trades,
  me: Team,
  waivers: Waivers,
  power: Power,
  teams: Teams,
  players: Players,
  monke: Monke,
  model: Tuning,
  finish: Finish,
}
export type DiagramKey = keyof typeof DIAGRAMS
