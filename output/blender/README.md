# Sauna Blender Deliverable

Open `sauna-complete.blend` for the detailed Blender model. `sauna-pilot.blend` preserves the earlier model. The active scene is `Sauna Pilot`; the original startup scene is preserved separately.

The [review gallery](REVIEW.md) collects all six finished views and the current validation summary. On 9 September 2026, all six views were regenerated from the latest saved model and the finished-model checks passed again.

## Ready-to-open configurations

Each file is an editable, self-contained copy with packed timber textures, a closed door, the selected heater, both optional lights, exterior camera, and an embedded `START HERE - Sauna` text. The master remains unchanged.

- [Left hinge / integrated control](configurations/sauna-left-integrated.blend)
- [Left hinge / external control](configurations/sauna-left-external.blend)
- [Right hinge / integrated control](configurations/sauna-right-integrated.blend)
- [Right hinge / external control](configurations/sauna-right-external.blend)

All four files were reopened and checked for correct variant visibility, closed doors, complete shell, packed textures, metric units, and camera setup. See `validation-configurations.json`.

## Finished Blender Model

`sauna-complete.blend` adds clearer timber edge joints, fine wood surface relief, interior battens and perimeter trim, bench aprons and braces, flush timber plugs, a timber heater guard, handle isolators and clamp screws, heater markings, and an illuminated external controller display. The optional `Lighting - warm timber shade` collection contains an original slatted wall lamp, diffuser and warm area light.

These finishing details are visual design assumptions. The guard does not establish manufacturer heater clearances, and the controller digits are modeled display graphics. The supplied pilot PDF does not include the separate full MVP specification or its remaining approximately 15 assets.

Exterior, interior and all four variant renders are in `finished/`. The interior camera looks through the entrance; the cutaway camera shows the benches and heater with the roof and right wall hidden. The saved model has a complete shell and closed left-hinge door with integrated heater.

Run `finish_sauna.py` against the original pilot to reproduce the detailed file. It saves `sauna-complete.blend` and refuses to add duplicate details to an already finished scene. `render_finished.py` renders six inspection images without changing the saved model. CPU rendering is used because this machine's current NVIDIA driver cannot load Blender 5.1's CUDA kernels.

`validate_finished.py` runs the original size/collision checks and additionally verifies both doors' finish hardware, equipment labels, external display placement, batten end joints and lamp assembly. Results are saved as `validation-finished.json`.

The final aesthetic pass is reproducible with `style_sauna.py`, after `finish_sauna.py`. It adds a pale matte timber finish, eased seating edges, neutral glass and an optional concealed under-bench light. Product cameras use a light neutral studio floor. The scale reference remains in the file but is hidden for the product views; enable its collection for scale inspection. Both actual lighting collections can be toggled independently. The interior camera is inside the entrance to keep the front mullion out of the view.

## Specification and Assumptions

The supplied PDF defines a 1.40 x 1.20 x 2.02 m spruce cabin, 45 mm solid timber walls, a front entrance, full-height window, 8 mm glass door with bar handle, and two 3.6 kW heater control variants. The supplied photographs were used only as visual references. All geometry and timber textures are original.

The PDF does not provide complete component drawings. This first model uses a provisional 640 x 1840 mm door opening and 420 x 1820 mm window opening. Bench dimensions, hardware geometry, heater casing/rack dimensions, mounting layout and control enclosure dimensions are design assumptions. The heater is a visual pilot representation of the specified category, not a manufacturer-verified model. Confirm these details against drawings before treating this as a production asset or installation layout.

## Scene Organization

- `Cabin - ...`: separate shell, front assembly, roof, floor and seating collections.
- `Door - left hinge` / `Door - right hinge`: complete alternatives, including hardware and handles.
- `Heater - integrated control` / `Heater - external control`: complete heater alternatives, including mounting brackets; the external variant includes the exterior wall controller.
- `Scale reference - 1700mm`: a 1.7 m mannequin used for scale inspection.
- `Presentation`: studio lighting, floor and exterior/cutaway cameras; excluded from exports.

Initially only the left door and integrated heater are visible. Toggle BOTH viewport and render visibility for the two collections in a category when switching variants. Keep one door and one heater active.

