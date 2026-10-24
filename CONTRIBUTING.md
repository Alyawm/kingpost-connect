# Contributing to KingPost Connect

This document is for developers joining the project. It covers getting a build running,
how the repository is organised, and the conventions that keep its history readable.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | https://nodejs.org |
| pnpm | 12 (pinned in `package.json#packageManager`) | `corepack enable pnpm` |
| Rust | stable, MSVC target on Windows | https://rustup.rs |
| Visual Studio Build Tools | 2022, "Desktop development with C++" workload | Needed by the Rust MSVC toolchain and bundled SQLite |
| WebView2 runtime | any | Part of Windows 10/11 |

On Windows, run `scripts/setup-windows.ps1` from a PowerShell prompt; it installs whatever
is missing and is safe to re-run. On other platforms follow the Tauri prerequisites page for
your distribution and install Node, pnpm and Rust as above.

## Getting started

```bash
pnpm install          # JavaScript dependencies for every workspace package
pnpm tauri dev        # builds the Rust shell, starts Vite, opens the application window
```

The first `tauri dev` compiles the Rust dependencies and takes several minutes; later runs
are incremental. `pnpm dev:web` serves the interface alone in a browser at
http://localhost:1420 — useful for interface work, with backend calls returning defaults.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm check` | Everything CI runs: typecheck, lint, tests, `cargo fmt --check`, clippy, `cargo test` |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` / `pnpm format` | ESLint + Prettier (check / write), `format` also runs `cargo fmt` |
| `pnpm test` | Vitest in every package |
| `cargo test --workspace` | Rust tests |
| `pnpm tauri build` | Release build with NSIS and MSI installers under `target/release/bundle/` |

## Repository layout

```
apps/desktop/            Tauri application: src-tauri/ (Rust shell) and src/ (React interface)
packages/ui/             design tokens and shared components
packages/viewer/         three.js viewport and IFC geometry loading
crates/kp-store/         SQLite schema, migrations, queries
crates/kp-project/       project folder: manifest + database
docs/PLAN.md             roadmap, architecture, domain model, acceptance criteria
docs/adr/                architecture decision records
docs/devlog/             one page per milestone
samples/                 small test models; large ones are attached to GitHub Releases
scripts/                 developer tooling
```

Dependencies flow one way: interface → `lib/ipc.ts` → Tauri commands → crates. Crates never
know about Tauri; the interface never knows about SQLite.

## How work is recorded

The repository exists so that the next developer can understand how the program came to be.

- **Commits** follow Conventional Commits: `feat(viewer): section planes`, `fix(store): …`,
  `docs:`, `refactor:`, `perf:`, `test:`, `chore:`. The body says *why*, not just what.
  Commits carry the author's git identity and nothing else — no tool or co-author trailers.
- **Decisions** that shape the code get an ADR in `docs/adr/` (template in its README).
- **Milestones** get a devlog page in `docs/devlog/`, a `CHANGELOG.md` entry, and a tag.
- **GitHub is updated at milestones only.** Day-to-day commits stay local; before a
  milestone push the history is tidied into coherent, buildable commits per feature.
  Pushing a `v*` tag runs CI and builds the installers into a draft release.

## Code conventions

- TypeScript: strict, `noUncheckedIndexedAccess` on, type-only imports inline. Components
  are functions; state lives in small Zustand stores under `src/state/`.
- Rust: `cargo fmt` defaults with 100 columns, clippy clean with `-D warnings`, errors as
  `thiserror` enums, no `unwrap` outside tests.
- Styling: Tailwind utilities over design tokens from `packages/ui/src/tokens.css`. No
  hard-coded colours in components.
- Tests sit next to the code they test (`*.test.ts(x)`, `#[cfg(test)]`).
- Third-party additions are recorded in `THIRD_PARTY_NOTICES.md` with their licence.

## Product rules that affect code

- No network access without the user's explicit action; project data stays in the folder.
- No language-model or "AI" features, and no references to such tools anywhere in the
  repository, including commit messages and documentation.
- Nothing derived from decompiling other products. Formats come from published standards
  (IFC, BCF, SAF, PDF) and open libraries.
