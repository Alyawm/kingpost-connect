# 001 — Desktop stack: Tauri, React, three.js, SQLite

Status: Accepted
Date: 2026-10-24

## Context

KingPost Connect is a desktop application first, with a web version a likely later phase.
It must render large IFC models, run offline, install small, and be maintainable by
developers who join after the first release. The reference product in this space ships a
WPF shell with a web module embedded through WebView2, which shows that even a native
desktop team ended up building data-heavy interface in web technology.

## Options

**.NET 8 with WPF or Avalonia.** Mature on Windows, familiar to engineering-software teams,
good native 3D through DirectX wrappers. Costs: a separate web stack later for the web
version, a large runtime to ship, and a smaller pool of developers for the 3D side.

**Electron with React and three.js.** The largest hiring pool and the best-known tooling.
Costs: a 150+ MB installer carrying a full Chromium, high idle memory, and a Node process
as the only place to put heavy backend work.

**Tauri 2 with React and three.js.** Same interface stack as Electron, but the shell is a
Rust binary using the operating system's web view (WebView2 on Windows, part of Windows
10/11). Installer around 10 MB; backend work in Rust with real threads and native SQLite.
Costs: two languages in the repository, and WebGL rather than a native graphics API for 3D.

## Decision

Tauri 2 shell, React with TypeScript for the interface, three.js with That Open Engine
(`web-ifc`) for IFC geometry, SQLite through `rusqlite` for project data, Rust crates for
everything that is not interface.

## Consequences

- One interface codebase serves the desktop now and the web later; Rust crates stay
  reusable behind a future server.
- Developers need both the Node and Rust toolchains; `scripts/setup-windows.ps1` and
  `CONTRIBUTING.md` make that a ten-minute job.
- 3D performance on very large models depends on WebGL and WASM. That risk is measured
  in the Phase 1 spike before the geometry cache is designed (see ADR 003).
- The build produces NSIS and MSI installers on Windows; macOS and Linux builds come from
  the same source when wanted.
