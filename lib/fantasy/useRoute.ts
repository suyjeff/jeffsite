import { useCallback, useEffect, useState } from 'react'

/**
 * Section and sub-tab live in the URL hash (#trades/suggested), so the back
 * button walks through them, a link opens the same view, and a static export
 * needs no server routing.
 */
export type Route<S extends string> = { section: S; sub: string | null }

const parse = <S extends string>(hash: string, sections: readonly S[], fallback: S): Route<S> => {
  const [section, sub] = hash.replace(/^#\/?/, '').split('/')
  return sections.includes(section as S) ? { section: section as S, sub: sub || null } : { section: fallback, sub: null }
}

export const useRoute = <S extends string>(sections: readonly S[], fallback: S) => {
  const [route, setRoute] = useState<Route<S>>({ section: fallback, sub: null })

  useEffect(() => {
    const read = () => setRoute(parse(window.location.hash, sections, fallback))
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((section: S, sub?: string | null) => {
    const next = sub ? `#${section}/${sub}` : `#${section}`
    if (window.location.hash !== next) window.location.hash = next
    else setRoute({ section, sub: sub ?? null })
  }, [])

  /** Change the sub-tab without adding a history entry for every click. */
  const setSub = useCallback(
    (sub: string) => {
      const next = `#${route.section}/${sub}`
      window.history.replaceState(null, '', next)
      setRoute({ section: route.section, sub })
    },
    [route.section],
  )

  return { ...route, go, setSub }
}
