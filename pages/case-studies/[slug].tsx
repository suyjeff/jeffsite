import React from 'react'
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { MDXRemote } from 'next-mdx-remote'
import { serialize } from 'next-mdx-remote/serialize'

interface CaseStudyProps {
  frontmatter: {
    title: string
    date: string
  }
  content: any
}

export default function CaseStudy({ frontmatter, content }: CaseStudyProps) {
  return (
    <div className="prose lg:prose-xl mx-auto">
      <h1>{frontmatter.title}</h1>
      <p>{frontmatter.date}</p>
      <MDXRemote {...content} />
    </div>
  )
}

export async function getStaticPaths() {
  const caseStudiesDirectory = path.join(process.cwd(), 'case-studies')
  const filenames = fs.readdirSync(caseStudiesDirectory)

  const paths = filenames.map((filename) => ({
    params: { slug: filename.replace('.md', '') },
  }))

  return {
    paths,
    fallback: false,
  }
}

export async function getStaticProps({ params }: { params: { slug: string } }) {
  const caseStudiesDirectory = path.join(process.cwd(), 'case-studies')
  const filePath = path.join(caseStudiesDirectory, `${params.slug}.md`)
  const fileContents = fs.readFileSync(filePath, 'utf8')

  const { data, content } = matter(fileContents)
  const mdxSource = await serialize(content)

  return {
    props: {
      frontmatter: data,
      content: mdxSource,
    },
  }
}