import React, { useEffect, useRef, useState } from 'react'
import { getUser, SleeperError } from '../../lib/fantasy/sleeper'
import { Brand, FantasyHead } from './Shell'
import { DIAGRAMS } from './TourDiagrams'
import { Button, cx } from './ui'

/**
 * First visit only: ask who you are on Sleeper, check the name exists, then
 * hand it back. Remembering it is simply what happens next (no box to tick, no
 * notice about it); switching users or starting over lives in the profile menu.
 */
const Onboarding = ({ initial, onDone, onCancel }: { initial: string; onDone: (username: string) => void; onCancel?: () => void }) => {
  const [name, setName] = useState(initial)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; msg: string }>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  // The field is disabled while checking, which drops focus; give it back on an error so a typo is one tap from fixed.
  useEffect(() => {
    if (state.kind === 'error') input.current?.focus()
  }, [state.kind])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const u = name.trim()
    if (!u) return setState({ kind: 'error', msg: 'Enter a username.' })
    setState({ kind: 'checking' })
    try {
      const user = await getUser(u)
      if (!user?.user_id) return setState({ kind: 'error', msg: `No Sleeper user named “${u}”. Usernames are not display names; find yours under Settings › Account in the Sleeper app.` })
      onDone(user.username ?? u)
    } catch (err) {
      if (err instanceof SleeperError && err.status === 404) return setState({ kind: 'error', msg: `No Sleeper user named “${u}”.` })
      if (err instanceof SleeperError) return setState({ kind: 'error', msg: `Sleeper isn't answering right now (${err.status}). Try again in a minute.` })
      setState({ kind: 'error', msg: 'Could not reach Sleeper. Check your connection and try again.' })
    }
  }

  const checking = state.kind === 'checking'
  return (
    <div className="ff ff-canvas flex min-h-svh flex-col bg-ff-bg text-ff-text antialiased">
      <FantasyHead title="Fantasy · connect Sleeper" />
      <header className="flex h-11 items-center justify-between border-b border-ff-line bg-ff-panel px-3">
        <Brand />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ff-muted">setup</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[12vh] sm:items-center sm:pt-0">
        <form onSubmit={submit} className="w-full max-w-[440px] border border-ff-line bg-ff-panel">
          <div className="flex h-8 items-center gap-2 border-b border-ff-line px-3">
            <span className="num text-[10px] text-ff-muted">01</span>
            <span className="ff-label text-ff-text2">connect sleeper</span>
          </div>
          {/* What happens next, drawn: your Sleeper league into one model, out to every page. */}
          <div className="border-b border-ff-line bg-ff-sunken/60 px-2 py-1">
            <DIAGRAMS.welcome />
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <div>
              <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">What&apos;s your Sleeper username?</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ff-text2">Your leagues load straight from Sleeper. No password, no sign-up.</p>
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
            <div id="onboard-msg" aria-live="polite" className="min-h-[18px] font-mono text-[11.5px] leading-snug">
              {state.kind === 'error' && <span className="text-ff-neg">! {state.msg}</span>}
              {checking && <span className="ff-caret text-ff-muted">looking up {name.trim()}</span>}
            </div>
            <Button type="submit" variant="primary" className="h-11 w-full text-[14px]" disabled={checking || !name.trim()}>
              {checking ? 'Checking…' : 'Load my leagues'}
            </Button>
            {onCancel && (
              <button type="button" onClick={onCancel} className="w-full py-1 font-mono text-[11px] text-ff-muted hover:text-ff-text">
                keep @{initial}
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}

export default Onboarding
