import React, { useMemo } from 'react'
import { NameplateData } from './types'
import NameplatePreview from './NameplatePreview'

interface Props {
  plates: NameplateData[]
}

function seededRandom(seed: string): () => number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  }
  return () => {
    h ^= h << 13
    h ^= h >> 17
    h ^= h << 5
    return ((h >>> 0) / 4294967296)
  }
}

interface Placement {
  x: number
  y: number
  rotation: number
}

function computePlacements(plates: NameplateData[], containerW: number, containerH: number): Placement[] {
  const results: Placement[] = []
  const plateW = 160
  const plateH = 52
  const padding = 12

  for (const plate of plates) {
    const rng = seededRandom(plate.id)
    let bestX = padding
    let bestY = padding
    let placed = false

    for (let attempt = 0; attempt < 60; attempt++) {
      const x = padding + rng() * Math.max(0, containerW - plateW - padding * 2)
      const y = padding + rng() * Math.max(0, containerH - plateH - padding * 2)
      let overlap = false

      for (const prev of results) {
        if (
          Math.abs(x - prev.x) < plateW + 8 &&
          Math.abs(y - prev.y) < plateH + 8
        ) {
          overlap = true
          break
        }
      }

      bestX = x
      bestY = y
      if (!overlap) {
        placed = true
        break
      }
    }

    const rotation = (seededRandom(plate.id + 'r')() - 0.5) * 6
    results.push({ x: bestX, y: bestY, rotation })
  }

  return results
}

const NameplateBoard: React.FC<Props> = ({ plates }) => {
  const containerW = 560
  const minH = 420
  const rowHeight = 64
  const dynamicH = Math.max(minH, Math.ceil(plates.length / 3) * rowHeight + 40)

  const placements = useMemo(
    () => computePlacements(plates, containerW, dynamicH),
    [plates, containerW, dynamicH],
  )

  if (plates.length === 0) {
    return (
      <div className="y2k-board flex items-center justify-center" style={{ minHeight: minH }}>
        <p className="text-stone-400 dark:text-stone-500 text-sm italic">
          No nameplates yet. Be the first!
        </p>
      </div>
    )
  }

  return (
    <div className="y2k-board" style={{ height: dynamicH }}>
      {plates.map((plate, i) => {
        const p = placements[i]
        if (!p) return null
        return (
          <div
            key={plate.id}
            className="absolute transition-transform"
            style={{
              left: p.x,
              top: p.y,
              transform: `rotate(${p.rotation}deg)`,
            }}
          >
            <NameplatePreview
              name={plate.name}
              theme={plate.theme}
              font={plate.font}
              effect={plate.effect}
              compact
            />
          </div>
        )
      })}
    </div>
  )
}

export default NameplateBoard
