"""Verify each saved preset independently after reopening from disk."""

import bpy
import hashlib
import json
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'blender'
manifest = json.loads((OUTPUT / 'configurations' / 'configurations.json').read_text())
report = {'configurations': []}
for configuration in manifest['configurations']:
    path = OUTPUT / 'configurations' / configuration['file']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == configuration['sha256']
    bpy.ops.wm.open_mainfile(filepath=str(path))
    scene = bpy.context.scene
    for side in ['left', 'right']:
        coll = bpy.data.collections[f'Door - {side} hinge']
        expected_hidden = side != configuration['door']
        assert coll.hide_viewport == coll.hide_render == expected_hidden
        assert abs(bpy.data.objects[f'Door {side} swing pivot'].rotation_euler.z) < 1e-7
    for heater in ['integrated', 'external']:
        coll = bpy.data.collections[f'Heater - {heater} control']
        expected_hidden = heater != configuration['heater']
        assert coll.hide_viewport == coll.hide_render == expected_hidden
    for coll in scene.collection.children:
        if coll.name.startswith(('Cabin -', 'Lighting -')):
            assert not coll.hide_viewport and not coll.hide_render
    materials = {m for o in scene.objects if o.type == 'MESH' for m in o.data.materials if m}
    images = {n.image for m in materials if m.node_tree for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
    assert images and all(i.packed_file for i in images)
    assert scene.unit_settings.scale_length == 1 and scene.unit_settings.system == 'METRIC'
    assert scene.camera.name == 'Camera - exterior'
    assert 'START HERE - Sauna' in bpy.data.texts
    report['configurations'].append({'file': path.name, 'status': 'pass', 'packed_textures': len(images)})
report['status'] = 'pass'
(OUTPUT / 'validation-configurations.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
