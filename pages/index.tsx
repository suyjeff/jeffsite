import React from 'react'
import Layout from '../components/Layout'

const PROJECT_URL =
  'https://www.figma.com/proto/TYr8ADxHB3LtvKdrt7RWW8/Portfolio-Decks?node-id=1-32831&t=aNRhBcWeTdYQkwbe-1&scaling=min-zoom&content-caling=fixed&page-id=0%3A1'

export default function Home() {
  return (
    <Layout title="Jeff Su">
      <h1 className="text-lg tracking-tight font-lars font-medium italic text-stone-900 opacity-0 animate-fade-in">Jeff Su</h1>
      <p className="mt-4 text-lg tracking-tight font-lars text-stone-900 opacity-0 animate-fade-in animation-delay-200">Currently, a designer shaping the developer experience at MongoDB Atlas in New York. Focused on craft and execution above everything.</p>
      
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
              <a
                href={PROJECT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="relative inline-block rounded-md cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#4183c4]"
              >
                <span className="relative z-10 underline text-current">Project</span>
                <span
                  aria-hidden="true"
                  className="absolute -inset-x-1 -inset-y-0.5 bg-stone-200 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in"
                ></span>
              </a>
              <p className="tracking-tight">MongoDB, 2025</p>
            </li>
          </ul>
        </div>
      </div>

    </Layout>
  )
}
