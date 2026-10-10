import React, { useEffect, useRef, useState } from 'react'
import { EspnError, ESPN_PRIVATE_HELP, espnTeamChoices, getEspnLeague, type EspnLeague } from '../../lib/fantasy/espn'
import { getState, getUser, SleeperError } from '../../lib/fantasy/sleeper'
import type { Provider } from '../../lib/fantasy/useLeagueData'
import { Brand, FantasyHead } from './Shell'
import { DIAGRAMS } from './TourDiagrams'
import { Avatar, Button, Segmented, cx } from './ui'

export type OnboardResult = { provider: 'sleeper'; username: string } | { provider: 'espn'; leagueId: string; teamId: number; season: string | null }

export type OnboardInitial = { provider: Provider; username: string; espnLeagueId: string | null; espnTeamId: number | null }

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; msg: string }

/** A pasted league address works as well as the bare number. */
const parseLeagueId = (s: string) => {
  const t = s.trim()
  return t.match(/leagueId=(\d+)/i)?.[1] ?? (/^\d+$/.test(t) ? t : null)
}

/** The season to look an ESPN league up in: Sleeper's NFL calendar, or this year if that is down. */
const nflSeason = async () => {
  try {
    const s = await getState()
    return { season: s.league_season ?? s.season, previous: s.previous_season ?? null }
  } catch {
    const y = new Date().getFullYear()
    return { season: String(y), previous: String(y - 1) }
  }
}

/**
 * First visit only: ask where the league lives and who you are in it, check it
 * exists, then hand it back. Sleeper needs a username; ESPN a league id and
 * then a pick from its teams. Remembering it is simply what happens next (no
 * box to tick, no notice about it); switching or starting over lives in the
 * profile menu.
 */
