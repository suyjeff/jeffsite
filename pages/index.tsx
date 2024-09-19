import React from 'react'
import Link from 'next/link'
import Layout from '../components/Layout'

export default function Home() {
  return (
    <Layout>
      <h1 className="text-lg tracking-tight font-lars font-medium italic text-labels opacity-0 animate-fade-in">Jeff Su</h1>
      <p className="mt-4 text-lg tracking-tight font-lars text-copy opacity-0 animate-fade-in animation-delay-200">Currently, a product designer at MongoDB in New York City.</p>
      
      <div className="mt-8 grid grid-cols-2 gap-4">
        <div className="opacity-0 animate-fade-in animation-delay-400">
          <h2 className="text-lg tracking-tight font-bold mb-4">Previously</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            {[
              { company: 'MongoDB', position: 'Product Design Intern' },
              { company: 'Salesforce', position: 'UX Design Intern' },
              { company: 'Welfie', position: 'Product Designer' },
              { company: 'Onfocoin', position: 'Product Designer' },
            ].map((job, index) => (
              <li key={index} className={`opacity-0 animate-fade-in animation-delay-${600 + index * 200}`}>
                <p className="underline">{job.company}</p>
                <p>{job.position}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="opacity-0 animate-fade-in animation-delay-400">
          <h2 className="text-lg tracking-tight font-bold mb-4">Read</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            {[
              { title: '...', company: 'MongoDB', year: 2022 },
              { title: '...', company: 'Salesforce', year: 2021 }
            ].map((study, index) => (
              <li key={index} className={`opacity-0 animate-fade-in animation-delay-${600 + index * 200}`}>
                <p className="underline">{study.title}</p>
                <p>{study.company}, {study.year}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Layout>
  )
}