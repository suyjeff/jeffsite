import React from "react";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Link from "next/link";
import Layout from "../../components/Layout";
import { neutralLinkClasses, NeutralLinkLabel } from "../../components/NeutralLink";

type Piece = {
  slug: string;
  title: string;
};

type Props = {
  pieces: Piece[];
};

const WritingPage = ({ pieces }: Props) => {
  return (
    <Layout title="Writing">
      <div className="pb-24 md:pb-0">
        <div className="flex items-center">
          <Link href="/" className="group">
            <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic text-stone-900 dark:text-stone-100 opacity-0 animate-reveal hover:cursor-pointer">
              <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">
                Writing
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
              >
                Back
              </span>
            </h1>
          </Link>
        </div>
        <ul className="mt-4 space-y-4 text-lg tracking-tight">
          {pieces.map((piece, index) => (
            <li
              key={piece.slug}
              className={`opacity-0 animate-reveal ${
                ["animation-delay-200", "animation-delay-400", "animation-delay-600", "animation-delay-800"][index] ??
                "animation-delay-800"
              }`}
            >
              <Link href={`/writing/${piece.slug}`} className={neutralLinkClasses}>
                <NeutralLinkLabel className="underline decoration-stone-400 dark:decoration-stone-500">
                  {piece.title}
                </NeutralLinkLabel>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Layout>
  );
};

export default WritingPage;

export async function getStaticProps() {
  const writingDirectory = path.join(process.cwd(), "writing");
  const filenames = fs.readdirSync(writingDirectory).filter((filename) => filename.endsWith(".md"));

  const pieces = filenames
    .map((filename) => {
      const { data } = matter(fs.readFileSync(path.join(writingDirectory, filename), "utf8"));
      return { slug: filename.replace(/\.md$/, ""), title: data.title as string };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return { props: { pieces } };
}
