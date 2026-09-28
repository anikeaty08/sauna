# Zirbe 6-Eck — Blender modules

The sauna is **not** one Blender model. It is assembled at runtime from
independent modules plus procedural structure (see `docs/architecture.md`).

## Build

```bash
# every module: .blend source + GLB web asset
blender -b --factory-startup --python blender/production/zirbe-6eck/scripts/build_modules.py
# one module
blender -b --factory-startup --python blender/production/zirbe-6eck/scripts/build_modules.py -- heater-eos-mythos
# contact sheet of the exported GLBs (what the browser receives)
blender -b --factory-startup --python blender/production/zirbe-6eck/scripts/preview_modules.py -- output/modules.png
# real photo textures (from the HolzSauna product photo)
python blender/production/zirbe-6eck/scripts/make_textures.py
```

Outputs: `modules/<category>/<id>.blend` (editable source) and
`public/modules/<category>/<id>-<version>.glb` (immutable web asset). Bump
`VERSION` in `build_modules.py` **and** `packages/configuration-core/modules/registry.ts`
together; old versions stay on disk for saved configurations.

## Conventions (checked by `module_kit.validate` before export)

- Metres; Blender Z-up, exported Y-up: Blender `+X, +Z, -Y` → glTF `+X, +Y, +Z`.
- Root empty named after the module id, at the origin = the `base` attachment point.
- Front/visible face towards glTF `+Z`.
- Profiles are exactly 1.000 m along their length axis; the runtime scales only that axis.
- Every material is a finish slot (`slot:slate`, `slot:bench_wood`, …); the runtime
  material library replaces them, so a finish looks identical on every module.

## Modules

| id | kind | origin / attachment |
|---|---|---|
| slate-panel | instanced | bottom-left corner on the wall face; 400 × 570 × 12 mm real slate |
| glass-profile | profile x | glass centre line at floor; aluminium U-channel |
| glass-door | placed | hinge axis at floor; leaf +X; stainless handle outside (+Z), wood inside |
| bench-slat · bench-bearer · backrest-rail | profile x | run start; top of slat at y = 0 / rail back on the wall |
| skirt-slat | profile y | floor; under-bench cladding |
| heater-harvia-virta · heater-harvia-virta-combi · heater-eos-mythos | placed, optional | floor centre, front +Z; loaded only for the chosen set |
| control-eos-emostyle | placed | wall contact centre (outside, beside the door) |
| downlight | placed | ceiling surface |
| led-strip | profile x, optional | under the upper-bench lip |
| nova-bucket-set · climate-station | placed, optional | floor centre / wall contact |

## Procedural (runtime, not Blender)

Walls, glass panes, slate fascia, roof, ceiling and floor are generated from the
footprint in `features/sauna/geometry/structureGenerator.ts`, because their shape
is a direct function of width and depth.
