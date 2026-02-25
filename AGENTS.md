# AGENTS.md

## Cursor Cloud specific instructions

This is a Next.js 14 static portfolio site (Pages Router) using React 18, TypeScript, Tailwind CSS, and MDX for case study content. It has no database, no backend API, and no external service dependencies.

### Key commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (port 3000) |
| Production build | `npm run build` (static export to `/out`) |
| Type check | `npx tsc --noEmit` |

### Notes

- The project uses `output: 'export'` in `next.config.mjs` for static site generation (GitHub Pages deployment). There is no SSR server.
- No ESLint config is present; use `npx tsc --noEmit` for type checking.
- Case study content lives in `/case-studies/*.md` as Markdown files with gray-matter frontmatter. They are rendered via `next-mdx-remote` in `pages/case-studies/[slug].tsx`.
- An `.env.local` file exists with `PROJECT_PASSWORD=ddog` but appears unused in source code.
