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
export const GorillaFace = ({ size = 200, start = 0, className }: { size?: number; start?: number; className?: string }) => {
  const t = (ms: number) => start + ms
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={cx('ff-dg ff-rv-art block overflow-visible', className)} role="img" aria-label="The model's gorilla, drawn as a technical study">
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

/**
 * A football in line art, side on: a prolate spheroid (about 1.7 to 1 across, its tips just pointed), the long seam
 * over the top with the laces stitched across it, the panel seam below, and the long axis as a construction line.
 * The hull is filled with the panel so lines behind it stop at its edge. Centred on (28, 18).
 */
export const Football = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 56 36" width={56} height={36} className={cx('ff-rv-art block overflow-visible', className)} aria-hidden>
    <path d="M2 18C7 7.5 17 2.5 28 2.5C39 2.5 49 7.5 54 18C49 28.5 39 33.5 28 33.5C17 33.5 7 28.5 2 18Z" className="ff-rv-ink ff-rv-hull" />
    {/* The long axis, dashed, out past each tip. */}
    <path d="M-3 18H59" className="ff-rv-cons" strokeDasharray="1.5 2.5" />
    {/* The panel seams: the laced one over the top, the plain one below. */}
    <path d="M4.5 15C12 9 20 7.2 28 7.2C36 7.2 44 9 51.5 15" className="ff-rv-ink" />
    <path d="M4.5 21C12 27 20 28.8 28 28.8C36 28.8 44 27 51.5 21" className="ff-rv-cons" />
    {/* Laces: eight stitches across the top seam, square to it. */}
    <path d="M19 6.4V10.6M21.6 6V10.2M24.2 5.7V9.9M26.8 5.5V9.7M29.4 5.5V9.7M32 5.7V9.9M34.6 6V10.2M37.2 6.4V10.6" className="ff-rv-hot" />
    <rect x={1} y={17} width={2} height={2} className="ff-rv-node-hot" />
    <rect x={53} y={17} width={2} height={2} className="ff-rv-node-hot" />
    <rect x={27} y={17} width={2} height={2} className="ff-rv-node" />
  </svg>
)

/**
 * Last place's mark: a pile in three tiers with a twist on top, sad eyes and a frown, and three stink lines that
 * waft. Line art like everything else here, not a cartoon.
 */
export const Poop = ({ size = 48, start = 0, className }: { size?: number; start?: number; className?: string }) => {
  const t = (ms: number) => start + ms
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={cx('ff-dg ff-rv-art ff-rv-poop block overflow-visible', className)} role="img" aria-label="Last place">
      <Ln p="M8 41H40C42.5 41 43.5 38.5 42.5 36.5C41.5 34 39 33 36.5 33H11.5C9 33 6.5 34 5.5 36.5C4.5 38.5 5.5 41 8 41Z" at={t(0)} />
      <Ln p="M11.5 33C9.5 33 8.5 31 9.5 29C10.5 27 12.5 26 15 26H33C35.5 26 37.5 27 38.5 29C39.5 31 38.5 33 36.5 33" at={t(140)} />
      <Ln p="M15 26C14 24 15 21 18 20C21 19 23 18.5 24 16.5C25 14.5 26 13.5 28 14.5C30 15.5 30.5 17.5 29.5 19.5C32 20 33.5 22 33 26" at={t(280)} />
      <Ln p="M24 16.5C23 14.5 24 12 26.5 11" at={t(420)} />
      {/* Sad eyes and a frown. */}
      <Ln p="M17.5 30.5C18.5 29.3 20.5 29.3 21.5 30.5M26.5 30.5C27.5 29.3 29.5 29.3 30.5 30.5" at={t(520)} tone="hot" />
      <Ln p="M20.5 37C22.5 35.5 25.5 35.5 27.5 37" at={t(600)} tone="hot" />
      {/* Stink lines, drifting up once drawn. */}
      <g className="ff-rv-waft" style={d(t(900))}>
        <Ln p="M9 22C7 20 11 18 9 16C7 14 11 12 9 10" at={t(700)} tone="mute" />
        <Ln p="M39 22C37 20 41 18 39 16C37 14 41 12 39 10" at={t(780)} tone="mute" />
      </g>
    </svg>
  )
}
