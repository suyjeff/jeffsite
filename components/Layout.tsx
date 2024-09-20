import React, { ReactNode } from 'react'
import Head from 'next/head'
import Link from 'next/link'

type Props = {
  children?: ReactNode
  title?: string
}

const Layout = ({ children, title = 'This is the default title' }: Props) => (
  <div className="flex flex-col min-h-screen bg-gray-100">
    <Head>
      <title>{title}</title>
      <meta charSet="utf-8" />
      <meta name="viewport" content="initial-scale=1.0, width=device-width" />
    </Head>
    
    <main className="max-w-xl mx-auto pt-24 text-left min-h-screen flex flex-col w-full px-4">
      <div className="flex-grow">
        {children}
      </div>

      <footer className="w-full bg-gray-100 border-t border-gray-200 mt-auto">
        <div className="max-w-xl mx-auto py-4 flex justify-between items-center">
          <div className="space-x-4">
            <Link href="/about" className="text-gray-600 hover:text-gray-900 transition-colors duration-300 ease-in-out">About</Link>
            <Link href="/resume" className="text-gray-600 hover:text-gray-900 transition-colors duration-300 ease-in-out">Resume</Link>
          </div>
          <div className="text-sm text-gray-400">
            Last updated September 2024
          </div>
        </div>
      </footer>
    </main>
  </div>
)

export default Layout