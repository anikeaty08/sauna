"""Render a contact sheet of the exported module GLBs (what the browser gets).

    blender -b --factory-startup --python blender/production/zirbe-6eck/scripts/preview_modules.py -- out.png
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[4]
out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else str(ROOT / 'output' / 'modules-contact-sheet.png')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
glbs = sorted((ROOT / 'public' / 'modules').rglob('*.glb'))
x = 0.0
for glb in glbs:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
    w = (max(p.x for p in pts) - min(p.x for p in pts)) if pts else 0.3
    for r in roots:
        r.location.x += x - (min(p.x for p in pts) if pts else 0)
    x += max(w, 0.2) + 0.25

# neutral studio: light floor, soft sun + fill, camera looking at the row
bpy.ops.mesh.primitive_plane_add(size=60, location=(x / 2, 0, 0))
floor = bpy.context.active_object
fm = bpy.data.materials.new('floor'); fm.use_nodes = True
next(n for n in fm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.8, 0.79, 0.76, 1)
floor.data.materials.append(fm)
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.9, 0.9, 0.88, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); scene.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = x * 1.02
cam.location = (x / 2 - 0.2, -8, 2.6)
cam.rotation_euler = (Vector((x / 2 - 0.2, 0, 0.55)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x, scene.render.resolution_y = 2200, 560
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('wrote', out, len(glbs), 'modules')
