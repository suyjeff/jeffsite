// How the app writes a probability. Percents are only ever whole numbers, and nothing reads 100% or 0% unless it is
// certain: a share strictly between 0 and 1 never rounds to a certainty (99.6% reads ">99%", 0.3% reads "<1%").

/** A share as a whole percent. Only an exact 1 or 0 reads 100% or 0%. */
export const share = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '–'
  const r = Math.round(n * 100)
  if (n > 0 && n < 1) {
    if (r >= 100) return '>99%'
    if (r <= 0) return '<1%'
  }
  return `${r}%`
}

/**
 * A simulated or forecast probability, as a whole percent. Even an exact 1 or 0 from the arithmetic reads ">99%" or
 * "<1%": 100% and 0% appear only when `settled` says the outcome is decided (clinched, eliminated).
 */
export const chance = (p: number | null | undefined, settled?: 'in' | 'out' | null) => {
  if (p === null || p === undefined || Number.isNaN(p)) return '–'
  if (settled === 'in') return '100%'
  if (settled === 'out') return '0%'
  const r = Math.round(p * 100)
  if (r >= 100) return '>99%'
  if (r <= 0) return '<1%'
  return `${r}%`
}
