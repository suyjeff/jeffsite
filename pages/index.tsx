import React from 'react'
import Layout from '../components/Layout'

export default function Home() {
  return (
    <Layout title="Jeff Su">
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
                <p className="underline inline-block rounded">{job.company}</p>
                <p>{job.position}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="opacity-0 animate-fade-in animation-delay-400">
          <h2 className="text-lg tracking-tight font-bold mb-4">Read</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            {[
              { title: 'Coming Soon', company: 'MongoDB', year: 2024 }
            ].map((study, index) => (
              <li key={index} className={`opacity-0 animate-fade-in animation-delay-${600 + index * 200}`}>
                <p className="underline inline-block rounded cursor-pointer relative group">
                  <span className="relative z-10">{study.title}</span>
                  <span className="absolute -inset-x-1 -inset-y-0.5 bg-gray-200 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in"></span>
                </p>
                <p>{study.company}, {study.year}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

    </Layout>
  )
}