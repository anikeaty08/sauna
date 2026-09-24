# Sauna Studio — 3D Sauna Configurator

An interactive, web-based 3D sauna configurator. Customers pick a starting design, then customize every part of it — dimensions, wood, entry type, benches, heater, control unit, lighting and accessories — and see the result rebuild live in 3D, with a running Swiss-franc price, in the browser. Built on real pricing and specifications gathered from [holzsauna.ch](https://www.holzsauna.ch).

```
Preset picker → live 3D customizer → share link / PDF quote / request a quote
```

---

## Quick start (Docker)

The whole app — frontend, backend API, database — runs as one container with no other dependencies.

```bash
docker compose up -d --build
# → http://localhost:3001
```

That's it. The image is self-contained: the catalog, product photos and 3D models are committed to the repo (`public/assets/`), so building the container never needs Blender, Python, or the `blender/`/`output/` pipeline to be present. Quote requests and shared-design links persist in a named Docker volume (`sauna-data`) via SQLite.

## Deploying with HTTPS

`docker-compose.prod.yml` is a complete production stack: the app (not exposed
to the host) behind Caddy, which obtains and renews a Let's Encrypt certificate
automatically. Use it *instead of* `docker-compose.yml`, not alongside it.

```bash
# On the server, from the repo root:
export SITE_ADDRESS=sauna-studio.89-117-57-40.sslip.io   # or your own domain
export ACME_EMAIL=you@example.com                        # cert expiry notices

docker compose -f docker-compose.prod.yml up -d --build
```

`SITE_ADDRESS` defaults to an [sslip.io](https://sslip.io) name, which resolves
`<anything>.<ip>.sslip.io` to that IP with no registrar and no purchased domain,
so TLS works before a domain is bought. Point `SITE_ADDRESS` at a real hostname
later and restart — nothing else changes.

**Before running on a shared host**, check that nothing else already owns the
web ports, or the Caddy container will fail to bind:

```bash
sudo ss -lptn 'sport = :80 or sport = :443'
```

If another project on the box already runs a reverse proxy, leave this stack's
Caddy out and point the existing proxy at the app container instead. The stack
uses an explicitly named network (`sauna-net`) and its own volumes so it cannot
join or disturb another project's default network.

Requirements: ports 80 and 443 reachable from the internet (Let's Encrypt
validates over them), and `SITE_ADDRESS` resolving to the server. Certificates
live in the `caddy-data` volume — keep it, or re-issuing counts against Let's
Encrypt rate limits.

## Local development (without Docker)

```bash
npm install
npm run dev      # Vite dev server (5173) + Express API (3001), proxied together
```

```bash
npm run build     # production build → dist/
npm start         # serve dist/ + the API from a single Node process (port 3001)
npm test          # Playwright end-to-end test: full configurator + customer journey
```

---

## What the configurator covers

**21 product families** across 4 shapes — indoor cabins (Espoo, Fichte, Espe, Erle, Zirbe, Bergzauber and regional variants Heinola/Rauma/Kemi/Mikkeli), barrel saunas, garden sauna houses, and infrared cabins — each with its own real size/price table, door and window specification.

**Structural options**: width/depth/height, board orientation, entry type (front, corner, glass front, corner-glass, glass corner), door hinge/position/glass tint/handle finish, window type, exterior cladding (natural wood, slate, reclaimed spruce, thermo-pine), insulation and roof-shingle colour (garden houses).

**Interior**: bench wood and layout (straight/L/U), bench depth & height sliders, backrests, under-bench cladding, floor grating, headrests, sliding lower bench.

**Climate**: 22 heaters (electric + wood-fired, with chimney kits), 5 ready-made heater+control bundles, 7 control units, an infrared-emitter add-on, and heater sizing guidance (kW recommendation from volume + glazed area, plus the electrical-supply note your electrician needs).

**Lighting & accessories**: wall lamp, LED strips (backrest/under-bench), sauna sets, salt evaporator, audio, ergonomic backrest, foot mat, floating bench, plunge tub, and more — every one priced.

**Customer journey**: hover any part for its name and price; click a part in the 3D view to open just its options; live itemised total; a room-fit check (does it fit your space, door swing included?); undo/redo (buttons or Ctrl+Z/Ctrl+Y); a real browser Back button; a short shareable link (`/?d=…`, server-backed, falls back to a self-contained encoded link if the API is unreachable); a one-click PDF quote (line items + a generated 2D floor plan, via the browser's print dialog); a "Request a quote" form that stores the enquiry server-side; and a downloadable `.glb` of the original Blender-authored preset models.

---

## Architecture

```
app/client/          the entire frontend (React + Three.js) — Customizer, geometry
                      builder, pricing, panel UI, catalog/config helpers
app/client/style.css  shared design tokens (colours, type) the frontend builds on
app/server/           Express API — quote requests, shared-design links, health
public/assets/        the app's real static assets, committed to the repo:
  data/                 catalog.json + presets.json (source of truth for pricing)
  images/presets/       product photos for the preset picker
  models/presets/       Blender-exported .glb downloads for each preset
```

The **3D model is built entirely in the browser**, not loaded from a fixed file: `app/client/sauna/geometry.js` reads the same `catalog.json` and generates the cabin/barrel/heater/benches/etc. geometry from whatever configuration the customer has chosen, so every one of the thousands of possible combinations renders instantly with no server round-trip. `app/client/sauna/pricing.js` prices that same configuration from the same catalog, so the total always matches what's on screen.

### Backend

Express (`app/server/app.js`) serves the built frontend and a small API:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness check |
| `POST /api/shares` / `GET /api/shares/:id` | create/resolve a short shareable design link |
| `POST /api/quotes` / `GET /api/quotes/:id` | submit/retrieve a quote request |

State lives in SQLite (`data/sauna.sqlite`, gitignored — a fresh one is created on first run; in Docker it's in the `sauna-data` volume).

### The Blender pipeline (separate, optional)

`blender/` holds a completely independent, offline asset-authoring pipeline: `blender/sauna_configurator.py` is a parametric Blender generator driven by the *same* `blender/catalog.json`, used to render product photos and export the downloadable `.glb` files that are committed to `public/assets/models/presets/`. `blender/build_presets.py` regenerates all presets at once. This pipeline is never invoked by the running web app or its Docker build — it's a developer tool for producing new preset artwork/models, run manually with Blender installed. See [`blender/README.md`](blender/README.md) for the full workflow. Its own working files (renders, packaged `.blend`s) are written to `output/blender/`, which is gitignored and outside the deployable app.

---

## Repository layout

```
app/client/      frontend source (React + Three.js)
app/server/      Express API
public/          static assets (public/assets/) and fonts — the Docker build's only input besides app/client/
scripts/         local dev launcher (npm run dev)
tests/           Playwright end-to-end test
blender/         offline Blender asset-authoring pipeline (optional, not part of the deployed app)
docs/            reference material (the original client quotation)
Dockerfile, docker-compose.yml, .dockerignore   container build
docker-compose.prod.yml, Caddyfile              production stack with automatic HTTPS
```

---

## Data & pricing sources

Prices, dimensions and options are transcribed from the public [holzsauna.ch](https://www.holzsauna.ch) catalog (Sauna nach Mass, Finn-Serie, Sentiotec, Infraworld, Harvia, Saunafass, Saunahaus, Infrarotkabine, Saunaofen, Saunasteuerung, Zubehör) plus the client's own Espoo quotation (`docs/`), as of 2026-09-22 — see `catalog.meta.sources` in `public/assets/data/catalog.json`. These are **indicative** prices for a working pilot, not a live price feed; confirm current pricing with Holzbau Boscheri GmbH before quoting a customer. Heater/accessory dimensions marked `approx` in the catalog are typical manufacturer sizes, not verified drawings.
