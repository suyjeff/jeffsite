import React, { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { getUser } from '../../lib/fantasy/sleeper'
import { Button, cx } from './ui'

/**
 * First visit only: ask who you are on Sleeper, check the name exists, then
 * hand it back. The page remembers it, so this never shows again unless you
 * switch users.
 */
const Onboarding = ({ initial, onDone, onCancel }: { initial: string; onDone: (username: string) => void; onCancel?: () => void }) => {
  const [name, setName] = useState(initial)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; msg: string }>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

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
      const msg = err instanceof Error ? err.message : String(err)
      setState({ kind: 'error', msg: /fetch|network/i.test(msg) ? 'Could not reach Sleeper. Check your connection and try again.' : msg })
    }
  }

  const checking = state.kind === 'checking'
  return (
    <div className="ff ff-canvas flex min-h-screen flex-col bg-ff-bg text-ff-text antialiased">
      <Head>
        <title>Fantasy · connect Sleeper</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
      </Head>
      <header className="flex h-11 items-center justify-between border-b border-ff-line bg-ff-panel px-3">
        <Link href="/lab" className="group flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-ff-muted group-hover:text-ff-text">‹ LAB</span>
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Fantasy</span>
          <span className="font-mono text-[10px] text-ff-muted">/term</span>
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ff-muted">setup</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[12vh] sm:items-center sm:pt-0">
        <form onSubmit={submit} className="w-full max-w-[440px] border border-ff-line bg-ff-panel">
          <div className="flex h-8 items-center gap-2 border-b border-ff-line px-3">
            <span className="num text-[10px] text-ff-muted/70">01</span>
            <span className="ff-label text-ff-text2">connect sleeper</span>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <div>
              <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em]">What&apos;s your Sleeper username?</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ff-text2">Your leagues, rosters and projections load from Sleeper&apos;s public API. No password, no account here.</p>
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
          <div className="border-t border-ff-line px-4 py-2.5 font-mono text-[10.5px] leading-relaxed text-ff-muted sm:px-5">Saved in this browser, so you only do this once. Switch users any time from the menu.</div>
        </form>
      </main>
    </div>
  )
}

export default Onboarding
