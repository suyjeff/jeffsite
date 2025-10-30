import React, { useEffect, useRef, useState } from 'react'
import Layout from '../components/Layout'

const PROJECT_URL =
  'https://www.figma.com/proto/TYr8ADxHB3LtvKdrt7RWW8/Portfolio-Decks?node-id=1-32831&t=aNRhBcWeTdYQkwbe-1&scaling=min-zoom&content-caling=fixed&page-id=0%3A1'

export default function Home() {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOverlayOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOverlayOpen])

  const handleProjectClick = () => {
    if (passwordInputRef.current) {
      passwordInputRef.current.value = ''
    }
    setErrorMessage('')
    setIsOverlayOpen(true)
  }

  const handleCloseOverlay = () => {
    setIsOverlayOpen(false)
    if (passwordInputRef.current) {
      passwordInputRef.current.value = ''
    }
    setErrorMessage('')
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const password = passwordInputRef.current?.value ?? ''

    if (!password.trim()) {
      setErrorMessage('Password is required.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const response = await fetch('/api/verify-project-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (response.ok) {
        handleCloseOverlay()
        window.location.href = PROJECT_URL
        return
      }

      if (response.status === 401) {
        setErrorMessage('Incorrect password. Please try again.')
        return
      }

      setErrorMessage('Unable to verify password right now. Please try again later.')
    } catch (error) {
      setErrorMessage('Unable to verify password right now. Please try again later.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Layout title="Jeff Su">
      <h1 className="text-lg tracking-tight font-lars font-medium italic text-labels opacity-0 animate-fade-in">Jeff Su</h1>
      <p className="mt-4 text-lg tracking-tight font-lars text-copy opacity-0 animate-fade-in animation-delay-200">Currently, a designer shaping the developer experience at MongoDB Atlas in New York. Focused on craft and execution above everything.</p>
      
      <div className="mt-8 grid grid-cols-2 gap-4">
        
        <div className="opacity-0 animate-fade-in animation-delay-400">
          <h2 className="text-lg tracking-tight font-bold mb-4">Previously</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            {[
              { company: 'MongoDB', position: 'Product Design Intern' },
              { company: 'Andalusia Labs', position: 'Product Designer' },
              { company: 'Salesforce', position: 'UX Design Intern' },
            ].map((job, index) => (
              <li key={index} className={`opacity-0 animate-fade-in animation-delay-${600 + index * 200}`}>
                <p className="underline inline-block rounded">{job.company}</p>
                <p>{job.position}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="opacity-0 animate-fade-in animation-delay-400">
          <h2 className="text-lg tracking-tight font-bold mb-4">Read</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            <li className="opacity-0 animate-fade-in animation-delay-600">
              <button
                type="button"
                onClick={handleProjectClick}
                className="relative inline-block rounded-md cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#4183c4]"
              >
                <span className="relative z-10 text-[#4183c4]">Project</span>
                <span
                  aria-hidden="true"
                  className="absolute -inset-x-1 -inset-y-0.5 bg-[#dbeaf8] rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in"
                ></span>
              </button>
              <p className="mt-1 text-sm text-gray-600">MongoDB, 2025</p>
            </li>
          </ul>
        </div>
      </div>

      {isOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
            <button
              type="button"
              onClick={handleCloseOverlay}
              className="absolute right-4 top-4 text-sm text-gray-400 transition-colors duration-200 ease-in-out hover:text-gray-600 focus:outline-none"
              aria-label="Close password prompt"
            >
              X
            </button>
            <h3 className="text-lg font-bold tracking-tight">Protected Project</h3>
            <p className="mt-2 text-sm text-gray-500">Enter the password to view this project.</p>
            <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label htmlFor="project-password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="project-password"
                  type="password"
                  autoFocus
                  ref={passwordInputRef}
                  className="w-full border-b border-gray-300 bg-transparent px-0 py-3 text-base tracking-tight focus:border-[#4183c4] focus:outline-none focus:ring-0"
                  placeholder="Enter password"
                />
              </div>
              {errorMessage && <p className="text-sm text-red-500">{errorMessage}</p>}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-md bg-[#4183c4] px-4 py-2 text-sm font-medium text-white transition-colors duration-200 ease-in-out hover:bg-[#346ca1] disabled:opacity-60"
                >
                  {isSubmitting ? 'Verifying...' : 'View project'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseOverlay}
                  className="text-sm text-gray-600 transition-colors duration-200 ease-in-out hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </Layout>
  )
}
