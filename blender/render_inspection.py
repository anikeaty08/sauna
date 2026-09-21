"""Render repeatable exterior and four cutaway configuration views in background Blender."""

import bpy
import math
from pathlib import Path

OUTPUT = Path(r'C:\Users\anike\Desktop\sauna\output\blender')
scene = bpy.context.scene
scene.render.resolution_x = 1100
scene.render.resolution_y = 1100
scene.cycles.samples = 32
scene.camera = bpy.data.objects['Camera - exterior']
scene.render.filepath = str(OUTPUT / 'exterior.png')
bpy.ops.render.render(write_still=True)
scene.camera = bpy.data.objects['Camera - cutaway']
for name in ['Cabin - roof', 'Cabin - right', 'Scale reference - 1700mm']:
    bpy.data.collections[name].hide_render = True
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.cycles.samples = 24
for side in ['left', 'right']:
    for variant in ['integrated', 'external']:
        for s in ['left', 'right']:
            bpy.data.collections[f'Door - {s} hinge'].hide_render = s != side
            bpy.data.objects[f'Door {s} swing pivot'].rotation_euler.z = math.radians(-65 if s == 'left' else 65)
        for v in ['integrated', 'external']:
            bpy.data.collections[f'Heater - {v} control'].hide_render = v != variant
        scene.render.filepath = str(OUTPUT / f'cutaway-{side}-{variant}.png')
        bpy.ops.render.render(write_still=True)
