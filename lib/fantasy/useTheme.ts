import { useEffect, useState } from 'react'
import { resolveMode, themeBg, themeById, themeVars, type Mode, type Scheme } from './themes'

/**
 * Applies a theme to every `.ff` root: one injected stylesheet, `html .ff { … }`, which outranks
 * the defaults in fantasy.css (`.ff`) and their dark-mode media query, so the onboarding screen,
 * the loader and the app all follow without passing anything down. Follows the system's light or
 * dark setting live when the theme has both and the scheme is "system".
 */
export const useTheme = (id: string | null | undefined, scheme: Scheme): Mode => {
  const [systemDark, setSystemDark] = useState(false)
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
    const vars = themeVars(theme, mode)
    const css = `html .ff{${Object.entries(vars)
      .map(([k, v]) => (k === 'colorScheme' ? `color-scheme:${v}` : `${k}:${v}`))
      .join(';')}}`
    let el = document.getElementById('ff-theme') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'ff-theme'
      document.head.appendChild(el)
    }
    el.textContent = css
    // The browser chrome (address bar, overscroll) takes the page colour.
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = themeBg(theme, mode)
  }, [theme, mode])
  useEffect(() => () => document.getElementById('ff-theme')?.remove(), [])
  return mode
}
