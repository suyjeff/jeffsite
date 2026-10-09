import { useEffect, useState } from 'react'
import { resolveMode, themeById, themeVars, tokensFor, type Mode, type Scheme } from './themes'

/**
 * Applies a theme to every `.ff` root: one injected stylesheet, `html .ff { … }`, which outranks
 * the defaults in fantasy.css (`.ff`) and their dark-mode media query, so the onboarding screen,
 * the loader and the app all follow without passing anything down. Follows the system's light or
 * dark setting live when the theme has both and the scheme is "system". Until `ready` (saved
 * preferences read), nothing is injected and the stylesheet defaults hold, so a dark system or a
 * saved theme never flashes the default light theme first.
 */
export const useTheme = (id: string | null | undefined, scheme: Scheme, ready = true): Mode => {
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme = themeById(id)
  const mode = resolveMode(theme, scheme, systemDark)
  useEffect(() => {
    if (!ready) return
    const vars = themeVars(theme, mode)
    const css = `html .ff{${Object.entries(vars)
      .map(([k, v]) => (k === 'colorScheme' ? `color-scheme:${v}` : `${k}:${v}`))
      .join(';')}}`
    let el = document.getElementById('ff-theme') as HTMLStyleElement | null
    const swap = !!el && el.textContent !== css
    if (!el) {
      el = document.createElement('style')
      el.id = 'ff-theme'
      document.head.appendChild(el)
    }
    // Swapping themes would fire every colour transition at once and smear; hold them off for the swap.
    const hold = swap ? document.createElement('style') : null
    if (hold) {
      hold.textContent = '.ff *,.ff *::before,.ff *::after{transition:none!important}'
      document.head.appendChild(hold)
    }
    el.textContent = css
    if (hold) {
      void document.body.offsetHeight
      requestAnimationFrame(() => hold.remove())
    }
    // The browser chrome (status bar, address bar) takes the colour of the bar it meets: the phone top bar's panel.
    // Its own tag, outside next/head, so a page title changing never puts back a stale colour; first in the head,
    // so it wins over the default pair FantasyHead sets for before the theme is known.
    let chrome = document.getElementById('ff-theme-color') as HTMLMetaElement | null
    if (!chrome) {
      chrome = document.createElement('meta')
      chrome.id = 'ff-theme-color'
      chrome.name = 'theme-color'
      document.head.prepend(chrome)
    }
    chrome.content = tokensFor(theme, mode).panel
  }, [theme, mode, ready])
  useEffect(
    () => () => {
      document.getElementById('ff-theme')?.remove()
      document.getElementById('ff-theme-color')?.remove()
    },
    [],
  )
  return mode
}
