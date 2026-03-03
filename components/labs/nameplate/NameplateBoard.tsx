import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { NameplateData } from './types'
import NameplatePreview from './NameplatePreview'
import { getToken, updateNameplatePosition } from './api'

interface Props {
  plates: NameplateData[]
  frameless?: boolean
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

type DragState = {
  plateId: string
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  rotation: number
}

const NameplateBoard: React.FC<Props> = ({ plates, frameless }) => {
  const containerW = 560
  const minH = 420
  const rowHeight = 64
  const dynamicH = Math.max(minH, Math.ceil(plates.length / 3) * rowHeight + 40)

  const seededPlacements = useMemo(
    () => computePlacements(plates, containerW, dynamicH),
    [plates, containerW, dynamicH],
  )

  const basePlacements = useMemo(
    () =>
      plates.map((plate, i) => {
        const seeded = seededPlacements[i]
        if (plate.x != null && plate.y != null) {
          return { x: plate.x, y: plate.y, rotation: plate.rotation ?? seeded.rotation }
        }
        return seeded
      }),
    [plates, seededPlacements],
  )

  const [overrides, setOverrides] = useState<Record<string, Placement>>({})
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const latestDragPlacementRef = useRef<Placement | null>(null)
  const didDragRef = useRef(false)
  const myToken = getToken()

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return
      const nextPlacement = {
        x: dragging.startX + (e.clientX - dragging.startClientX),
        y: dragging.startY + (e.clientY - dragging.startClientY),
        rotation: dragging.rotation,
      }
      didDragRef.current = true
      latestDragPlacementRef.current = nextPlacement
      setOverrides((prev) => ({
        ...prev,
        [dragging.plateId]: nextPlacement,
      }))
    },
    [dragging],
  )

  const handleMouseUp = useCallback(() => {
    if (!dragging) return
    const final = latestDragPlacementRef.current ?? overrides[dragging.plateId]
    if (didDragRef.current && final) {
      updateNameplatePosition(dragging.plateId, final)
    }
    didDragRef.current = false
    latestDragPlacementRef.current = null
    setDragging(null)
  }, [dragging, overrides])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  if (plates.length === 0) {
    return (
      <div
        className={`${frameless ? 'y2k-board-frameless' : 'y2k-board'} flex items-center justify-center`}
        style={{ minHeight: minH }}
      >
        <p className="text-stone-400 dark:text-stone-500 text-sm italic">
          No nameplates yet. Be the first!
        </p>
      </div>
    )
  }

  const boardClass = [
    frameless ? 'y2k-board-frameless' : 'y2k-board',
    'relative select-none overflow-visible',
  ].join(' ')

  return (
    <div
      className={boardClass}
      style={{ height: dynamicH }}
      data-dragging={dragging ? 'true' : undefined}
    >
      {plates.map((plate, i) => {
        const base = basePlacements[i]
        const override = overrides[plate.id]
        const p = override ?? base
        if (!p) return null

        const isCreator = plate.visitorToken === myToken
        const isDragging = dragging?.plateId === plate.id
        const isHovered = hoveredId === plate.id && isCreator

        const wrapperClasses = [
          'absolute',
          isCreator ? 'transition-shadow duration-200 ease-out' : '',
          isCreator ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : '',
          isDragging
            ? 'shadow-xl shadow-stone-400/50 dark:shadow-stone-950/60 z-10'
            : isHovered
              ? 'shadow-lg shadow-stone-300/70 dark:shadow-stone-900/70'
              : '',
        ].join(' ')

        const borderOverride = isDragging
          ? 'border-sky-300 dark:border-sky-400'
          : isHovered
            ? 'border-stone-200 dark:border-stone-600'
            : undefined

        return (
          <div
            key={plate.id}
            className={wrapperClasses}
            style={{
              left: p.x,
              top: p.y,
              transform: `rotate(${p.rotation}deg)`,
            }}
            onMouseEnter={isCreator ? () => setHoveredId(plate.id) : undefined}
            onMouseLeave={isCreator ? () => setHoveredId(null) : undefined}
            onMouseDown={
              isCreator
                ? (e) => {
                    e.preventDefault()
                    didDragRef.current = false
                    latestDragPlacementRef.current = {
                      x: p.x,
                      y: p.y,
                      rotation: p.rotation,
                    }
                    setDragging({
                      plateId: plate.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startX: p.x,
                      startY: p.y,
                      rotation: p.rotation,
                    })
                  }
                : undefined
            }
          >
            <NameplatePreview
              name={plate.name}
              theme={plate.theme}
              font={plate.font}
              effect={plate.effect}
              compact
              borderOverride={borderOverride}
            />
          </div>
        )
      })}
    </div>
  )
}

export default NameplateBoard
