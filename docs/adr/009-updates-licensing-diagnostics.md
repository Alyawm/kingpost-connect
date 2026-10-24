# 009 — Updates only on request, licences checked offline, diagnostics stay local

Status: Accepted
Date: 2026-10-24

## Context

Phase 7 makes the application shippable: it must update itself, tell a licensed copy
from an evaluation one, and give support something to work with when things go wrong.
Two product rules constrain all three: no network call without the user's consent, and
project data stays in the project folder. The client has a free GitHub account, so
GitHub Releases is the only distribution channel available at no cost.

## Options

**Updates**
1. **Tauri's updater against GitHub Releases, run only when the user asks** (or turns on
   a start-up check), with artifacts signed by a key the maintainer holds.
2. Check on every start without asking. Simpler, but a network call the user did not
   choose, against the product rule.
3. No updater; users download installers by hand. Works, but every fix depends on
   people noticing.

**Licensing**
1. **A signed key checked offline**: Ed25519 payload (licensee, seats, expiry) verified
   with a public key embedded in the application; an evaluation copy has every feature.
2. A licence server. Needs hosting, an account system and a network call on every start.
3. No licensing until the client asks. Leaves the client without a way to sell seats
   and without an expiry mechanism when one is needed.

**Diagnostics**
1. **A log file per day in the project's data folder and a zip bundle on request**
   (logs, manifest, application and system details), sent by the user however they
   choose.
2. Crash reporting to a third-party service. Telemetry the client has not approved.

## Decision

Options 1, 1 and 1.

- The updater reads `latest.json` from the latest published GitHub Release, verifies the
  minisign signature against `plugins.updater.pubkey`, and installs only after "Install
  and restart". Drafts are invisible to it, so a release can be reviewed first. The
  start-up check is a setting, off by default, with its consequence spelled out next to it.
- `crates/kp-licence` carries the verifier and the issuing tool (an example target, so it
  ships with the source but not inside the application). A key is
  `KPC1.<payload>.<signature>`; the application stores it in the user's application data
  folder and checks it on start. Without one the status bar says "Evaluation copy"; nothing
  is disabled, which is the client's call to change later by reading the status.
- Interface log lines are appended to `.kingpost/logs/<date>.log` of the open project (ten
  files kept); Settings writes a bundle zip wherever the user chooses.

Alongside: a geometry cache (`.kingpost/cache/<sha256>.geom`) of the viewer's merged
meshes, keyed by the file digest, so a revision opens without web-ifc after its first
load; a welcome screen with recent projects and a getting-started checklist; a settings
dialog; a help dialog whose shortcut list is read from the command definitions; and a
localisation scaffold (`t()` with an English dictionary) used by the new screens.

## Consequences

- Two private keys exist outside the repository (`docs/release-process.md`). Losing the
  updater key strands installed copies; losing the licence key stops issuing. Both must
  be backed up by the client.
- Installers are not Authenticode-signed until the client buys a certificate; SmartScreen
  warns on first run. The workflow needs only the documented signing step added.
- The licence check is honest, not hostile: a determined user can patch a binary. It
  keeps honest customers and expiries straight, which is what it is for.
- The geometry cache trades disk for time (roughly the mesh size, tens of megabytes for
  the sample model). "Clear cache" in Settings removes it; a changed file never matches
  its old cache because the key is the file digest.
