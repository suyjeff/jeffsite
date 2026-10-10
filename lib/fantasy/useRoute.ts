import { useCallback, useEffect, useState } from 'react'

/**
 * Section and sub-tab live in the URL hash (#trades/suggested), so the back
 * button walks through them, a link opens the same view, and a static export
 * needs no server routing. A page that nests one level deeper (a team's own
 * pages, #teams/3/results) carries it as `page`.
 */
export type Route<S extends string> = { section: S; sub: string | null; page: string | null }

const parse = <S extends string>(hash: string, sections: readonly S[], fallback: S, aliases: Record<string, string> = {}): Route<S> => {
  const raw = hash.replace(/^#\/?/, '')
  // An old link to a section that moved lands where it went.
  const head = raw.split('/')[0]
  const [section, sub, page] = (Object.hasOwn(aliases, head) ? aliases[head] : raw).split('/')
  return sections.includes(section as S) ? { section: section as S, sub: sub || null, page: sub && page ? page : null } : { section: fallback, sub: null, page: null }
}

const onPhone = () => window.matchMedia('(max-width: 767px)').matches

/**
 * Write the hash into the current history entry, or into a new one. Next's router ignores popstate entries without
 * its own state, so the existing state is kept; its `as` is the URL Next takes the entry to on Back, so it follows
 * the hash too (stale, Back would land on the page we left). A pushed entry also needs a key of its own.
 */
const writeHash = (next: string, push: boolean) => {
  const prev = window.history.state
  const state = prev && typeof prev === 'object' && 'as' in prev ? { ...prev, as: `${window.location.pathname}${window.location.search}${next}` } : prev
  if (push) window.history.pushState(state && typeof state === 'object' && 'key' in state ? { ...state, key: Math.random().toString(36).slice(2, 10) } : state, '', next)
  else window.history.replaceState(state, '', next)
}

export const useRoute = <S extends string>(sections: readonly S[], fallback: S, aliases?: Record<string, string>) => {
  const [route, setRoute] = useState<Route<S>>({ section: fallback, sub: null, page: null })

  useEffect(() => {
    const read = () => setRoute(parse(window.location.hash, sections, fallback, aliases))
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Navigate; `replace` swaps the current history entry instead of adding one (for redirects). */
  const go = useCallback((section: S, sub?: string | null, opts?: { replace?: boolean; page?: string | null }) => {
    const page = sub ? opts?.page ?? null : null
    const next = `#${section}${sub ? `/${sub}` : ''}${page ? `/${page}` : ''}`
    if (opts?.replace) {
      writeHash(next, false)
      setRoute({ section, sub: sub ?? null, page })
    } else if (window.location.hash !== next) window.location.hash = next
    else setRoute({ section, sub: sub ?? null, page })
  }, [])

  /**
   * Change the sub-tab. On phones each page is a screen of its own, so Back steps through them; on wide screens
   * the tabs are a strip and a click does not add a history entry. Back and Forward come back through hashchange.
   * `replace` never adds one: for fixing up a URL that names a page that is not there.
   */
  const setSub = useCallback(
    (sub: string, opts?: { replace?: boolean }) => {
      const next = `#${route.section}/${sub}`
      writeHash(next, !opts?.replace && onPhone() && window.location.hash !== next)
      setRoute({ section: route.section, sub, page: null })
    },
    [route.section],
  )

  /** The same for the page under a sub (a team's Roster or Results): a screen of its own on phones, a tab on wide ones. */
  const setPage = useCallback(
    (page: string, opts?: { replace?: boolean }) => {
      if (!route.sub) return
      const next = `#${route.section}/${route.sub}/${page}`
      writeHash(next, !opts?.replace && onPhone() && window.location.hash !== next)
      setRoute({ section: route.section, sub: route.sub, page })
    },
    [route.section, route.sub],
  )

  return { ...route, go, setSub, setPage }
}
