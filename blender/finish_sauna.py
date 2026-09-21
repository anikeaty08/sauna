"""Add the finished visual details to the editable pilot, without replacing it."""

import bpy
import importlib.util
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sauna_geometry', ROOT / 'blender' / 'build_sauna.py')
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)


def parent_keep_world(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def text_mesh(name, text, position, size, coll, material):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = text
    curve.size = size
    curve.align_x = 'CENTER'
    curve.extrude = 0.00005
    obj = bpy.data.objects.new(name, curve)
    coll.objects.link(obj)
    obj.location = position
    obj.rotation_euler.x = math.pi / 2
    obj.data.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def finish_sauna():
    scene = bpy.context.scene
    if scene.get('finished_visual_details'):
        raise RuntimeError('Finishing details already exist. Run on the original pilot file.')
    geo.COLLECTIONS.update({c.name: c for c in scene.collection.children})
    geo.MATERIALS.update({m.name: m for m in bpy.data.materials})
    visibility = {c.name: c.hide_viewport for c in scene.collection.children}
    for coll in scene.collection.children:
        coll.hide_viewport = False
    wood = geo.MATERIALS['Spruce']
    bench = geo.MATERIALS['Bench timber']
    steel = geo.MATERIALS['Stainless steel']
    dark = geo.MATERIALS['Graphite enamel']
    seal = geo.MATERIALS['Door seal']
    trim = geo.collection('Cabin - finishing')
    guard = geo.collection('Cabin - heater guard')
    lighting = geo.collection('Lighting - warm timber shade')
    seats = geo.COLLECTIONS['Cabin - seating']

    # Edge relief makes the horizontal timber joints legible without opening gaps.
    for obj in scene.objects:
        if obj.name.startswith(('Back board', 'Left board', 'Right board')):
            obj.modifiers['Soft manufactured edges'].width = 0.0024
        elif obj.name.startswith('Ceiling board'):
            obj.modifiers['Soft manufactured edges'].width = 0.0017
    for mat in [wood, bench]:
        nodes = mat.node_tree.nodes
        texture = next(n for n in nodes if n.type == 'TEX_IMAGE')
        bump = nodes.new('ShaderNodeBump')
        bump.name = 'Fine timber surface'
        bump.inputs['Strength'].default_value = 0.16
        bump.inputs['Distance'].default_value = 0.0003
        mat.node_tree.links.new(texture.outputs['Color'], bump.inputs['Height'])
        mat.node_tree.links.new(bump.outputs['Normal'], nodes['Principled BSDF'].inputs['Normal'])
    dark.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.15
    dark.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.43

    for x in [-0.61, 0.61]:
        geo.box('Rear interior batten', (x, -0.052, 1.0225), (0.044, 0.014, 1.805), trim, wood, 0.0018)
    for side, x in [('left', -0.648), ('right', 0.648)]:
        for y in [-0.12, -1.055]:
            geo.box(f'{side} interior batten', (x, y, 1.0225), (0.014, 0.044, 1.805), trim, wood, 0.0018)
        for z, height in [(0.0825, 0.075), (1.95, 0.05)]:
            geo.box(f'{side} perimeter trim', (x, -0.60, z), (0.014, 1.11, height), trim, wood, 0.0018)
    for z, height in [(0.0825, 0.075), (1.95, 0.05)]:
        geo.box('Rear perimeter trim', (0, -0.054, z), (1.282, 0.018, height), trim, wood, 0.0018)
    geo.box('Front ceiling trim', (0, -1.145, 1.95), (1.282, 0.020, 0.05), trim, wood, 0.0018)
    for obj in list(trim.objects):
        wall = {'Rear': 'back', 'Front': 'front'}.get(obj.name.split()[0], obj.name.split()[0])
        geo.move_to(obj, geo.COLLECTIONS[f'Cabin - {wall}'])
    bpy.data.collections.remove(trim)

    geo.box('Upper bench front apron', (0, -0.498, 0.786), (1.24, 0.028, 0.105), seats, bench, 0.003)
    geo.box('Lower bench front apron', (-0.20, -0.78, 0.390), (0.84, 0.030, 0.080), seats, bench, 0.003)
    for x in [-0.56, 0.56]:
        geo.box('Upper bench leg brace', (x, -0.2975, 0.285), (0.035, 0.335, 0.060), seats, bench, 0.002)
        geo.cylinder('Flush timber apron plug', (x, -0.512, 0.79), (x, -0.5127, 0.79), 0.006, seats, wood, 16)
    for x in [-0.56, 0.16]:
        geo.box('Lower step leg brace', (x, -0.65, 0.18), (0.035, 0.22, 0.045), seats, bench, 0.002)
        geo.cylinder('Flush step apron plug', (x, -0.795, 0.39), (x, -0.7957, 0.39), 0.005, seats, wood, 16)

    # The guard is a visual design assumption, not a certified heater clearance.
    for x, y in [(0.243, -1.055), (0.625, -1.055), (0.243, -0.70)]:
        geo.box('Heater guard upright', (x, y, 0.405), (0.028, 0.028, 0.72), guard, bench, 0.004)
    geo.box('Heater guard front rail', (0.434, -1.055, 0.776), (0.410, 0.035, 0.038), guard, bench, 0.005)
    geo.box('Heater guard side rail', (0.243, -0.86, 0.776), (0.035, 0.355, 0.038), guard, bench, 0.005)
    for x in [0.243, 0.625]:
        geo.cylinder('Guard front fixing', (x, -1.073, 0.773), (x, -1.074, 0.773), 0.004, guard, steel, 16)

    for side in ['left', 'right']:
        coll = geo.COLLECTIONS[f'Door - {side} hinge']
        pivot = bpy.data.objects[f'Door {side} swing pivot']
        handle_x = -0.05 if side == 'left' else -0.49
        for z in [0.91, 1.11]:
            for y in [-1.192, -1.178]:
                obj = geo.cylinder('Handle glass isolator', (handle_x, y - 0.001, z), (handle_x, y + 0.001, z), 0.013, coll, seal)
                parent_keep_world(obj, pivot)
        hx = -0.552 if side == 'left' else 0.012
        for z in [0.30, 1.70]:
            for dz in [-0.016, 0.016]:
                obj = geo.cylinder('Glass clamp screw head', (hx, -1.204, z + dz), (hx, -1.2052, z + dz), 0.004, coll, steel, 16)
                parent_keep_world(obj, pivot)

    ink = geo.material('Equipment marking', (0.72, 0.75, 0.73), roughness=0.55)
    display = geo.material('Controller illuminated digits', (0.48, 0.83, 0.62), roughness=0.35)
    display_bsdf = display.node_tree.nodes['Principled BSDF']
    display_bsdf.inputs['Emission Color'].default_value = (0.22, 0.65, 0.40, 1)
    display_bsdf.inputs['Emission Strength'].default_value = 1.2
    for variant in ['integrated', 'external']:
        coll = geo.COLLECTIONS[f'Heater - {variant} control']
        root = bpy.data.objects[f'heater_{variant}-control']
        label = text_mesh('Heater rated power marking', '3.6 kW', (0.45, -0.993, 0.58), 0.014, coll, ink)
        parent_keep_world(label, root)
        for x in [0.353, 0.547]:
            for z in [0.245, 0.535]:
                screw = geo.cylinder('Heater casing screw', (x, -0.988, z), (x, -0.990, z), 0.0032, coll, steel, 16)
                parent_keep_world(screw, root)
        if variant == 'external':
            label = text_mesh('Controller temperature display', '80 C', (0.115, -1.243, 1.389), 0.016, coll, display)
            parent_keep_world(label, root)

    emitter = geo.material('Warm lamp diffuser', (1, 0.77, 0.43), roughness=0.42)
    bsdf = emitter.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Emission Color'].default_value = (1, 0.58, 0.24, 1)
    bsdf.inputs['Emission Strength'].default_value = 3
    geo.box('Lamp wall mount', (-0.46, -0.058, 1.62), (0.235, 0.026, 0.315), lighting, bench, 0.003)
    geo.box('Lamp opal diffuser', (-0.46, -0.083, 1.62), (0.192, 0.024, 0.25), lighting, emitter, 0.008)
    for x in [-0.57, -0.35]:
        geo.box('Lamp shade side', (x, -0.095, 1.62), (0.018, 0.074, 0.29), lighting, bench, 0.002)
    for z in [1.477, 1.763]:
        geo.box('Lamp shade end rail', (-0.46, -0.116, z), (0.238, 0.030, 0.024), lighting, bench, 0.002)
    for i in range(7):
        geo.box('Lamp shade vertical slat', (-0.556 + i * 0.032, -0.137, 1.62), (0.016, 0.012, 0.262), lighting, bench, 0.002)
    light_data = bpy.data.lights.new('Warm sauna wall light', 'AREA')
    light_data.energy = 9
    light_data.color = (1.0, 0.65, 0.34)
    light_data.shape = 'RECTANGLE'
    light_data.size = 0.17
    light_data.size_y = 0.22
    light = bpy.data.objects.new('Warm sauna wall light', light_data)
    lighting.objects.link(light)
    light.location = (-0.46, -0.153, 1.62)
    geo.point_at(light, (-0.3, -1.0, 1.1))
    lighting['asset_id'] = 'lighting_timber-shade'
    lighting['optional'] = True

    # Dedicated camera looks through the entrance with the complete shell present.
    camera_data = bpy.data.cameras.new('Interior inspection lens')
    camera = bpy.data.objects.new('Camera - interior', camera_data)
    geo.COLLECTIONS['Presentation'].objects.link(camera)
    camera.location = (-0.25, -1.72, 1.45)
    camera_data.lens = 19
    geo.point_at(camera, (-0.01, -0.27, 1.03))
    scene.cycles.samples = 48
    scene.eevee.use_raytracing = True
    geo.MATERIALS['Clear tempered glass - 8mm'].use_raytrace_refraction = True
    scene.camera = bpy.data.objects['Camera - exterior']
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.region_3d.view_camera_zoom = 12
            area.spaces.active.shading.use_scene_world = True
            area.spaces.active.shading.use_scene_lights = True
    scene['finished_visual_details'] = True
    scene['detail_assumptions'] = 'Timber trim, guard, lamp, and finish hardware are original visual-design assumptions.'
    scene['active_configuration'] = 'Left hinge / integrated control / warm timber-shade lamp'
    bpy.ops.object.select_all(action='DESELECT')
    for name, hidden in visibility.items():
        bpy.data.collections[name].hide_viewport = hidden
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'output' / 'blender' / 'sauna-complete.blend'))
    print('Saved finished sauna:', len(scene.objects), 'objects')


if __name__ == '__main__':
    finish_sauna()
