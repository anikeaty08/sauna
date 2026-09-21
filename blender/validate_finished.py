"""Check finished details in addition to the cabin and variant geometry checks."""

import bpy
import json
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
checks = runpy.run_path(str(ROOT / 'blender' / 'validate_sauna.py'))
report = checks['validate']()
scene = bpy.context.scene
visibility = {c.name: c.hide_viewport for c in scene.collection.children}
try:
    for coll in scene.collection.children:
        coll.hide_viewport = False
    bpy.context.view_layer.update()
    assert scene.get('finished_visual_details')
    for side in ['left', 'right']:
        coll = bpy.data.collections[f'Door - {side} hinge']
        moving = [o for o in coll.objects if o.name.startswith(('Handle glass isolator', 'Glass clamp screw head'))]
        assert len(moving) == 8
        for obj in moving:
            assert obj.parent.name == f'Door {side} swing pivot'
            center = obj.matrix_world.translation
            assert -1.22 < center.y < -1.15 and 0.2 < center.z < 1.8, obj.name
    external = bpy.data.collections['Heater - external control']
    display = next(o for o in external.objects if o.name.startswith('Controller temperature display'))
    assert display.type == 'MESH'
    assert (display.matrix_world.translation - Vector((0.115, -1.243, 1.389))).length < 0.00001
    for variant in ['integrated', 'external']:
        coll = bpy.data.collections[f'Heater - {variant} control']
        labels = [o for o in coll.objects if o.name.startswith('Heater rated power marking')]
        assert len(labels) == 1 and labels[0].type == 'MESH'
        assert (labels[0].matrix_world.translation - Vector((0.45, -0.993, 0.58))).length < 0.00001
        screws = [o for o in coll.objects if o.name.startswith('Heater casing screw')]
        assert len(screws) == 4
        assert all(abs(o.matrix_world.translation.y + 0.989) < 0.00001 for o in screws)
    for obj in scene.objects:
        if 'interior batten' in obj.name:
            points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
            assert abs(min(p.z for p in points) - 0.12) < 0.00001
            assert abs(max(p.z for p in points) - 1.925) < 0.00001
    lamp = bpy.data.collections['Lighting - warm timber shade']
    assert len([o for o in lamp.objects if 'vertical slat' in o.name]) == 7
    assert any(o.type == 'LIGHT' and o.data.energy > 0 for o in lamp.objects)
    report['checks'].extend([
        'Both doors retain eight moving finish details at their correct world positions',
        'External controller digits and both heater labels are meshes at their equipment positions',
        'Both heaters have four correctly positioned casing screws',
        'Interior battens meet perimeter trim without coplanar overlaps',
        'Optional lamp has seven shade slats and a powered light',
    ])
    report['source'] = bpy.data.filepath
    (ROOT / 'output' / 'blender' / 'validation-finished.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('FINISHED MODEL CHECKS PASSED')
finally:
    for name, hidden in visibility.items():
        bpy.data.collections[name].hide_viewport = hidden
