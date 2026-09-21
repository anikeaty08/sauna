"""Render the finished Blender sauna without changing the saved model."""

import bpy
import math
import sys
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'blender' / 'finished'
OUTPUT.mkdir(exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'
shots = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def render(name):
    if shots and name not in shots:
        return
    scene.render.filepath = str(OUTPUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)


scene.camera = bpy.data.objects['Camera - exterior']
render('exterior')
scene.camera = bpy.data.objects['Camera - interior']
bpy.data.collections['Scale reference - 1700mm'].hide_render = True
bpy.data.objects['Door left swing pivot'].rotation_euler.z = math.radians(-90)
render('interior')
scene.camera = bpy.data.objects['Camera - cutaway']
for name in ['Cabin - roof', 'Cabin - right']:
    bpy.data.collections[name].hide_render = True
for side in ['left', 'right']:
    for variant in ['integrated', 'external']:
        for s in ['left', 'right']:
            bpy.data.collections[f'Door - {s} hinge'].hide_render = s != side
            bpy.data.objects[f'Door {s} swing pivot'].rotation_euler.z = math.radians(-65 if s == 'left' else 65)
        for v in ['integrated', 'external']:
            bpy.data.collections[f'Heater - {v} control'].hide_render = v != variant
        render(f'cutaway-{side}-{variant}')
