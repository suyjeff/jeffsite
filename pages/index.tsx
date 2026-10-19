import React from 'react'
import Layout from '../components/Layout'
import StickerHeader from '../components/StickerHeader'

export default function Home() {
  return (
    <Layout title="Jeff Su">
      <StickerHeader />
      <p className="mt-4 text-lg tracking-tight font-lars text-stone-900 dark:text-stone-100 opacity-0 animate-reveal animation-delay-200">Currently, a designer on Datadog's Integrations Experience team in New York.</p>

      <div className="mt-8 grid grid-cols-2 gap-4">

        <div className="opacity-0 animate-reveal animation-delay-400">
          <h2 className="text-lg tracking-tight font-bold mb-4">Previously</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            {[
              { company: 'MongoDB', position: '2022-2025 · Product Designer' },
              { company: 'Andalusia Labs', position: '2022 · Product Designer' },
              { company: 'MongoDB', position: '2021 · Product Design Intern' },
              { company: 'Salesforce', position: '2020 · UX Design Intern' },
            ].map((job, index) => (
              <li key={index}>
                <p className="underline inline-block rounded decoration-stone-400 dark:decoration-stone-500">{job.company}</p>
                <p className="text-lg text-stone-400 dark:text-stone-400">{job.position}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="opacity-0 animate-reveal animation-delay-600">
          <h2 className="text-lg tracking-tight font-bold mb-4">Read</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            <li>
              <a href="https://www.figma.com/proto/TYr8ADxHB3LtvKdrt7RWW8?node-id=37-11813&locale=en" className="relative inline-block rounded-md underline decoration-stone-400 dark:decoration-stone-500 text-stone-900 dark:text-stone-100">Custom Roles</a>
              <p className="text-lg text-stone-400 dark:text-stone-400 tracking-tight">2025 · MongoDB</p>
            </li>
            <li>
              <a href="https://www.figma.com/proto/TYr8ADxHB3LtvKdrt7RWW8?node-id=1-32831&locale=en" className="relative inline-block rounded-md underline decoration-stone-400 dark:decoration-stone-500 text-stone-900 dark:text-stone-100">Atlas SQL Schemas</a>
              <p className="text-lg text-stone-400 dark:text-stone-400 tracking-tight">2025 · MongoDB</p>
            </li>
          </ul>
        </div>
      </div>

    </Layout>
  )
}
