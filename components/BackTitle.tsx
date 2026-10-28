import React, { ReactNode } from "react";
import Link from "next/link";

type Props = {
  href: string;
  children: ReactNode;
};

// A page's title, which is also its way back. Hovering swaps the title for "Back" and slides an arrow out from
// behind it into the left margin. The arrow lives in a clipped strip hung off the title's left edge, so it
// emerges from the title itself and never takes up room in the layout (styles in globals.css).
const BackTitle = ({ href, children }: Props) => (
  <div className="flex items-center">
    <Link href={href} className="group back-title relative">
      <span className="back-arrow-clip" aria-hidden="true">
        <span className="back-arrow">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M7 3L2 8L7 13M2 8H14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
      <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic text-stone-900 dark:text-stone-100 opacity-0 animate-reveal hover:cursor-pointer">
        <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">{children}</span>
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
        >
          Back
        </span>
      </h1>
    </Link>
  </div>
);

export default BackTitle;
