// One lock on the page's scroll, shared by everything that covers it (the phone drawer, detail sheets, the power-rank
// reveal). Each holder takes a lock and gets its release back; the page scrolls again once the last one lets go. Saving
// and restoring body.style.overflow per overlay goes wrong when they overlap: one opened from inside another saves the
// first one's "hidden" and puts it back after both have closed, leaving the page stuck.

let holders = 0
let saved = ''

/** Hold the page still. Returns the release, which is safe to call more than once. */
export const lockScroll = () => {
  if (typeof document === 'undefined') return () => {}
  if (holders++ === 0) {
    saved = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holders === 0) document.body.style.overflow = saved
  }
}
