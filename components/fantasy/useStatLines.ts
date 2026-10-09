import { useEffect, useState } from 'react'
import { getWeekStatLines } from '../../lib/fantasy/sleeper'
import type { WeekStats } from '../../lib/fantasy/types'

/** Sleeper's projected stat lines for each of `weeks`, loaded once per week and kept; null where a week failed. */
export const useStatLines = (season: string, weeks: number[]) => {
  const [lines, setLines] = useState<Record<number, WeekStats | null>>({})
  const key = weeks.join(',')
  useEffect(() => {
    let live = true
    for (const w of weeks) {
      if (w in lines) continue
      getWeekStatLines(season, w)
        .then((s) => live && setLines((x) => ({ ...x, [w]: s })))
        .catch(() => live && setLines((x) => ({ ...x, [w]: null })))
    }
    return () => {
      live = false
    }
  }, [season, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return lines
}
