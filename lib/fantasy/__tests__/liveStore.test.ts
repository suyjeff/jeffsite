import { beforeEach, describe, expect, it, vi } from 'vitest'

// The live store's reads, with Sleeper answered by hand so a read can be held open.
const pending: ((v: unknown) => void)[] = []
const held = () => new Promise((r) => pending.push(r))
vi.mock('../sleeper', () => ({
  getLiveMatchups: vi.fn(() => held()),
  getLiveSchedule: vi.fn(() => Promise.resolve([])),
  getWeekActuals: vi.fn(() => Promise.resolve({ pts: {}, lines: {} })),
}))

const { getLiveMatchups } = await import('../sleeper')
const { liveKey, recordEnds, refreshLiveWeek, stickySettled } = await import('../../../components/fantasy/useLiveWeek')

const args = { leagueId: 'L', season: '2026', week: 8, scoring: {}, sleeper: true, settled: false }
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('live store', () => {
  beforeEach(() => {
    pending.length = 0
    vi.mocked(getLiveMatchups).mockClear()
  })
  it('queues a forced read asked for while one is out, and runs it when that one lands', async () => {
    refreshLiveWeek({ ...args, leagueId: 'Q' }, true)
    refreshLiveWeek({ ...args, leagueId: 'Q' }, true) // a Reload mid-read
    refreshLiveWeek({ ...args, leagueId: 'Q' }, false) // a plain poll mid-read: dropped, the gap covers it
    expect(getLiveMatchups).toHaveBeenCalledTimes(1)
    pending.shift()!([])
    await flush()
    await flush()
    expect(getLiveMatchups).toHaveBeenCalledTimes(2)
    pending.shift()!([])
    await flush()
    await flush()
    expect(getLiveMatchups).toHaveBeenCalledTimes(2)
  })
  it('keeps each game’s earliest end and a settled week settled', () => {
    const key = liveKey('S', '2026', 8)
    expect(recordEnds(key, { 'MIN@DET': 200 })).toEqual({ 'MIN@DET': 200 })
    expect(recordEnds(key, { 'MIN@DET': 300, 'KC@DEN': 100 })).toEqual({ 'MIN@DET': 200, 'KC@DEN': 100 })
    expect(stickySettled(key, false)).toBe(false)
    expect(stickySettled(key, true)).toBe(true)
    // A later reading that cannot tell (the feed has stopped) does not undo it.
    expect(stickySettled(key, false)).toBe(true)
  })
})
