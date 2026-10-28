// Season simulations off the critical path. A full run is the forecast's 4,000 seasons (about 30 ms on a laptop, four
// times that on a slow phone), and a page can want dozens: both sides of every game this week, each trade idea, each
// what-if pick. Here they run in slices of seasons with the page given a turn between them, so no single task holds
// the main thread for more than a few milliseconds. A slice is a range of the run's own seasons (SimInput.from), and
// slices add up to the whole run exactly (addCounts), so a sliced result is the same number as an unsliced one.
//
// One queue serves the whole page, one job at a time in order; work someone is waiting for goes ahead of background
// work, and a job whose signal is aborted is dropped at its next slice.

import { addCounts, finishSim, simulateCounts, type SimCounts, type SimInput, type SimTeam } from './forecast'

/** Seasons per slice: a few milliseconds even on a slow phone. */
export const SLICE = 250
/** Work per turn before the page gets the thread back. */
const BUDGET_MS = 6

type Job = {
  input: SimInput
  next: number
  end: number
  parts: SimCounts[]
  /** Someone is waiting on it: ahead of idle work, and run between frames rather than only when idle. */
  urgent: boolean
  signal?: AbortSignal
  resolve: (r: Record<number, SimTeam> | null) => void
}

const jobs: Job[] = []
let scheduled = false
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const schedule = () => {
  if (scheduled || !jobs.length) return
  scheduled = true
  const g = globalThis as typeof globalThis & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (!jobs.some((j) => j.urgent) && g.requestIdleCallback) g.requestIdleCallback(pump, { timeout: 400 })
  else setTimeout(pump, 0)
}

const pump = () => {
  scheduled = false
  const t0 = now()
  do {
    const i = Math.max(0, jobs.findIndex((j) => j.urgent))
    const job = jobs[i]
    if (!job) break
    if (job.signal?.aborted) {
      jobs.splice(i, 1)
      job.resolve(null)
      continue
    }
    const n = Math.min(SLICE, job.end - job.next)
    if (n > 0) job.parts.push(simulateCounts({ ...job.input, from: job.next, sims: n }))
    job.next += n
    if (job.next >= job.end) {
      jobs.splice(i, 1)
      job.resolve(finishSim(addCounts(job.parts)))
    }
  } while (jobs.length && now() - t0 < BUDGET_MS)
  schedule()
}

/**
 * Simulate `input` in slices on the shared queue. Resolves to exactly simulateSeason(input), or null if `signal` was
 * aborted first. `urgent` for a result on screen now; otherwise it waits for idle time.
 */
export const runSim = (input: SimInput, opts: { urgent?: boolean; signal?: AbortSignal } = {}): Promise<Record<number, SimTeam> | null> =>
  new Promise((resolve) => {
    if (opts.signal?.aborted) return resolve(null)
    const from = input.from ?? 0
    jobs.push({ input, next: from, end: from + input.sims, parts: [], urgent: opts.urgent ?? true, signal: opts.signal, resolve })
    schedule()
  })
