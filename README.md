# KingPost Connect

Desktop application for structural engineers to view, review and coordinate structural models and drawings.

- Open IFC models from any authoring tool; navigate by storey, type and system; section, measure, search, save views.
- Review work element by element: BCF issues with viewpoints, a design-status pipeline (modelled → analysed → designed → checked → approved), 3D markups.
- Compare model revisions and see exactly which members, sections and properties changed.
- Overlay structural analysis models (SAF, IFC structural view, ETABS/SAP2000 exports) on the physical model and report mismatches.
- Link PDF drawing sheets to model elements and compare drawing revisions.

Local-first: a project is a folder on disk; all data stays in it.

## Status

Planning complete; implementation starts with the foundation milestone. See [docs/PLAN.md](docs/PLAN.md) for the full roadmap, architecture, domain model and acceptance criteria per phase.

## Technology

Tauri 2 (Rust) · React + TypeScript · three.js with That Open Engine (`web-ifc`) · SQLite. Details and reasoning in `docs/PLAN.md` §3 and, from the foundation milestone onwards, in `docs/adr/`.

## Repository conventions

This repository is the record of how the program is built, for the developers who come after.

- `docs/PLAN.md` — the roadmap and architecture.
- `docs/adr/` — architecture decision records: context, decision, alternatives, consequences.
- `docs/devlog/` — one page per milestone: what was built, what was measured, what is next.
- `CHANGELOG.md` — user-facing changes per release.
- History is pushed at milestones (tagged `vX.Y.Z`), with commits curated per feature and written as Conventional Commits.

## Licence

Proprietary. See [LICENSE](LICENSE).
