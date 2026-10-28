import React, { ReactNode } from "react";

// The hover pill the blue links get (see about.tsx), in stone, for links that aren't blue.
// Give the link `neutralLinkClasses` and wrap its text in <NeutralLinkLabel>.
export const neutralLinkClasses = "relative inline-block rounded-md group";

// text-decoration can't animate, so the underline is a real one on an invisible copy of the text stacked over
// the label in the same grid cell: same font and line box, so the same thickness, offset, ink-skipping and
// wrapping as any other underline. Clipping the copy from the right on hover pulls the underline back along
// the text.
const underlineClasses =
  "[grid-area:1/1] select-none pointer-events-none text-transparent underline decoration-stone-400 dark:decoration-stone-500 [clip-path:inset(0)] group-hover:[clip-path:inset(0_100%_0_0)] transition-[clip-path] duration-200 ease-out";

type Props = {
  children: ReactNode;
  underline?: boolean;
};

export const NeutralLinkLabel = ({ children, underline = false }: Props) => (
  <>
    {underline ? (
      <span className="relative z-10 grid">
        <span className="[grid-area:1/1]">{children}</span>
        <span aria-hidden="true" className={underlineClasses}>
          {children}
        </span>
      </span>
    ) : (
      <span className="relative z-10">{children}</span>
    )}
    <span
      aria-hidden="true"
      className="absolute -inset-x-1 -inset-y-0.5 bg-stone-200 dark:bg-stone-800/50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-out"
    ></span>
  </>
);
