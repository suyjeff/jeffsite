import React from "react";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Link from "next/link";
import Layout from "../../components/Layout";
import BackTitle from "../../components/BackTitle";
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
        <BackTitle href="/">Writing</BackTitle>
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
                <NeutralLinkLabel underline>
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
