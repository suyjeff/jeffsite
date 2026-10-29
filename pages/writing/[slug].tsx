import React from "react";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { MDXRemote, MDXRemoteSerializeResult } from "next-mdx-remote";
import { serialize } from "next-mdx-remote/serialize";
import Layout from "../../components/Layout";
import BackTitle from "../../components/BackTitle";

type Props = {
  title: string;
  date: string;
  content: MDXRemoteSerializeResult;
};

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const components = {
  hr: () => <hr className="border-stone-200 dark:border-stone-800" />,
};

const WritingPiecePage = ({ title, date, content }: Props) => {
  return (
    <Layout title={title}>
      <div className="pb-10">
        <BackTitle href="/writing">{title}</BackTitle>
        <p className="mt-1 text-lg tracking-tight font-lars-slant font-normal italic text-stone-400 dark:text-stone-400 opacity-0 animate-reveal animation-delay-200">
          {formatDate(date)}
        </p>
        <div className="mt-4 opacity-0 animate-reveal animation-delay-400">
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

  return { props: { title: data.title as string, date: data.date as string, content: mdxSource } };
}
