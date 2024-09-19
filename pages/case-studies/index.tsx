import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import Link from 'next/link'
import React from 'react'

interface CaseStudy {
  slug: string
  frontmatter: {
    title: string
    date: string
  }
}

interface CaseStudiesProps {
  caseStudies: CaseStudy[]
}

export default function CaseStudies({ caseStudies }: CaseStudiesProps) {
  return (
    <div className="prose lg:prose-xl mx-auto">
      <h1>Case Studies</h1>
      <ul>
        {caseStudies.map((caseStudy) => (
          <li key={caseStudy.slug}>
            <Link href={`/case-studies/${caseStudy.slug}`}>
              {caseStudy.frontmatter.title}
            </Link>
            <p>{caseStudy.frontmatter.date}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export async function getStaticProps() {
  const caseStudiesDirectory = path.join(process.cwd(), 'case-studies')
  const filenames = fs.readdirSync(caseStudiesDirectory)

  const caseStudies = filenames.map((filename) => {
    const filePath = path.join(caseStudiesDirectory, filename)
    const fileContents = fs.readFileSync(filePath, 'utf8')
    const { data } = matter(fileContents)

    return {
      slug: filename.replace('.md', ''),
      frontmatter: data,
    }
  })

  return {
    props: {
      caseStudies,
    },
  }
}