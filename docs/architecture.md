# Production Sauna Configurator — Modular Architecture

Status: first model (Zirbe 6-Eck). The legacy demo (`app/client/sauna/**`, `/api/shares`,
`/api/quotes`, `public/assets/**`) is untouched; no production file imports it.

## 1. Repository inspection

| Area | Found | Production decision |
|---|---|---|
| Frontend | React 19 + Vite 7, JS, Tailwind 3, no router (path switch in `app/client/main.jsx`) | New lazy chunk at `/studio`, TypeScript (Vite compiles `.ts/.tsx`; `tsc --noEmit` checks) |
| 3D | three 0.186, imperative | React Three Fiber 9 + Drei 10 (React 19 compatible) |
| State | local React state | Zustand store |
| Validation | none | Zod schemas in a shared package (browser + server) |
| Backend | Express 5, `node:sqlite`, `createApp()` | New router `/api/studio/*` in the same process and DB file |
| Tests | `node --test`, Playwright | reused (Node 24 strips TS types natively) |
| Deploy | Docker node:24 + Caddy | unchanged; modules are static files |

Adapted layout (the brief's target tree, without moving unrelated code):

```
packages/configuration-core/        shared by browser + server
  models/zirbe-6eck.ts              product definition: ranges, options, prices, sources, assumptions
  modules/registry.ts               module catalog (id, category, assetUrl, version, attachment points, compatibleModels)
  geometry/footprint.ts             hexagon footprint + segment/anchor calculation (pure math)
  schema.ts · validator.ts · pricing.ts · dependencies.ts
app/client/studio/                  production frontend
  components/{viewer,configurator,options}/
  features/sauna/{assembly,geometry,materials}/
  store/configurationStore.ts · services/saunaApi.ts
app/server/studio-api/              routes · controllers · services · database
blender/production/zirbe-6eck/
  modules/<category>/<module>.blend one editable source per module
  scripts/build_modules.py          regenerates every module .blend + .glb headlessly
  textures/                         real photo textures (from make_textures.py)
blender/shared/scripts/             module-authoring helpers reused by all models
public/modules/<category>/<module>-<version>.glb     web assets, immutable per version
public/textures/production/<material>/…              material library (loaded on demand)
```

## 2. Module boundaries (decided from the references)

The six sides are **not** identical: 4 solid walls of different lengths, 3 glass runs, one
of them diagonal and carrying the door. Everything whose shape is a direct function of the
width/depth is **procedural**; everything with fixed real-world detail is a **Blender
module**, loaded only when the configuration needs it.

| Logical module | Kind | Why |
|---|---|---|
| Footprint, floor slab, ceiling, roof cap, fascia | procedural | outline = f(width, depth) |
| Wall segments (left, back, top, control) — Zirbe core + inner boards | procedural | length/angle per segment |
| Glass runs (right, diagonal fixed pane, return) + head/foot profiles | procedural | length per segment; door opening cut from the diagonal |
| Bench tops, skirts, backrests | procedural runs of Blender profile modules | length = f(footprint); cross-section fixed |
| `slate-panel` | Blender, instanced | real 400 × 570 riven slate tile, tiled over solid exteriors |
| `glass-door` | Blender | 670 × 1875 frameless leaf + handle + hinges; attaches at hinge axis |
| `bench-slat`, `backrest-rail`, `skirt-slat`, `bench-support` | Blender profile modules | stretched only along their extrusion axis (no distortion) or instanced |
| `lower-bench` | Blender | movable bench on feet (fixed size) |
| `heater-harvia-virta`, `heater-eos-mythos` | Blender, optional | loaded only for the chosen heater set |
| `control-emostyle`, `clock`, `downlight` | Blender | fixed-size fixtures |
| `led-strip` | Blender profile | stretched along the bench lip |
| `nova-set` | Blender, optional | accessory, loaded only when selected |
| Materials: zirbe, espe, erle, slate, glass, metal, floor | material library | swapped by slot, never rebuild geometry |

### Coordinate conventions (every module)

- Units metres, glTF Y-up. Blender authors Z-up; the glTF exporter converts, so Blender
  `+X, +Z, -Y` = glTF `+X, +Y, +Z`.
- Origin = the module's primary attachment point (floor contact / hinge axis / run start).
- Profile modules are authored exactly **1.000 m** along +X; the engine sets `scale.x = L`
  (their cross-section never scales).
- Wall-mounted modules face glTF **+Z** (into the room); the engine rotates +Z onto the
  segment's inward normal.
- Material names are finish **slots** (`slot:bench_wood`, `slot:slate`, …) so the material
  library replaces them at load time and on every finish change.

## 3. Runtime assembly

```
Configuration (Zustand) ──► ConfigurationEngine
                               ├─ normalise + validate (Zod + product rules)
                               ├─ DependencyGraph: changed paths → dirty module groups
                               ├─ footprint(config) → segments, anchors, bench runs
                               └─ ModuleResolver → required module ids
                                        │
                     ModuleLoader (cache by url, load only required, dispose unused)
                                        │
                     ModuleAssembler → placements [{module|procedural, transform, slots}]
                                        │
                     <ModuleRenderer> (R3F) renders placements; only dirty groups re-render
```

Dependency graph (config path → groups rebuilt):

| change | footprint | walls/cladding | glass/door | roof/floor | benches | heater/lights | materials |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| width / depth | ● | ● | ● | ● | ● | ● (reposition) | |
| door hinge | | | ● | | | | |
| bench wood | | | | | | | ● (slot swap) |
| heater set | | | | | | ● (swap module) | |
| accessories | | | | | | ● (add/remove) | |

## 4. API (added under the existing server, demo endpoints unchanged)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/studio/saunas` | model registry summary |
| GET | `/api/studio/saunas/:modelId` | full product definition |
| GET | `/api/studio/modules?model=` | module registry, filtered by compatibility |
| POST | `/api/studio/configurations/validate` | → `{valid, issues, configuration, price}` |
| POST | `/api/studio/configurations` | validate + reprice server-side, save → `{id, editToken}` |
| GET | `/api/studio/configurations/:id` | read by unguessable id |
| PUT | `/api/studio/configurations/:id` | requires `X-Edit-Token` |
| POST | `/api/studio/quote-requests` | saved design + contact details |
| GET | `/api/studio/configurations/:id/quote.pdf` | quotation PDF (download) |
| PUT/GET | `/api/studio/configurations/:id/ar/:file` | AR model, write-once / public |

Interactive updates never hit the server. Saved prices are recomputed server-side.
Storage: SQLite `studio_configurations(id, model_id, model_version, configuration JSON,
price_chf, edit_token_hash, created_at, updated_at)`; Postgres JSONB is a drop-in later.

## 5. View in your room (AR)

The same approach as Amazon's, Shopify's and IKEA's web shops: the phone's own AR
viewer shows the exact configured sauna on the floor at true size. No custom
computer vision and no camera images leave the phone.

```
studio "View in your room"
  phone   -> snapshot link -> /studio/ar?c=<id> -> [View in your room]
                iPhone/iPad: Quick Look  (model.usdz#allowsContentScaling=0, plane-anchored)
                Android:     Scene Viewer (model.glb, mode=ar_preferred, resizable=false)
  desktop -> QR code to /studio/ar?c=<id>
```

- The browser that creates the link exports the assembled sauna once
  (`features/sauna/ar/exportArModel.ts`): door closed, lights and inner floor
  removed, footprint centred, floor at y = 0, repeated parts merged into one mesh
  per material, textures capped at 1024 px. GLB via `GLTFExporter`, USDZ via
  `USDZExporter`.
- Upload: `PUT /api/studio/configurations/:id/ar/{model.glb|model.usdz}` -
  write-once per file, size caps, magic bytes; no time limit, so older links get
  their files in a new AR format on first use. Served public (links never change);
  Scene Viewer downloads the GLB itself, so it must be a public HTTPS URL.

## 6. Transfer and compression

- gzip / brotli (quality 5) on pages, API responses and the AR models:
  GLB 3.4 MB -> 1.9 MB, USDZ 7.1 MB -> 1.8 MB, model JSON 9.4 KB -> 2.8 KB.
- Immutable caching for AR files and versioned module GLBs; `no-store` for API
  JSON; the studio chunk and the AR page are lazy-loaded.
- Snapshot links: a shared design never changes; the same design re-shared reuses
  its link, an edited one gets a new link. Link previews (title/description) are
  rendered server-side for `/studio?c=<id>`.

## 7. Quotation PDF

`GET /api/studio/configurations/:id/quote.pdf` (pdfkit + svg-to-pdfkit), sent as a
download. Page 1: letterhead, quotation no./date/validity, line items, VAT split,
terms. Page 2: technical specification and the dimensioned floor plan (the same
`floorPlanSvg` the layout engine drives). Re-priced on the server.

## 8. Product facts vs assumptions (Zirbe 6-Eck)

Confirmed (product page, floor plan, renders): six-sided plan, glass front with frameless
door ~670 × 1875, solid Zirbe walls/ceiling, slate exterior, Espe benches (Erle on
request), upper long bench 97.5 cm + upper short bench 68 cm + movable lower bench,
2 rounded backrests, EOS EmoStyle Hi control, heater sets and prices, width/depth
150–250 cm in 10 cm steps with published surcharges, base CHF 19'990 incl. 8.1 % VAT.

Assumptions (also in `models/zirbe-6eck.ts`):
- Wall 40 mm and glass 8 mm (product page) — the example drawing says 43 / 10 mm.
- Height is not published: 2020 mm (HolzSauna made-to-measure standard; consistent with
  the 1875 door + head profile + ceiling + fascia in the renders). Not adjustable.
- Plan proportions come from the example drawing (2300 × 3160, outside the 150–250 range)
  and scale with width/depth; real fixed sizes (door, 400 mm control segment, bench depths,
  wall) never scale.
- The product has no windows: the window selector says so instead of offering fake options.
