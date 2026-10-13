# @commitmates/web

The Next.js App Router application: marketing pages, day-one tools, the members area, admin, and the API routes.

## Layout

- `src/app` — routes (CLAUDE.md §4.1)
- `src/server` — server-only code: actions, guards, rate limiting
- `src/components/<domain>` — app compositions; the design system lives in `@commitmates/ui`
- `src/copy/<domain>.ts` — every user-facing string
- `src/lib` — client-safe helpers

## Import boundaries

May import every internal package.
