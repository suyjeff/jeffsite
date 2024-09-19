import Head from 'next/head'
import Link from 'next/link'
import React from 'react'


interface LayoutProps {
  children: React.ReactNode
  title?: string
}

export default function Layout({ children, title = 'Portfolio' }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>{title}</title>
        <link rel="icon" href="/favicon.ico" />
        <link rel="preload" href="/fonts/Lars-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/Lars-Medium.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/Lars-MediumItalic.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/Lars-BoldItalic.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/Lars-Light.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </Head>

      {/* <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link href="/" className="flex-shrink-0 flex items-center">
                Your Name
              </Link>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <Link href="/" className="text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-gray-300">
                  Home
                </Link>
                <Link href="/case-studies" className="text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-gray-300">
                  Case Studies
                </Link>
              </div>
            </div>
          </div>
        </div>
      </nav> */}

      <main className="max-w-xl mx-auto pt-16 text-left">
        {children}
      </main>

      {/* <footer className="bg-white">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
          <p className="text-center text-gray-500">© 2023 Your Name. All rights reserved.</p>
        </div>
      </footer> */}
      
    </div>
  )
}