const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/**
 * A player's name reduced to what two sources agree on: lower case, no
 * accents, no punctuation (hyphens join: "Amon-Ra" is "amonra"), no
 * generational suffix. "Kenneth Walker III" and "Kenneth Walker" meet at
 * "kenneth walker". Used wherever an outside list (FantasyPros, ESPN) is
 * matched onto Sleeper's players.
 */
export const normName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`-]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX.has(w))
    .join(' ')
