import React, { type CSSProperties } from 'react'
import { cx } from './ui'

// Line art for the power-rank reveal, drawn like the tour's diagrams: hairline strokes on a construction grid, square
// nodes at the points that matter, small mono labels. Each stroke traces itself in (stroke-dashoffset over a
// pathLength of 1) after its own --d. Styles live in fantasy.css (.ff-rv-art and the tour's .ff-dg).

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

/** One stroke that draws itself in. */
const Ln = ({ p, at, tone = 'ink', w }: { p: string; at: number; tone?: 'ink' | 'hot' | 'cons' | 'gold' | 'mute'; w?: number }) => (
  <path d={p} pathLength={1} className={cx('draw', `ff-rv-${tone}`)} style={{ ...d(at), strokeWidth: w }} />
)

/** A square node at a point, popping in after `at`. */
const Node = ({ x, y, at, hot }: { x: number; y: number; at: number; hot?: boolean }) => (
  <rect x={x - 2} y={y - 2} width={4} height={4} className={cx('in', hot ? 'ff-rv-node-hot' : 'ff-rv-node')} style={d(at)} />
)

const Tag = ({ x, y, at, children, anchor }: { x: number; y: number; at: number; children: React.ReactNode; anchor?: 'end' | 'middle' }) => (
  <text x={x} y={y} className="lbl in" textAnchor={anchor} style={d(at)}>
    {children}
  </text>
)

/**
 * The model's face: a gorilla drawn as a technical study. Head with its crest, ears, the heavy brow, the face mask,
 * eyes, the broad nose and the muzzle, over a construction circle and axes, with the measured points marked.
 */
export const GorillaFace = ({ size = 200, start = 0, speed = 1, className }: { size?: number; start?: number; /** Under 1 draws it faster: every delay scaled, each stroke quicker. */ speed?: number; className?: string }) => {
  const t = (ms: number) => start + ms * speed
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={cx('ff-dg ff-rv-art block overflow-visible', speed < 1 && 'ff-rv-quick', className)} role="img" aria-label="The model's gorilla, drawn as a technical study">
      {/* Construction: the bounding circle, the centre axis and the eye line. */}
      <Ln p="M100 15a84 84 0 1 1 0 168a84 84 0 1 1 0-168" at={t(0)} tone="cons" />
      <Ln p="M100 6V194" at={t(80)} tone="cons" />
      <Ln p="M22 98H178" at={t(160)} tone="cons" />
      {/* Head, crest and ears. */}
      <Ln p="M100 18C116 18 132 24 142 36C152 48 158 64 160 82C162 100 160 114 156 126C150 144 140 158 126 170C118 177 110 182 100 182C90 182 82 177 74 170C60 158 50 144 44 126C40 114 38 100 40 82C42 64 48 48 58 36C68 24 84 18 100 18Z" at={t(200)} />
      <Ln p="M80 28C88 21 112 21 120 28" at={t(560)} />
      <Ln p="M42 92C32 90 27 98 28 106C29 114 35 118 42 116" at={t(620)} />
      <Ln p="M158 92C168 90 173 98 172 106C171 114 165 118 158 116" at={t(620)} />
      {/* The heavy brow, doubled for its depth. */}
      <Ln p="M54 84C62 70 82 66 100 74C118 66 138 70 146 84" at={t(760)} w={1.6} />
      <Ln p="M58 90C68 80 84 78 100 84C116 78 132 80 142 90" at={t(840)} />
      {/* The face mask, eyes and nose. */}
      <Ln p="M64 92C62 106 64 118 70 128C76 137 86 141 100 141C114 141 124 137 130 128C136 118 138 106 136 92" at={t(920)} tone="cons" />
      <Ln p="M76.5 98a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0" at={t(1040)} />
      <Ln p="M112.5 98a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0" at={t(1040)} />
      <rect x={80.5} y={96.5} width={3} height={3} className="in ff-rv-node-hot" style={d(t(1300))} />
      <rect x={116.5} y={96.5} width={3} height={3} className="in ff-rv-node-hot" style={d(t(1300))} />
      <Ln p="M94 103C93 109 92 113 88 117" at={t(1120)} />
      <Ln p="M106 103C107 109 108 113 112 117" at={t(1120)} />
      <Ln p="M84 123C84 115 91 111 100 111C109 111 116 115 116 123C116 130 109 133 100 133C91 133 84 130 84 123Z" at={t(1180)} w={1.4} />
      <Ln p="M89 122a4 3 0 1 0 8 0a4 3 0 1 0-8 0" at={t(1300)} />
      <Ln p="M103 122a4 3 0 1 0 8 0a4 3 0 1 0-8 0" at={t(1300)} />
      {/* Muzzle, mouth and chin. */}
      <Ln p="M66 132C68 156 84 170 100 170C116 170 132 156 134 132" at={t(1360)} />
      <Ln p="M80 152C90 158 110 158 120 152" at={t(1460)} tone="hot" />
      <Ln p="M92 164C96 166 104 166 108 164" at={t(1520)} />
      {/* Measured points and the span between the eyes. */}
      <Node x={82} y={98} at={t(1600)} hot />
      <Node x={118} y={98} at={t(1600)} hot />
      <Node x={100} y={122} at={t(1660)} />
      <Node x={80} y={152} at={t(1700)} />
      <Node x={120} y={152} at={t(1700)} />
      <Ln p="M82 106V112M118 106V112M82 109H118" at={t(1700)} tone="hot" />
      <Tag x={127} y={113} at={t(1800)}>
        36.0
      </Tag>
      <Tag x={104} y={12} at={t(1850)}>
        AXIS
      </Tag>
    </svg>
  )
}

