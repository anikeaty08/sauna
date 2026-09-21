"""Save self-contained, editable presets without overwriting the master file."""

import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'blender'
presets = OUTPUT / 'configurations'
presets.mkdir(exist_ok=True)
scene = bpy.context.scene
source = Path(bpy.data.filepath)
guide = bpy.data.texts.get('START HERE - Sauna') or bpy.data.texts.new('START HERE - Sauna')
guide.clear()
guide.write('''SAUNA BLENDER DELIVERABLE

Four editable configurations accompany sauna-complete.blend.
Each has a complete shell, closed glass door, one heater, and both optional lights.
All timber textures are packed in the file.

CAMERAS: Camera - exterior / Camera - interior / Camera - cutaway.
CUTAWAY: Hide Cabin - roof and Cabin - right in both viewport and render.
DOOR: Rotate Door left swing pivot Z from 0 to -90 degrees;
      rotate Door right swing pivot Z from 0 to +90 degrees.
SCALE: Enable Scale reference - 1700mm for the human reference.
LIGHTS: Each Lighting - collection can be toggled independently.

Metres; origin at back wall centre at floor level; +Z up, -Y front.
Cabin: 1.40 x 1.20 x 2.02 m. Walls: 45 mm. Glass door: 8 mm.
Hardware, heater envelope, guard and lamp details are visual assumptions.
See ../README.md and ../validation-finished.json for scope and checks.
The browser stage is separate from this Blender deliverable.
''')
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.camera = bpy.data.objects['Camera - exterior']
for coll in scene.collection.children:
    if coll.name.startswith(('Cabin -', 'Lighting -')):
        coll.hide_viewport = coll.hide_render = False
bpy.data.collections['Scale reference - 1700mm'].hide_render = True
bpy.data.collections['Scale reference - 1700mm'].hide_viewport = True
for side in ['left', 'right']:
    bpy.data.objects[f'Door {side} swing pivot'].rotation_euler.z = 0
bpy.ops.file.pack_all()
report = {'source': source.name, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'configurations': []}
for side in ['left', 'right']:
    for heater in ['integrated', 'external']:
        for candidate in ['left', 'right']:
            coll = bpy.data.collections[f'Door - {candidate} hinge']
            coll.hide_render = coll.hide_viewport = candidate != side
        for candidate in ['integrated', 'external']:
            coll = bpy.data.collections[f'Heater - {candidate} control']
            coll.hide_render = coll.hide_viewport = candidate != heater
        scene['active_configuration'] = f'{side.title()} hinge / {heater} control / both optional lights'
        bpy.context.view_layer.update()
        path = presets / f'sauna-{side}-{heater}.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(path), copy=True)
        report['configurations'].append({'file': path.name, 'door': side, 'heater': heater,
                                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(presets / 'configurations.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('Four packed Blender configurations saved; master file unchanged.')
