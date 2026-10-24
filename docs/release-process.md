# Release process

How a milestone becomes an installer the client can run, and what the maintainer keeps
outside the repository to make that possible.

## What a tag does

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`:

1. `check` on Linux: typecheck, lint, interface tests, `cargo fmt --check`, clippy with
   warnings denied, `cargo test --workspace`.
2. `windows-installer`: builds the NSIS and MSI installers and the updater artifacts
   (`*.nsis.zip`, `*.sig`, `latest.json`) and attaches them to a **draft** GitHub Release
   named after the tag. Nothing is published until a person reviews the draft and
   presses Publish.

Keep the version in step before tagging: `package.json`, `apps/desktop/package.json`,
`apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml` (workspace), `packages/*/package.json`
and `Cargo.lock` (run `cargo update -w --offline`). The CHANGELOG heading for the version
is the release note.

## Keys kept outside the repository

Two key pairs exist. Their private halves live on the maintainer's machine under
`~/.kingpost/keys/` and in GitHub secrets, never in git.

| Purpose | Private half | Public half |
|---|---|---|
| Updater signing (minisign, made by `pnpm tauri signer generate`) | `~/.kingpost/keys/updater.key` → GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, empty when the key has none) | `plugins.updater.pubkey` in `tauri.conf.json` |
| Licence issuing (Ed25519, made by `licence-tool keygen`) | `~/.kingpost/keys/licence.key` | `PUBLIC_KEY` in `crates/kp-licence/src/lib.rs` |

Losing the updater private key means installed copies cannot verify future updates; a
new key pair would need a fresh installation. Losing the licence private key means no new
keys can be issued for the embedded public key; rotating it invalidates issued keys.
Back both up somewhere the client controls.

## Updates

The application never contacts the release server on its own. A check runs when the
user chooses "Check for updates" (command palette, Settings) or turns on "check when the
application starts" in Settings. The check reads
`https://github.com/Alyawm/kingpost-connect/releases/latest/download/latest.json`, which
the workflow writes when `TAURI_SIGNING_PRIVATE_KEY` is set and the release is published.
An update is downloaded only when the user presses "Install and restart"; the signature
is verified against the public key in the configuration before anything is installed.

Drafts are not visible to the updater, so a milestone can be tagged, built and reviewed
without reaching installed copies until it is published.

## Licence keys

Issue a key with the tool (it is an example target, so it ships with the source and not
with the application):

```bash
cargo run -p kp-licence --example licence-tool -- issue ~/.kingpost/keys/licence.key --name "Maria Example" --org "Example Engineers" --seats 5 --expires 2027-10-24 --reference INV-1001
```

The key is a single line `KPC1.<payload>.<signature>`; the user pastes it into Settings.
Checking needs no network. Without a key the application runs as an evaluation copy with
every feature available; the status bar says so. `--expires` may be omitted for a
perpetual key. `verify <key>` checks a key against the embedded public key.

## Installer code signing

The installers are not Authenticode-signed yet, so Windows SmartScreen warns on first
run. When the client obtains a code-signing certificate, add the steps the Tauri
documentation describes for Windows signing (import the certificate in the
`windows-installer` job and set `bundle.windows.certificateThumbprint` or the
`signCommand`); the workflow needs no other change.

## Checklist for a milestone

1. Gates green locally: `pnpm check` (or its parts, see CONTRIBUTING).
2. Versions bumped, CHANGELOG entry written, devlog and plan status updated.
3. Curated commits on `main`, then `git tag -a vX.Y.Z -m "..."` and push the branch and the tag.
4. Wait for the workflow; open the draft release, check the installer runs on a clean
   Windows machine, then publish.
5. From an installed older version: Settings → Check now → Install and restart.
