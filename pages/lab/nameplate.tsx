import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Layout from '../../components/Layout'
import NameplateDesigner from '../../components/labs/nameplate/NameplateDesigner'
import NameplateBoard from '../../components/labs/nameplate/NameplateBoard'
import { NameplateData } from '../../components/labs/nameplate/types'
import { fetchNameplates, createNameplate, hasSubmitted } from '../../components/labs/nameplate/api'


type View = 'editor' | 'board'

export default function NameplatePage() {
  const [view, setView] = useState<View>('editor')
  const [plates, setPlates] = useState<NameplateData[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (hasSubmitted()) {
      setSubmitted(true)
      setView('board')
    }
    fetchNameplates().then(setPlates)
  }, [])

  const handleSubmit = useCallback(
    async (plate: Omit<NameplateData, 'id' | 'createdAt' | 'visitorToken'>) => {
      setSubmitting(true)
      setError(null)
      const result = await createNameplate(plate)
      setSubmitting(false)

      if (result.ok && result.plate) {
        setPlates(prev => [...prev, result.plate!])
        setSubmitted(true)
        setView('board')
      } else {
        setError(result.error ?? 'Something went wrong.')
        if (result.error?.includes('already')) {
          setSubmitted(true)
          setView('board')
        }
      }
    },
    [],
  )

  return (
    <Layout title="Nameplate Creator — Lab">
      <div className="pb-24 md:pb-0">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/lab" className="group">
            <h1 className="relative inline-block text-lg tracking-tight font-medium italic text-stone-900 dark:text-stone-100 opacity-0 animate-reveal hover:cursor-pointer">
              <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">
                Nameplate Creator
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
              >
                ← Labs
              </span>
            </h1>
          </Link>
        </div>

        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400 opacity-0 animate-reveal animation-delay-100">
          Create your custom nameplate and pin it to the board. One per visitor!
        </p>

        {/* Tab toggle */}
        <div className="mt-4 flex gap-2 opacity-0 animate-reveal animation-delay-200">
          <button
            type="button"
            className={`y2k-btn text-xs ${view === 'editor' ? '' : 'opacity-60'}`}
            onClick={() => setView('editor')}
          >
            Creator
          </button>
          <button
            type="button"
            className={`y2k-btn text-xs ${view === 'board' ? '' : 'opacity-60'}`}
            onClick={() => setView('board')}
          >
            Board ({plates.length})
          </button>
        </div>

        {error && (
          <div className="mt-3 text-sm text-red-500 dark:text-red-400 y2k-panel p-3">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="mt-4 opacity-0 animate-reveal animation-delay-300">
          {view === 'editor' ? (
            <NameplateDesigner
              onSubmit={handleSubmit}
              submitting={submitting}
              alreadySubmitted={submitted}
            />
          ) : (
            <NameplateBoard plates={plates} />
          )}
        </div>
      </div>
    </Layout>
  )
}
