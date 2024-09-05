import React from 'react'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="prose lg:prose-xl mx-auto">
      <h1>Welcome to My Portfolio</h1>
      <p>
        I'm a passionate developer with experience in web development and design.
        Check out my case studies to see some of my recent work.
      </p>
      <Link href="/case-studies" className="text-blue-600 hover:underline">
        View Case Studies
      </Link>
    </div>
  )
}