# AGENTS.md

## Cursor Cloud specific instructions

This is a Next.js 14 portfolio website (static export) using React 18, TypeScript, and Tailwind CSS. There are no databases, Docker containers, or external services.

### Running the app

- **Dev server:** `npm run dev` (port 3000)
- **Build:** `npm run build` (static export to `./out`)
- **Type check:** `npx tsc --noEmit`

There is no ESLint configuration or test framework in this project. TypeScript type-checking (`npx tsc --noEmit`) is the primary code quality check.

### Key notes

- The project uses `output: 'export'` in `next.config.mjs` for static site generation (GitHub Pages deployment).
- Case studies are written as Markdown files in `case-studies/` and rendered via `next-mdx-remote`.
- Custom fonts (Lars family) are expected in `public/fonts/` but the TTF files are not committed to the repo; the site falls back to `sans-serif`.
- `.env.local` contains `PROJECT_PASSWORD=ddog` (currently unused in source code).