/** A dashed line that fades in (a dashed stroke cannot also trace itself in). */
const Dash = ({ p, at, tone = 'cons', dash = '1.5 2' }: { p: string; at: number; tone?: 'cons' | 'mute' | 'hot'; dash?: string }) => (
  <path d={p} className={cx('in', `ff-rv-${tone}`)} strokeDasharray={dash} style={d(at)} />
)

/** Last place's mark as paths in a 64×60 box, shared with the share card, which strokes them on a canvas. */
export const POOP_BODY = [
  'M16 45H48C50.5 45 51.5 42.5 50.5 40.5C49.5 38 47 37 44.5 37H19.5C17 37 14.5 38 13.5 40.5C12.5 42.5 13.5 45 16 45Z',
  'M19.5 37C17.5 37 16.5 35 17.5 33C18.5 31 20.5 30 23 30H41C43.5 30 45.5 31 46.5 33C47.5 35 46.5 37 44.5 37',
  'M23 30C22 28 23 25 26 24C29 23 31 22.5 32 20.5C33 18.5 34 17.5 36 18.5C38 19.5 38.5 21.5 37.5 23.5C40 24 41.5 26 41 30',
  'M32 20.5C31 18.5 32 16 34.5 15',
]
export const POOP_FACE = ['M25.5 34.5C26.5 33.3 28.5 33.3 29.5 34.5M34.5 34.5C35.5 33.3 37.5 33.3 38.5 34.5', 'M28.5 41C30.5 39.5 33.5 39.5 35.5 41']

/**
 * Last place's mark, drawn as a technical study: a pile in three tiers with a twist on top, sad eyes and a frown,
 * set on a centre line and a ground datum, dimensioned across and up, with its right side broken out in section
 * (hatched) along the cut line A. Three stink lines waft off the top. Line art like everything else here, not a cartoon.
 */
export const Poop = ({ size = 48, start = 0, speed = 1, className }: { size?: number; start?: number; /** Under 1 draws it faster. */ speed?: number; className?: string }) => {
  const t = (ms: number) => start + ms * speed
  return (
    <svg viewBox="0 0 64 60" width={size} height={(size * 60) / 64} className={cx('ff-dg ff-rv-art ff-rv-poop block overflow-visible', speed < 1 && 'ff-rv-quick', className)} role="img" aria-label="Last place">
      <defs>
        <pattern id="ff-rv-sect" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V2.4" className="ff-rv-sect-line" />
        </pattern>
      </defs>
      {/* Construction: the centre line and the ground datum. */}
      <Dash p="M32 8V50" at={t(0)} dash="5 1.5 1 1.5" />
      <Ln p="M6 45H58" at={t(60)} tone="cons" />
      {/* The three tiers and the twist. */}
      <Ln p={POOP_BODY[0]} at={t(140)} />
      <Ln p={POOP_BODY[1]} at={t(280)} />
      <Ln p={POOP_BODY[2]} at={t(420)} />
      <Ln p={POOP_BODY[3]} at={t(560)} />
      {/* Sad eyes and a frown. */}
      <Ln p={POOP_FACE[0]} at={t(660)} tone="hot" />
      <Ln p={POOP_FACE[1]} at={t(740)} tone="hot" />
      {/* Broken out in section to the right of the cut line A: the lower two tiers hatched. */}
      <path d="M42 37H44.5C47 37 49.5 38 50.5 40.5C51.5 42.5 50.5 45 48 45H42Z M42 30C43.5 30.1 45.5 31 46.5 33C47.5 35 46.5 37 44.5 37H42Z" fill="url(#ff-rv-sect)" className="in" style={d(t(860))} />
      <Dash p="M42 25V49" at={t(820)} tone="hot" dash="4 1.5 1 1.5" />
      <text x={42} y={23.5} textAnchor="middle" fontSize={5} className="lbl hot in" style={d(t(900))}>
        A
      </text>
      {/* Dimensions: across the base, and from the ground to the tip of the twist. */}
      <Dash p="M13 46V53M51 46V53" at={t(940)} dash="1 1.5" tone="mute" />
      <Ln p="M13 51H51M13 49.5V52.5M51 49.5V52.5" at={t(980)} tone="mute" />
      <text x={32} y={58.5} textAnchor="middle" fontSize={5} className="lbl in" style={d(t(1080))}>
        38.0
      </text>
      <Dash p="M37 15H60" at={t(1000)} dash="1 1.5" tone="mute" />
      <Ln p="M58 15V45M56.5 15H59.5M56.5 45H59.5" at={t(1040)} tone="mute" />
      <text x={61.5} y={30} textAnchor="middle" fontSize={5} className="lbl in" transform="rotate(-90 61.5 30)" style={d(t(1120))}>
        30.0
      </text>
      <Node x={34.5} y={15} at={t(1100)} hot />
      {/* Stink lines over the top, drifting up once drawn. */}
      <g className="ff-rv-waft" style={d(t(1400))}>
        <Ln p="M21 14C19 12.5 23 11 21 9.5C19 8 23 6.5 21 5" at={t(1160)} tone="mute" />
        <Ln p="M27 11C25 9.5 29 8 27 6.5C25 5 29 3.5 27 2" at={t(1220)} tone="mute" />
        <Ln p="M45 14C43 12.5 47 11 45 9.5C43 8 47 6.5 45 5" at={t(1280)} tone="mute" />
      </g>
    </svg>
  )
}
