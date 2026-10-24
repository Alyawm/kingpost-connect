# Sample corpus

Models used for development, measurement and tests. Files larger than a few hundred
kilobytes are **not committed** (see `.gitignore`); they are attached to the matching
GitHub Release and downloaded into this folder by hand.

## Public models

All from the `web-ifc` test corpus (`ThatOpen/engine_web-ifc`, `tests/ifcfiles/public/`),
which is itself a mirror of buildingSMART and KIT sample files.

| File | Size | Schema | Use |
|---|---|---|---|
| `public/IfcOpenHouse_IFC4.ifc` | 110 KB | IFC4 | Smoke test for the viewer and IFC lab |
| `public/duplex.ifc` | 2.3 MB | IFC2x3 | Small building with storeys and property sets |
| `public/AC20-FZK-Haus.ifc` | 2.5 MB | IFC4 | KIT reference house, exported from ArchiCAD |

Download with `scripts/fetch-samples.ps1`.

## Project models (not public)

Real structural models supplied for this project go under `samples/private/` (an
`Example Files/` folder at the repository root is ignored as well) and are never committed
or attached to releases. Expected set for the Phase 1 spike:

- one steel-framed building (IFC4 preferred)
- one reinforced-concrete building with reinforcement
- one mixed or large model (200 MB+) for the performance budget
- one analysis export (SAF `.xlsx` or ETABS `.e2k`) matching one of the above
- one PDF drawing set matching one of the above

## Measurements

Record spike results in `docs/devlog/` with: file, size, schema, products, triangles,
parse ms, geometry ms, total ms, JS heap MB, machine (CPU, RAM, GPU).
