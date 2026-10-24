# Devlog — Productisation (v1.0.0)

Date: 2026-10-24
Phase: 7 of the roadmap in `docs/PLAN.md` (productisation)

## What was built

**Updates on request.** The Tauri updater is wired to the latest published GitHub Release
(`latest.json`), with the artifacts signed by a key kept outside the repository (ADR 009,
`docs/release-process.md`). A check runs only from "Check for updates" or when the user
turns on the start-up check in Settings; an update installs only after "Install and
restart". The status bar shows an available version.

**Licence keys, offline.** `crates/kp-licence` verifies `KPC1.<payload>.<signature>` keys
(Ed25519) against an embedded public key; the issuing tool is an example target. Keys are
installed from Settings and stored in the user's application data folder. Without a key
the application is an evaluation copy with every feature; the status bar says so.

**Diagnostics without telemetry.** Interface log lines go to `.kingpost/logs/<date>.log`
of the open project (ten files kept). Settings writes a zip bundle with the logs, the
project manifest, the schema version and application details to a path the user picks.

**Geometry cache.** After a revision is loaded once, its merged meshes are written to
`.kingpost/cache/<sha256>.geom`; the next load reads that instead of running web-ifc.

**Onboarding and help.** A welcome screen with recent projects when nothing is open; a
getting-started checklist in the Explorer that ticks itself off (import, load, review,
compare) until dismissed; a Settings dialog (`Ctrl+,`); a Help dialog (`F1`) whose
shortcut list is read from the command definitions; a user guide in `docs/user-guide.md`.

**Localisation scaffold.** `t()` with an English dictionary, used by the new screens;
other languages are a JSON file and one registration away.

## Measurements (debug build, 22.5 MB Revit export)

| Step | Result |
|---|---|
| Load a revision through web-ifc (earlier measurement) | about 1.4 s |
| Load the same revision from the geometry cache | 705–758 ms, 13.7 MB cache file |
| Licence install, bad key refusal, removal | all correct; a valid key reports 433 days left |
| Update check with no published release | fails cleanly with a logged message, nothing downloaded |

## Problems met

- pdf.js-style lazy loading applied to the updater and process plugins too, so the
  plugins are not part of the start-up bundle and the test environment never sees them.
- The dev session opens the sample project through an environment variable, which does
  not go through the folder picker, so the recent-projects list stays empty there; a
  project opened from the welcome screen is remembered.
- `cargo test` binaries are blocked at random by this machine's application-control
  policy; a rebuild under another profile runs them. The Linux check in CI is unaffected.

## Not done, and why

- Authenticode signing of the installers needs a certificate the client has to buy; the
  workflow step is documented in `docs/release-process.md`.
- A demo video and a hosted documentation site are outside the repository; the user guide
  is the text they would be made from.
- An accessibility pass went as far as labelled controls, keyboard reach through the
  command palette and dialogs that close on Escape; a screen-reader review of the 3D
  viewport and the sheet viewer remains.
