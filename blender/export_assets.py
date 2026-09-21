"""Export evaluated copies so the editable scene keeps its assembly structure."""

import bpy
import json
import struct
import hashlib
import runpy
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'blender'
ASSETS = OUTPUT / 'assets'


def export_assets():
    ASSETS.mkdir(exist_ok=True)
    scene = bpy.context.scene
    source_path = Path(bpy.data.filepath)
    replacements = runpy.run_path(str(Path(__file__).with_name('export_materials.py')))['prepare_materials'](OUTPUT)
    state = {c.name: (c.hide_viewport, c.hide_render) for c in scene.collection.children}
    groups = {'base_cabin': [c for c in scene.collection.children if c.name.startswith('Cabin -')]}
    for side in ['left', 'right']:
        groups[f'door_{side}-hinge'] = [bpy.data.collections[f'Door - {side} hinge']]
    for variant in ['integrated', 'external']:
        groups[f'heater_{variant}-control'] = [bpy.data.collections[f'Heater - {variant} control']]
    groups['scale_reference'] = [bpy.data.collections['Scale reference - 1700mm']]
    for coll in scene.collection.children:
        if coll.name.startswith('Lighting -'):
            groups[coll['asset_id']] = [coll]
    manifest = {
        'specification': 'KDL-SAUNA3D-PILOT-001',
        'units': 'metres',
        'blender_axes': {'up': '+Z', 'front': '-Y', 'width': '+X'},
        'gltf_axes': {'up': '+Y', 'front': '+Z', 'width': '+X'},
        'origin': 'Back exterior wall centre at floor level',
        'assembly_transform': {'translation': [0, 0, 0], 'rotation': [0, 0, 0], 'scale': [1, 1, 1]},
        'door_state': 'closed; door_leaf meshes rotate around hinge_pivot_gltf in the browser',
        'schema_version': 2,
        'source_file': source_path.name,
        'source_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'material_conversion': 'Timber color and tangent normal maps baked in Cycles on a 1.6 x 0.24 m UV plane; editable source materials preserved.',
        'lighting': 'Optional fixture geometry and emissive materials included; Blender area lights are not glTF punctual lights.',
        'assets': [],
    }
    temporary = bpy.data.collections.new('Temporary export copies')
    scene.collection.children.link(temporary)
    pivots = [bpy.data.objects[f'Door {side} swing pivot'] for side in ['left', 'right']]
    rotations = [p.rotation_euler.copy() for p in pivots]
    try:
        for pivot in pivots:
            pivot.rotation_euler.z = 0
        for coll in scene.collection.children:
            coll.hide_viewport = False
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for asset_id, collections in groups.items():
            copies = []
            partitions = {}
            for coll in collections:
                for source in coll.objects:
                    if source.type != 'MESH':
                        continue
                    evaluated = source.evaluated_get(depsgraph)
                    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
                    mesh.transform(evaluated.matrix_world)
                    for index, material in enumerate(mesh.materials):
                        if material.name in replacements:
                            mesh.materials[index] = replacements[material.name]
                    obj = bpy.data.objects.new(source.name + ' export', mesh)
                    temporary.objects.link(obj)
                    copies.append(obj)
                    role = coll.name.removeprefix('Cabin - ') if asset_id == 'base_cabin' else 'body'
                    if asset_id.startswith('door_'):
                        role = 'door_leaf' if source.parent and 'swing pivot' in source.parent.name else 'door_frame'
                    partitions.setdefault(role, []).append(obj)
            root = bpy.data.objects.new(asset_id, None)
            temporary.objects.link(root)
            root['asset_id'] = asset_id
            if asset_id.startswith('door_'):
                side = 'left' if 'left' in asset_id else 'right'
                root['hinge_pivot_gltf'] = [-0.58 if side == 'left' else 0.04, 0, 1.185]
                root['open_sign'] = -1 if side == 'left' else 1
            root['source_bounds_blender'] = [
                min((o.matrix_world @ v.co)[axis] for o in copies for v in o.data.vertices)
                for axis in range(3)
            ] + [
                max((o.matrix_world @ v.co)[axis] for o in copies for v in o.data.vertices)
                for axis in range(3)
            ]
            merged = []
            for role, parts in partitions.items():
                bpy.ops.object.select_all(action='DESELECT')
                for obj in parts:
                    obj.select_set(True)
                bpy.context.view_layer.objects.active = parts[0]
                if len(parts) > 1:
                    bpy.ops.object.join()
                obj = bpy.context.object
                obj.name = asset_id + '_' + role
                obj['part'] = role
                obj.parent = root
                merged.append(obj)
            bpy.ops.object.select_all(action='DESELECT')
            root.select_set(True)
            for obj in merged:
                obj.select_set(True)
            filepath = ASSETS / (asset_id + '.glb')
            bpy.ops.export_scene.gltf(
                filepath=str(filepath), export_format='GLB', use_selection=True, use_active_scene=True,
                export_yup=True, export_animations=False, export_extras=True,
                export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                export_draco_position_quantization=16, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=12,
            )
            binary = filepath.read_bytes()
            json_length = struct.unpack_from('<I', binary, 12)[0]
            document = json.loads(binary[20:20 + json_length])
            assert 'KHR_draco_mesh_compression' in document.get('extensionsRequired', [])
            assert len(document['scenes']) == 1 and len(document['meshes']) == len(partitions)
            assert all(n['name'].startswith(asset_id) for n in document['nodes'])
            for material in document.get('materials', []):
                if 'portable finish' in material.get('name', ''):
                    assert 'baseColorTexture' in material['pbrMetallicRoughness']
                    assert 'normalTexture' in material
            triangles = sum(a['count'] // 3 for mesh in document['meshes'] for p in mesh['primitives']
                            for a in [document['accessors'][p['indices']]])
            manifest['assets'].append({'id': asset_id, 'file': filepath.name,
                                       'bytes': len(binary), 'triangles': triangles,
                                       'parts': list(partitions),
                                       'bounds_blender': list(root['source_bounds_blender']),
                                       'sha256': hashlib.sha256(binary).hexdigest()})
            for obj in [*merged, root]:
                bpy.data.objects.remove(obj, do_unlink=True)
        ASSETS.joinpath('asset-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        print(json.dumps(manifest, indent=2))
    finally:
        for pivot, rotation in zip(pivots, rotations):
            pivot.rotation_euler = rotation
        for obj in list(temporary.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(temporary)
        for name, (viewport, render) in state.items():
            coll = bpy.data.collections[name]
            coll.hide_viewport, coll.hide_render = viewport, render
        bpy.context.view_layer.update()


if __name__ == '__main__':
    export_assets()
