import React, { ReactNode } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'

type Props = {
  children?: ReactNode
  title?: string
}

const Layout = ({ children, title = 'This is the default title' }: Props) => {
  const router = useRouter()
  const isAboutPage = router.pathname === '/about'
  const aboutLinkHref = isAboutPage ? '/' : '/about'
  const aboutLinkLabel = isAboutPage ? 'Home' : 'About'
  const navLinkClasses = 'text-gray-600 hover:text-gray-900 transition-colors duration-300 ease-in-out'

  return (
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
              <Link href={aboutLinkHref} className={navLinkClasses}>
                {aboutLinkLabel}
              </Link>
              <a
                href="/SuJeffResume_oct2025.pdf"
                className={navLinkClasses}
                target="_blank"
                rel="noopener noreferrer"
              >
                Resume
              </a>
            </div>
            <div className="text-sm text-gray-400">
              Last updated October 2025
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}

export default Layout
