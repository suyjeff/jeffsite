import React, { ReactNode } from "react";

// The hover pill the blue links get (see about.tsx), in stone, for links that aren't blue.
// Give the link `neutralLinkClasses` and wrap its text in <NeutralLinkLabel>.
export const neutralLinkClasses = "relative inline-block rounded-md group";

export const NeutralLinkLabel = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <>
    <span className={`relative z-10 ${className}`}>{children}</span>
    <span
      aria-hidden="true"
      className="absolute -inset-x-1 -inset-y-0.5 bg-stone-200 dark:bg-stone-800/50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-out"
    ></span>
  </>
);
