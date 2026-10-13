# CommitMates

A university-verified network for student developers. It turns real GitHub activity into a living profile, finds you the right partner at your own university, and helps you finish things together: projects, code reviews, open-source contributions and final-year projects.

**Find a coding partner at your uni, and actually finish something together.**

## Status

Under construction. The roadmap and its progress live in [CLAUDE.md](CLAUDE.md) §16; the changelog is in §17.

## Running locally

Requirements: Node (version in `.nvmrc`), pnpm, and Docker for the local Supabase stack.

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm db:start                # local Supabase (Docker)
pnpm db:migrate
pnpm dev                     # web app + worker loop
```

Run every check before pushing:

```bash
pnpm verify
```

## Specification

[CLAUDE.md](CLAUDE.md) is the complete specification: product, rules, architecture, data model, feature specs, design system and roadmap.

## License

[MIT](LICENSE)