Each door has a named swing pivot. Rotate its local Z from 0 to -90 degrees for the left door, or 0 to +90 for the right door. Hinge side is defined as viewed from outside facing the entrance. The door should be closed before exporting.

For an interior inspection, hide `Cabin - roof` and `Cabin - right`, switch to `Camera - cutaway`, and open the active door. Hidden walls still belong to the base cabin asset.

## Scale and Export Contract

Blender uses metres, +Z up, +X width and -Y toward the front. The origin is the centre of the exterior back wall at floor level. Cabin bounds are X [-0.7, 0.7], Y [-1.2, 0], Z [0, 2.02].

Exported glTF uses +Y up and +Z toward the front after Blender's normal axis conversion. All five assets assemble at translation [0, 0, 0], rotation [0, 0, 0], scale [1, 1, 1]. Geometry transforms and bevels are baked into temporary export meshes, preserving editable source assemblies.

`assets/asset-manifest.json` records exact IDs, file sizes, triangle counts, source bounds, and SHA-256 hashes. Each ID matches its GLB filename. All eight GLBs now come from `sauna-complete.blend`: five required assets, the scale figure, the shaded lamp, and the concealed light fixture. GLBs contain embedded timber textures and Draco-compressed geometry. Schema 2 exports preserve cabin sections and separate `door_leaf` from fixed `door_frame` geometry. Door roots record `hinge_pivot_gltf` and `open_sign` for later animation.

`export_materials.py` bakes the final timber color and tangent-space normal maps with Cycles on a 1.6 x 0.24 m UV plane matching the model's timber mapping. Export meshes use copies of these portable materials; the editable source materials retain their original nodes. The optional GLBs include fixture geometry and emission; Blender area lights remain in the editable files because glTF punctual lights do not represent area lights.

`validation-roundtrip.json` records reimport of every GLB into Blender. Every evaluated source vertex and every reimported vertex has a counterpart within 0.1 mm; the maximum observed difference is about 0.0254 mm. Triangle counts and source/file hashes match. Both doors were compared at 0, 45 and 90 degrees to verify exported hinge metadata and moving hardware. All four assemblies use the shared origin without offsets. `finished/export-roundtrip.png` shows the reimported geometry and materials under the Blender studio lighting. Browser work remains a separate next stage.

## Repeatable Workflow

Scripts live in the workspace `blender/` directory:

1. `build_sauna.py`: creates the source scene, original textures, both door and heater alternatives, cameras and scale reference; saves the blend file.
2. `validate_sauna.py`: verifies shell dimensions, wall/glass thickness, reference height, sampled door swing against timber, and heater/timber intersections; writes `validation.json`.
3. `export_assets.py`: exports the five GLBs through Blender, verifies Draco is present, and records the asset manifest.
4. `render_inspection.py`: renders the exterior and all four cutaway configurations in a background Blender process. This does not overwrite the source scene.

For the finished deliverable, run `export_assets.py` against `sauna-complete.blend`, then `validate_roundtrip.py` (append `-- --render` to render the reimported model). Run `package_configurations.py` against the master, followed by `validate_configurations.py` to reopen and check all four saved copies. These scripts use background Blender and do not overwrite the master. `export_assets.py` calls `export_materials.py` automatically. `scripts/package-blender.py` builds the delivery ZIP after the reports pass.

Run a script from Blender's Python console with `exec(compile(open(r'ABSOLUTE_SCRIPT_PATH', encoding='utf-8').read(), 'script', 'exec'), {'__name__': '__main__'})`. Run `build_sauna.py` in a fresh Blender file to regenerate a clean pilot; it creates a new scene and does not delete existing work.

## Validation Scope

`validation.json` records Blender geometry checks. Swing clearance is sampled every 5 degrees, with intentional hinge, handle and gasket contacts excluded. Wall mount contact is intentional. Rendered cutaways supplement the numerical checks.

Manufacturer installation clearances are not established by these geometry checks. GLB round-trip alignment is verified in Blender; browser performance and the Three.js viewer remain a later stage. The finished model includes an optional shaded sauna lamp; presentation lights are separate studio lights.
