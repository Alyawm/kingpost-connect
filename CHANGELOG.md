# Changelog

All notable changes to KingPost Connect. The format follows Keep a Changelog; versions
follow semantic versioning. Milestone tags match the headings below.

## [0.0.1] — 2026-10-24 — Foundation

First buildable state of the repository; nothing here is a product feature yet.

### Added
- Tauri 2 desktop shell with a React interface: activity rail, side panel, 3D workspace,
  properties inspector, output panel, status bar, command palette (Ctrl+K) and keyboard
  shortcuts. Dark and light themes.
- 3D viewport on three.js with on-demand rendering, orbit/pan/zoom, click selection and a
  sample steel portal frame.
- IFC load bench (Lab section) using web-ifc: parses a file, merges geometry by colour and
  reports timings, triangle counts and heap use. A measurement tool for the Phase 1 spike.
- Project folders: create or open any folder as a project; the shell writes a manifest and a
  SQLite database under `.kingpost/`. Rust crates `kp-project` and `kp-store` with the full
  initial schema (migration 001) and tests.
- Repository tooling: pnpm + Cargo workspaces, TypeScript strict mode, ESLint, Prettier,
  Vitest, clippy and rustfmt, a `pnpm check` gate, and a GitHub Actions workflow that builds
  Windows installers into a draft release when a `v*` tag is pushed.
- Documentation: roadmap (`docs/PLAN.md`), decision records 001–003, developer guide
  (`CONTRIBUTING.md`), third-party notices, sample corpus notes and fetch script, Windows
  toolchain setup script.
