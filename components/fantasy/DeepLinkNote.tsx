import React, { useEffect } from 'react'
import { Crown } from './RevealBanner'

/** A short, friendly line for a shared link that could not be followed all the way; it goes by itself after a while. */
const DeepLinkNote = ({ text, onDismiss }: { text: string; onDismiss: () => void }) => {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 12000)
    return () => window.clearTimeout(id)
  }, [text, onDismiss])
  return (
    <div className="ff pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-[80] flex justify-center px-3 md:bottom-5">
      <div role="status" className="ff-fade-in pointer-events-auto flex max-w-[460px] items-start gap-2.5 border border-ff-line2 bg-ff-panel py-2.5 pl-3 pr-1.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)]">
        <span className="mt-0.5">
          <Crown size={16} outline />
        </span>
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-ff-text2">{text}</p>
        <button type="button" onClick={onDismiss} className="h-8 shrink-0 px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ff-muted hover:bg-ff-raised hover:text-ff-text max-md:h-10">
          Got it
        </button>
      </div>
    </div>
  )
}

export default DeepLinkNote
