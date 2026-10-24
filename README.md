# KingPost Connect

Desktop application for structural engineers to view, review and coordinate structural models and drawings.

- Open IFC models from any authoring tool; navigate by storey, type and system; section, measure, search, save views.
- Review work element by element: BCF issues with viewpoints, a design-status pipeline (modelled → analysed → designed → checked → approved), 3D markups.
- Compare model revisions and see exactly which members, sections and properties changed.
- Overlay structural analysis models (SAF, IFC structural view, ETABS/SAP2000 exports) on the physical model and report mismatches.
- Link PDF drawing sheets to model elements and compare drawing revisions.

Local-first: a project is a folder on disk; all data stays in it.

## Status

**Internal alpha (v0.1.0-alpha).** Projects, IFC import with revisions, a viewer with
element picking, model tree, property inspector, section planes and plan views, colour by
property, measuring and saved views. Review, comparison, analysis overlay and drawings
are the next phases. See [CHANGELOG.md](CHANGELOG.md), the devlogs in
[docs/devlog/](docs/devlog/) and the roadmap in [docs/PLAN.md](docs/PLAN.md).

## Getting started

Windows: run `scripts/setup-windows.ps1` once (installs Rust and the C++ build tools), then

```bash
pnpm install
pnpm tauri dev
```

Everything a developer needs — commands, repository layout, conventions — is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Technology

Tauri 2 (Rust) · React + TypeScript · three.js with `web-ifc` · SQLite.
Reasoning in [docs/adr/](docs/adr/).

## Repository conventions

This repository is the record of how the program is built, for the developers who come after.

- `docs/PLAN.md` — the roadmap, architecture and domain model.
- `docs/adr/` — architecture decision records: context, decision, alternatives, consequences.
- `docs/devlog/` — one page per milestone: what was built, what was measured, what is next.
- `CHANGELOG.md` — changes per release.
- History is pushed at milestones (tagged `vX.Y.Z`), with commits curated per feature and written as Conventional Commits.

## Licence

Proprietary. See [LICENSE](LICENSE).
