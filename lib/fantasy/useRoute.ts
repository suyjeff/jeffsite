import { useCallback, useEffect, useState } from 'react'

/**
 * Section and sub-tab live in the URL hash (#trades/suggested), so the back
 * button walks through them, a link opens the same view, and a static export
 * needs no server routing.
 */
export type Route<S extends string> = { section: S; sub: string | null }

const parse = <S extends string>(hash: string, sections: readonly S[], fallback: S, aliases: Record<string, string> = {}): Route<S> => {
  const raw = hash.replace(/^#\/?/, '')
  // An old link to a section that moved lands where it went.
  const head = raw.split('/')[0]
  const [section, sub] = (Object.hasOwn(aliases, head) ? aliases[head] : raw).split('/')
  return sections.includes(section as S) ? { section: section as S, sub: sub || null } : { section: fallback, sub: null }
}

export const useRoute = <S extends string>(sections: readonly S[], fallback: S, aliases?: Record<string, string>) => {
  const [route, setRoute] = useState<Route<S>>({ section: fallback, sub: null })

  useEffect(() => {
    const read = () => setRoute(parse(window.location.hash, sections, fallback, aliases))
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Navigate; `replace` swaps the current history entry instead of adding one (for redirects). */
  const go = useCallback((section: S, sub?: string | null, opts?: { replace?: boolean }) => {
    const next = sub ? `#${section}/${sub}` : `#${section}`
    if (opts?.replace) {
      window.history.replaceState(window.history.state, '', next)
      setRoute({ section, sub: sub ?? null })
    } else if (window.location.hash !== next) window.location.hash = next
    else setRoute({ section, sub: sub ?? null })
  }, [])

  /**
   * Change the sub-tab. On phones each page is a screen of its own, so Back steps through them; on wide screens
   * the tabs are a strip and a click does not add a history entry. Back and Forward come back through hashchange.
   */
  const setSub = useCallback(
    (sub: string) => {
      const next = `#${route.section}/${sub}`
      // Keep the existing state: Next's router ignores popstate entries without its own.
      if (window.matchMedia('(max-width: 767px)').matches && window.location.hash !== next) window.history.pushState(window.history.state, '', next)
      else window.history.replaceState(window.history.state, '', next)
      setRoute({ section: route.section, sub })
    },
    [route.section],
  )

  return { ...route, go, setSub }
}
