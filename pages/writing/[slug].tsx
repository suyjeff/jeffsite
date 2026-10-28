import React from "react";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Link from "next/link";
import { MDXRemote, MDXRemoteSerializeResult } from "next-mdx-remote";
import { serialize } from "next-mdx-remote/serialize";
import Layout from "../../components/Layout";

type Props = {
  title: string;
  content: MDXRemoteSerializeResult;
};

const components = {
  hr: () => <hr className="border-stone-200 dark:border-stone-800" />,
};

const WritingPiecePage = ({ title, content }: Props) => {
  return (
    <Layout title={title}>
      <div className="pb-24 md:pb-0">
        <div className="flex items-center">
          <Link href="/writing" className="group">
            <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic text-stone-900 dark:text-stone-100 opacity-0 animate-reveal hover:cursor-pointer">
              <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">{title}</span>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
              >
                Back
              </span>
            </h1>
          </Link>
        </div>
        <div className="mt-4 opacity-0 animate-reveal animation-delay-200">
          <div className="space-y-4 text-lg tracking-tight">
            <MDXRemote {...content} components={components} />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default WritingPiecePage;

const writingDirectory = path.join(process.cwd(), "writing");

export async function getStaticPaths() {
  const paths = fs
    .readdirSync(writingDirectory)
    .filter((filename) => filename.endsWith(".md"))
    .map((filename) => ({ params: { slug: filename.replace(/\.md$/, "") } }));

  return { paths, fallback: false };
}

export async function getStaticProps({ params }: { params: { slug: string } }) {
  const source = fs.readFileSync(path.join(writingDirectory, `${params.slug}.md`), "utf8");
  const { data, content } = matter(source);
  const mdxSource = await serialize(content, { mdxOptions: { format: "md" } });

  return { props: { title: data.title as string, content: mdxSource } };
}
