"""Reimport every finished GLB and compare evaluated source vertices in Blender."""

import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree

OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'blender'
manifest = json.loads((OUTPUT / 'assets' / 'asset-manifest.json').read_text())
assert hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest() == manifest['source_sha256']
source_scene = bpy.context.scene
for coll in source_scene.collection.children:
    coll.hide_viewport = False
bpy.context.view_layer.update()


def points(objects):
    result = []
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            result.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
    return result


def tree(vertices):
    result = KDTree(len(vertices))
    for index, vertex in enumerate(vertices):
        result.insert(vertex, index)
    result.balance()
    return result


def compare(expected, actual):
    assert expected and actual
    a, b = tree(expected), tree(actual)
    deviation = max(max(a.find(v)[2] for v in actual), max(b.find(v)[2] for v in expected))
    assert deviation < 0.0001, f'Round-trip drift exceeds 0.1 mm: {deviation}'
    return deviation


def source_objects(asset_id):
    if asset_id == 'base_cabin':
        collections = [c for c in source_scene.collection.children if c.name.startswith('Cabin -')]
    elif asset_id == 'scale_reference':
        collections = [bpy.data.collections['Scale reference - 1700mm']]
    else:
        collections = [c for c in source_scene.collection.children if c.get('asset_id') == asset_id]
    return [o for c in collections for o in c.objects]


expected = {asset['id']: points(source_objects(asset['id'])) for asset in manifest['assets']}
import_scene = bpy.data.scenes.new('Finished GLB round-trip inspection')
import_scene.unit_settings.system = 'METRIC'
bpy.context.window.scene = import_scene
report = {'source': manifest['source_file'], 'source_sha256': manifest['source_sha256'],
          'tolerance_metres': 0.0001, 'assets': [], 'door_swing': [],
          'limitations': ['Blender reimport checks; browser and device performance remain untested.',
                         'Fixture area lights are retained in Blender presets, not in GLB geometry exports.']}
imported = {}
for asset in manifest['assets']:
    path = OUTPUT / 'assets' / asset['file']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == asset['sha256']
    before = set(import_scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = list(set(import_scene.objects) - before)
    bpy.context.view_layer.update()
    error = compare(expected[asset['id']], points(objects))
    imported[asset['id']] = objects
    root = next(o for o in objects if o.get('asset_id') == asset['id'])
    assert root.location.length < 1e-7 and all(abs(v - 1) < 1e-7 for v in root.scale)
    meshes = [o for o in objects if o.type == 'MESH']
    triangles = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    assert triangles == asset['triangles']
    report['assets'].append({'id': asset['id'], 'triangles': triangles, 'max_vertex_deviation_metres': error, 'status': 'pass'})

for side in ['left', 'right']:
    asset_id = f'door_{side}-hinge'
    root = next(o for o in imported[asset_id] if o.get('asset_id') == asset_id)
    leaves = [o for o in imported[asset_id] if o.get('part') == 'door_leaf']
    assert len(leaves) == 1
    x, y, z = root['hinge_pivot_gltf']
    pivot = bpy.data.objects.new('Round-trip ' + side + ' pivot', None)
    import_scene.collection.objects.link(pivot)
    pivot.location = (x, -z, y)
    bpy.context.view_layer.update()
    leaf = leaves[0]
    world = leaf.matrix_world.copy()
    leaf.parent = pivot
    leaf.matrix_world = world
    source_pivot = bpy.data.objects[f'Door {side} swing pivot']
    source_leaf = [o for o in source_objects(asset_id) if o.parent == source_pivot]
    for angle in [0, 45, 90]:
        rotation = math.radians(angle * root['open_sign'])
        bpy.context.window.scene = source_scene
        source_pivot.rotation_euler.z = rotation
        bpy.context.view_layer.update()
        original = points(source_leaf)
        bpy.context.window.scene = import_scene
        pivot.rotation_euler.z = rotation
        bpy.context.view_layer.update()
        candidates = [leaf, *leaf.children_recursive]
        error = compare(original, points(candidates))
        report['door_swing'].append({'side': side, 'degrees': angle, 'max_vertex_deviation_metres': error, 'status': 'pass'})
    pivot.rotation_euler.z = 0
    source_pivot.rotation_euler.z = 0

report['status'] = 'pass'
report['combinations'] = [{'door': side, 'heater': heater, 'status': 'pass',
                          'basis': 'All parts match source vertices at the shared origin within 0.1 mm.'}
                         for side in ['left', 'right'] for heater in ['integrated', 'external']]
(OUTPUT / 'validation-roundtrip.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))

if '--render' in sys.argv:
    for asset_id, objects in imported.items():
        hidden = asset_id in ['door_right-hinge', 'heater_external-control', 'scale_reference']
        for obj in objects:
            obj.hide_render = hidden
    import_scene.collection.children.link(bpy.data.collections['Presentation'])
    for collection in source_scene.collection.children:
        if collection.name.startswith('Lighting -'):
            for obj in collection.objects:
                if obj.type == 'LIGHT':
                    import_scene.collection.objects.link(obj)
    import_scene.world = source_scene.world
    import_scene.camera = bpy.data.objects['Camera - exterior']
    import_scene.render.engine = 'CYCLES'
    import_scene.cycles.device = 'CPU'
    import_scene.cycles.samples = 32
    import_scene.cycles.use_denoising = True
    import_scene.render.resolution_x = import_scene.render.resolution_y = 1000
    import_scene.render.resolution_percentage = 100
    import_scene.view_settings.view_transform = source_scene.view_settings.view_transform
    import_scene.view_settings.look = source_scene.view_settings.look
    import_scene.view_settings.exposure = source_scene.view_settings.exposure
    import_scene.render.filepath = str(OUTPUT / 'finished' / 'export-roundtrip.png')
    bpy.ops.render.render(write_still=True)
