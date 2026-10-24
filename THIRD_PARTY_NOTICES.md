# Third-party notices

KingPost Connect is built with the open-source components below. Each is used under its own
licence; full texts ship with the packages in `node_modules/` and `~/.cargo/registry/`.
Add a row when introducing a new dependency.

## Runtime

| Component | Licence | Role |
|---|---|---|
| Tauri (`tauri`, `tauri-build`, `tauri-plugin-dialog`, `@tauri-apps/api`) | MIT / Apache-2.0 | Desktop shell |
| React, React DOM | MIT | Interface |
| three.js | MIT | 3D rendering |
| web-ifc | MPL-2.0 | IFC parsing and geometry |
| Zustand | MIT | Interface state |
| cmdk | MIT | Command palette |
| Radix UI (`@radix-ui/react-tooltip`) | MIT | Accessible primitives |
| lucide-react | ISC | Icons |
| clsx | MIT | Class name helper |
| Tailwind CSS | MIT | Styling |
| rusqlite (bundled SQLite) | MIT (SQLite: public domain) | Project database |
| serde, serde_json | MIT / Apache-2.0 | Serialisation |
| thiserror | MIT / Apache-2.0 | Error types |
| time | MIT / Apache-2.0 | Timestamps |
| uuid | MIT / Apache-2.0 | Identifiers |
| sha2 | MIT / Apache-2.0 | File digests for revisions |
| base64 | MIT / Apache-2.0 | View thumbnails over IPC |
| notify | CC0-1.0 / Artistic-2.0 | Project folder watcher |
| quick-xml | MIT | BCF XML reading and writing |
| zip | MIT | BCF archives |
| calamine | MIT | Reading SAF workbooks (.xlsx) |
| pdf.js (`pdfjs-dist`) | Apache-2.0 | Rendering and reading PDF drawing sheets |
| tauri-plugin-updater, tauri-plugin-process (`@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`) | MIT / Apache-2.0 | Updates on request and restart after install |
| ed25519-dalek, rand_core | BSD-3-Clause / MIT / Apache-2.0 | Licence key signatures |
| rust_xlsxwriter | MIT / Apache-2.0 | Schedule export to XLSX |
| TanStack Virtual (`@tanstack/react-virtual`) | MIT | Virtualised schedule grid |

## Development only

| Component | Licence |
|---|---|
| Vite, Vitest | MIT |
| TypeScript | Apache-2.0 |
| ESLint, typescript-eslint | MIT |
| Prettier | MIT |
| Testing Library | MIT |
| jsdom | MIT |
| tempfile (Rust) | MIT / Apache-2.0 |