const Onboarding = ({ initial, onDone, onCancel, cancelLabel }: { initial: OnboardInitial; onDone: (r: OnboardResult) => void; onCancel?: () => void; cancelLabel?: string }) => {
  const [provider, setProvider] = useState<Provider>(initial.provider)
  const [name, setName] = useState(initial.username)
  const [leagueText, setLeagueText] = useState(initial.espnLeagueId ?? '')
  const [state, setState] = useState<Status>({ kind: 'idle' })
  // ESPN's second step: the league, found, and the team you pick in it.
  const [found, setFound] = useState<{ league: EspnLeague; season: string; asked: string } | null>(null)
  const [teamId, setTeamId] = useState<number | null>(initial.espnTeamId)
  const input = useRef<HTMLInputElement>(null)
  const teamList = useRef<HTMLDivElement>(null)
  useEffect(() => input.current?.focus(), [provider])
  // The field is disabled while checking, which drops focus; give it back on an error so a typo is one tap from fixed.
  useEffect(() => {
    if (state.kind === 'error') input.current?.focus()
  }, [state.kind])
  // Once the teams are listed, the one to pick is where focus belongs.
  useEffect(() => {
    if (found) teamList.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')?.focus({ preventScroll: true })
  }, [found])

  const switchTo = (p: Provider) => {
    setProvider(p)
    setState({ kind: 'idle' })
  }

  const submitSleeper = async () => {
    const u = name.trim().replace(/^@/, '')
    if (!u) return setState({ kind: 'error', msg: 'Enter a username.' })
    setState({ kind: 'checking' })
    try {
      const user = await getUser(u)
      // Sleeper answers an unknown name with an empty 200, not a 404.
      if (!user?.user_id) return setState({ kind: 'error', msg: `No Sleeper user named “${u}”. Use the @handle from your Sleeper profile, not your display name.` })
      onDone({ provider: 'sleeper', username: user.username ?? u })
    } catch (err) {
      if (err instanceof SleeperError && err.status === 404) return setState({ kind: 'error', msg: `No Sleeper user named “${u}”.` })
      if (err instanceof SleeperError) return setState({ kind: 'error', msg: `Sleeper isn't answering right now (${err.status}). Try again in a minute.` })
      setState({ kind: 'error', msg: 'Could not reach Sleeper. Check your connection and try again.' })
    }
  }

  const findEspn = async () => {
    const id = parseLeagueId(leagueText)
    if (!id) return setState({ kind: 'error', msg: 'Enter the league ID: the number after leagueId= in your league’s address on fantasy.espn.com.' })
    setState({ kind: 'checking' })
    const { season, previous } = await nflSeason()
    try {
      let league: EspnLeague
      let used = season
      try {
        league = await getEspnLeague(id, season)
      } catch (err) {
        // Until a league renews, ESPN only has last season's.
        if (!(err instanceof EspnError && err.kind === 'not-found') || !previous) throw err
        league = await getEspnLeague(id, previous)
        used = previous
      }
      if (!league.teams.length) return setState({ kind: 'error', msg: `ESPN league ${id} has no teams yet.` })
      setFound({ league, season: used, asked: season })
      if (!league.teams.some((t) => t.id === teamId)) setTeamId(null)
      setState({ kind: 'idle' })
    } catch (err) {
      setState({ kind: 'error', msg: err instanceof EspnError ? err.message : 'Could not reach ESPN. Check your connection and try again.' })
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (provider === 'sleeper') return void submitSleeper()
    if (!found) return void findEspn()
    if (teamId == null) return setState({ kind: 'error', msg: 'Pick your team.' })
    // A league still on last season keeps that season pinned, so the loader does not look for this one first.
    onDone({ provider: 'espn', leagueId: found.league.id, teamId, season: found.season === found.asked ? null : found.season })
  }

  const checking = state.kind === 'checking'
  const espn = provider === 'espn'
  const teams = found ? espnTeamChoices(found.league) : []
  const ready = espn ? (found ? teamId != null : !!parseLeagueId(leagueText)) : !!name.trim()
  return (
    <div className="ff ff-canvas flex min-h-svh flex-col bg-ff-bg text-ff-text antialiased">
      <FantasyHead title="Fantasy · connect your league" />
      <header className="flex h-11 items-center justify-between border-b border-ff-line bg-ff-panel px-3">
        <Brand />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ff-muted">setup</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-[8vh] sm:items-center sm:py-8">
        <form onSubmit={submit} className="w-full max-w-[440px] border border-ff-line bg-ff-panel">
          <div className="flex h-8 items-center gap-2 border-b border-ff-line px-3">
            <span className="num text-[10px] text-ff-muted">{found ? '02' : '01'}</span>
            <span className="ff-label text-ff-text2">{found ? 'pick your team' : 'connect your league'}</span>
          </div>
          {/* What happens next, drawn: your league into one model, out to every page. */}
          {!found && (
            <div className="border-b border-ff-line bg-ff-sunken/60 px-2 py-1">
              <DIAGRAMS.welcome />
            </div>
          )}
          <div className="space-y-4 p-4 sm:p-5">
            {!found && (
              <Segmented<Provider>
                block
                label="Where your league lives"
                value={provider}
                onChange={switchTo}
                options={[
                  { key: 'sleeper', label: 'Sleeper' },
                  { key: 'espn', label: 'ESPN' },
                ]}
              />
            )}

            {!espn && (
              <>
                <div>
                  <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">What&apos;s your Sleeper username?</h1>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ff-text2">
                    The @handle on your Sleeper profile (tap your avatar in the app), not your display name. Capitals don&apos;t matter. No password, no sign-up.
                  </p>
                </div>
                <label className="block">
                  <span className="ff-label mb-1.5 block">username</span>
                  <span className={cx('flex h-11 items-center border bg-ff-sunken focus-within:ring-2 focus-within:ring-ff-accent/40', state.kind === 'error' ? 'border-ff-neg/60' : 'border-ff-line')}>
                    <span className="pl-3 font-mono text-[14px] text-ff-muted">@</span>
                    <input
                      ref={input}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value)
                        if (state.kind === 'error') setState({ kind: 'idle' })
                      }}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      spellCheck={false}
                      enterKeyHint="go"
                      aria-invalid={state.kind === 'error'}
                      aria-describedby="onboard-msg"
                      disabled={checking}
                      placeholder="username"
                      className="h-full min-w-0 flex-1 bg-transparent px-1.5 font-mono text-[16px] text-ff-text outline-none placeholder:text-ff-muted/60"
                    />
                  </span>
                </label>
              </>
            )}

            {espn && !found && (
              <>
                <div>
                  <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">What&apos;s your ESPN league ID?</h1>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ff-text2">
                    Open your league on fantasy.espn.com and copy the number after <span className="font-mono text-ff-text">leagueId=</span> in the address bar. Pasting the whole address works too.
                  </p>
                </div>
                <label className="block">
                  <span className="ff-label mb-1.5 block">league id</span>
                  <span className={cx('flex h-11 items-center border bg-ff-sunken focus-within:ring-2 focus-within:ring-ff-accent/40', state.kind === 'error' ? 'border-ff-neg/60' : 'border-ff-line')}>
                    <span className="pl-3 font-mono text-[14px] text-ff-muted">#</span>
                    <input
                      ref={input}
                      value={leagueText}
                      onChange={(e) => {
                        setLeagueText(e.target.value)
                        if (state.kind === 'error') setState({ kind: 'idle' })
                      }}
                      inputMode="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      aria-invalid={state.kind === 'error'}
                      aria-describedby="onboard-msg onboard-note"
                      disabled={checking}
                      placeholder="e.g. 1234567"
                      className="h-full min-w-0 flex-1 bg-transparent px-1.5 font-mono text-[16px] text-ff-text outline-none placeholder:text-ff-muted/60"
                    />
                  </span>
                </label>
                <p id="onboard-note" className="border-l-2 border-ff-warn/60 pl-2.5 text-[12px] leading-[1.5] text-ff-text2">
                  Only leagues viewable to the public work. {ESPN_PRIVATE_HELP}
                </p>
              </>
            )}

            {espn && found && (
              <>
                <div>
                  <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">Which team is yours?</h1>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ff-text2">
                    {found.league.name} · {found.season} · {teams.length} teams
                  </p>
                </div>
                <div ref={teamList} role="radiogroup" aria-label="Your team" className="ff-scroll max-h-[44vh] overflow-y-auto border border-ff-line">
                  {teams.map((t, i) => {
                    const on = t.id === teamId
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on || (teamId == null && i === 0) ? 0 : -1}
                        onClick={() => {
                          setTeamId(t.id)
                          if (state.kind === 'error') setState({ kind: 'idle' })
                        }}
                        onKeyDown={(e) => {
                          const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                          if (!step) return
                          e.preventDefault()
                          const next = teams[(i + step + teams.length) % teams.length]
                          setTeamId(next.id)
                          ;(e.currentTarget.parentElement?.children[(i + step + teams.length) % teams.length] as HTMLElement | undefined)?.focus()
                        }}
                        className={cx(
                          'flex h-11 w-full items-center gap-2.5 border-b border-ff-line px-3 text-left last:border-b-0',
                          on ? 'bg-ff-accent/10' : 'hover:bg-ff-raised',
                        )}
                      >
                        <Avatar src={t.logo} name={t.name} size={24} />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-[13.5px] text-ff-text">{t.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-ff-muted">{t.owner}</span>
                        </span>
                        <span aria-hidden className={cx('h-3 w-3 shrink-0 border', on ? 'border-ff-accent bg-ff-accent' : 'border-ff-line2')} />
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            <div id="onboard-msg" aria-live="polite" className="min-h-[18px] font-mono text-[11.5px] leading-snug">
              {state.kind === 'error' && <span className="text-ff-neg">! {state.msg}</span>}
              {checking && <span className="ff-caret text-ff-muted">looking up {espn ? `league ${parseLeagueId(leagueText) ?? ''}` : name.trim()}</span>}
            </div>
            <Button type="submit" variant="primary" className="h-11 w-full text-[14px]" disabled={checking || !ready}>
              {checking ? 'Checking…' : !espn ? 'Load my leagues' : found ? 'Load my team' : 'Find my league'}
            </Button>
            {espn && found ? (
              <button
                type="button"
                onClick={() => {
                  setFound(null)
                  setState({ kind: 'idle' })
                }}
                className="w-full py-1 font-mono text-[11px] text-ff-muted hover:text-ff-text"
              >
                ‹ a different league
              </button>
            ) : (
              onCancel && (
                <button type="button" onClick={onCancel} className="w-full py-1 font-mono text-[11px] text-ff-muted hover:text-ff-text">
                  {cancelLabel ?? 'cancel'}
                </button>
              )
            )}
          </div>
        </form>
      </main>
    </div>
  )
}

export default Onboarding
