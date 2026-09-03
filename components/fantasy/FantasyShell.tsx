import React, { type ReactNode } from 'react'
import Head from 'next/head'
import Link from 'next/link'

const FantasyShell = ({ children, title = 'Fantasy' }: { children: ReactNode; title?: string }) => (
  <div className="flex flex-col min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
    <Head>
      <title>{title}</title>
      <meta charSet="utf-8" />
      <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      <meta name="robots" content="noindex" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    </Head>
    <main className="max-w-6xl mx-auto pt-12 pb-16 w-full px-4 flex-grow">
      <div className="flex items-center justify-between mb-6">
        <Link href="/lab" className="group">
          <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic">
            <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">Fantasy</span>
            <span aria-hidden="true" className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none">
              Back
            </span>
          </h1>
        </Link>
      </div>
      {children}
    </main>
  </div>
)

export default FantasyShell
