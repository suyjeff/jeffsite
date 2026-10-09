import React from 'react'
import { cx } from './ui'

// The app's few icons, drawn on a 14px grid in the house's technical style: 1px hairlines, square ends, crisp
// edges, no fills but for the one mark that carries state. They take the colour of the text around them.

const Svg = ({ children, className, size = 14 }: { children: React.ReactNode; className?: string; size?: number }) => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="square"
    shapeRendering="crispEdges"
    className={cx('shrink-0', className)}
  >
    {children}
  </svg>
)

/** A trade: two lanes, one each way, with square heads. */
export const TradeIcon = ({ className, size }: { className?: string; size?: number }) => (
  <Svg className={className} size={size}>
    <path d="M1.5 4.5h10M9.5 2.5l2 2-2 2" />
    <path d="M12.5 9.5h-10M4.5 7.5l-2 2 2 2" />
  </Svg>
)

/** Something being put together: a frame with a cross at its centre, as on a drafting sheet. */
export const BuildIcon = ({ className, size }: { className?: string; size?: number }) => (
  <Svg className={className} size={size}>
    <path d="M1.5 4V1.5H4M10 1.5h2.5V4M12.5 10v2.5H10M4 12.5H1.5V10" />
    <path d="M7 4.5v5M4.5 7h5" />
  </Svg>
)

/** Add one more: a plus in a square. */
export const AddIcon = ({ className, size }: { className?: string; size?: number }) => (
  <Svg className={className} size={size}>
    <rect x="1.5" y="1.5" width="11" height="11" />
    <path d="M7 4.5v5M4.5 7h5" />
  </Svg>
)

/** Opens a detail: an arrow out of a corner. */
export const OpenIcon = ({ className, size }: { className?: string; size?: number }) => (
  <Svg className={className} size={size}>
    <path d="M5.5 2.5h-3v9h9v-3" />
    <path d="M8 2.5h3.5V6M11.5 2.5 6.5 7.5" />
  </Svg>
)

/**
 * A pane with its sidebar ruled off: the show and hide sidebar control. Drawn like the usual panel glyph (a square
 * window, one rule just left of centre) with a hairline stroke; `open` shades the sidebar side, so the same icon
 * says which state it is in and eases between them.
 */
export const PanelIcon = ({ className, size = 16, open }: { className?: string; size?: number; open?: boolean }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="miter" className={cx('shrink-0', className)}>
    <path
      d="M1.5 2.5H6v11H1.5Z"
      fill="currentColor"
      stroke="none"
      className="motion-safe:transition-opacity motion-safe:duration-150"
      style={{ opacity: open ? 0.22 : 0 }}
    />
    <rect x="1.5" y="2.5" width="13" height="11" />
    <path d="M6 2.5v11" />
  </svg>
)

/** An insight: a bulb cut in facets, on a neck and a base rule, with the filament rising into it. */
export const BulbIcon = ({ className, size }: { className?: string; size?: number }) => (
  <Svg className={className} size={size}>
    <path d="M4.5 10.5v-2l-2-2v-3l2-2h5l2 2v3l-2 2v2Z" />
    <path d="M7 10.5V7M5.5 12.5h3" />
  </Svg>
)

/** An instruction: an i in a square, as AddIcon draws its plus. */
export const InfoIcon = ({ className, size }: { className?: string; size?: number }) => (
  <Svg className={className} size={size}>
    <rect x="1.5" y="1.5" width="11" height="11" />
    <path d="M7 6.5V10" />
    <rect x="6.5" y="3.5" width="1" height="1" fill="currentColor" stroke="none" />
  </Svg>
)
