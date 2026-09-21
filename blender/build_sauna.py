"""Original sauna pilot geometry. Run stages in the connected Blender session."""

import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "blender"
OUTPUT.mkdir(parents=True, exist_ok=True)
COLLECTIONS = {}
MATERIALS = {}


def collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    COLLECTIONS[name] = coll
    return coll


def move_to(obj, coll):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    coll.objects.link(obj)


def material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    MATERIALS[name] = mat
    return mat


def finish(obj, name, coll, mat, bevel=0):
    obj.name = name
    move_to(obj, coll)
    if mat:
        obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
    return obj


def box(name, center, size, coll, mat, bevel=0.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.dimensions = size
    finish(obj, name, coll, mat, bevel)
    # Give grain a consistent physical scale on every face; longest axis is grain.
    grain_axis = max(range(3), key=lambda i: size[i])
    uv_layer = obj.data.uv_layers.active
    offset = (len(coll.objects) * 0.137) % 1
    for polygon in obj.data.polygons:
        normal_axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        axes = [i for i in range(3) if i != normal_axis]
        u_axis = grain_axis if grain_axis in axes else axes[0]
        v_axis = next(i for i in axes if i != u_axis)
        for loop_index in polygon.loop_indices:
            co = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = (co[u_axis] / 1.6 + offset, co[v_axis] / 0.24 + offset)
    return obj


def cylinder(name, a, b, radius, coll, mat, vertices=24):
    delta = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                      depth=delta.length, location=(Vector(a) + Vector(b)) / 2)
    obj = bpy.context.object
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    finish(obj, name, coll, mat, min(radius / 5, 0.002))
    for poly in obj.data.polygons:
        poly.use_smooth = len(poly.vertices) == 4
    return obj


def sphere(name, center, size, coll, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=center)
    obj = bpy.context.object
    obj.dimensions = size
    finish(obj, name, coll, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def setup():
    scene = bpy.data.scenes.new('Sauna Pilot')
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.length_unit = 'METERS'
    scene.unit_settings.scale_length = 1
    scene['specification'] = 'KDL-SAUNA3D-PILOT-001'
    scene['origin_convention'] = 'Back exterior wall centre, floor Z=0; X width, -Y forward, +Z up; metres.'
    scene['provisional_dimensions'] = 'Door opening 640x1840mm; window 420x1820mm; bench and heater envelope pending detailed drawings.'
    for name in ['Cabin - back', 'Cabin - left', 'Cabin - right', 'Cabin - front',
                 'Cabin - roof', 'Cabin - floor', 'Cabin - seating',
                 'Door - left hinge', 'Door - right hinge',
                 'Heater - integrated control', 'Heater - external control',
                 'Scale reference - 1700mm', 'Presentation']:
        collection(name)
    material('Spruce', (0.66, 0.47, 0.27), roughness=0.55)
    material('Bench timber', (0.74, 0.57, 0.36), roughness=0.55)
    material('Stainless steel', (0.48, 0.52, 0.55), metallic=0.92, roughness=0.28)
    material('Graphite enamel', (0.035, 0.042, 0.045), metallic=0.55, roughness=0.32)
    material('Door seal', (0.017, 0.02, 0.019), roughness=0.76)
    material('Sauna stones', (0.09, 0.095, 0.09), roughness=0.92)
    material('Reference grey', (0.22, 0.30, 0.30), roughness=0.7)
    glass = material('Clear tempered glass - 8mm', (0.96, 0.99, 0.98), roughness=0.025)
    bsdf = glass.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Transmission Weight'].default_value = 1
    bsdf.inputs['IOR'].default_value = 1.45
    glass.diffuse_color = (0.7, 0.87, 0.83, 0.18)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1400
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('Soft studio world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.7, 0.75, 0.8, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    return scene


def build_cabin():
    wood = MATERIALS['Spruce']
    bench = MATERIALS['Bench timber']
    height = (1.975 - 0.045) / 18
    for index in range(18):
        z = 0.045 + (index + 0.5) * height
        box(f'Back board {index + 1:02}', (0, -0.0225, z), (1.4, 0.045, height), COLLECTIONS['Cabin - back'], wood)
        for side, x in [('left', -0.6775), ('right', 0.6775)]:
            box(f'{side.title()} board {index + 1:02}', (x, -0.6, z), (0.045, 1.11, height), COLLECTIONS[f'Cabin - {side}'], wood)
    front = COLLECTIONS['Cabin - front']
    for name, lo, hi in [('Left jamb', -0.7, -0.59), ('Centre mullion', 0.05, 0.18), ('Right jamb', 0.6, 0.7)]:
        box(name, ((lo + hi) / 2, -1.1775, 0.9825), (hi - lo, 0.045, 1.875), front, wood, 0.002)
    box('Front lintel', (0, -1.1775, 1.9475), (1.4, 0.045, 0.055), front, wood)
    box('Door threshold', (-0.27, -1.1775, 0.0625), (0.64, 0.045, 0.035), front, wood)
    box('Window sill', (0.39, -1.1775, 0.0725), (0.42, 0.045, 0.055), front, wood)
    box('Full-height fixed glass', (0.39, -1.179, 1.01), (0.414, 0.008, 1.814), front, MATERIALS['Clear tempered glass - 8mm'], 0.0007)
    for x in [0.184, 0.596]:
        box('Window vertical gasket', (x, -1.179, 1.01), (0.008, 0.014, 1.82), front, MATERIALS['Door seal'], 0.0005)
    for z in [0.104, 1.916]:
        box('Window horizontal gasket', (0.39, -1.179, z), (0.404, 0.014, 0.008), front, MATERIALS['Door seal'], 0.0005)
    box('Floor', (0, -0.6, 0.0225), (1.4, 1.2, 0.045), COLLECTIONS['Cabin - floor'], wood, 0.001)
    for index in range(12):
        box(f'Ceiling board {index + 1:02}', (-0.7 + (index + 0.5) * 1.4 / 12, -0.6, 1.9975),
            (1.4 / 12, 1.2, 0.045), COLLECTIONS['Cabin - roof'], wood, 0.001)
    seats = COLLECTIONS['Cabin - seating']
    for i in range(5):
        box(f'Upper bench slat {i + 1}', (0, -0.123 - i * 0.087, 0.855), (1.24, 0.078, 0.03), seats, bench, 0.004)
    for x in [-0.56, 0.56]:
        for y in [-0.13, -0.465]:
            box('Upper bench leg', (x, y, 0.435), (0.045, 0.045, 0.78), seats, bench, 0.002)
        box('Upper bench support', (x, -0.295, 0.816), (0.045, 0.43, 0.048), seats, bench, 0.002)
    for z in [1.09, 1.22]:
        box('Backrest slat', (0, -0.09, z), (1.24, 0.027, 0.095), seats, bench, 0.004)
    for x in [-0.53, 0.53]:
        box('Backrest standoff', (x, -0.065, 1.155), (0.045, 0.04, 0.265), seats, bench)
    for i in range(4):
        box(f'Lower step slat {i + 1}', (-0.20, -0.54 - i * 0.074, 0.445), (0.84, 0.066, 0.03), seats, bench, 0.003)
    for x in [-0.56, 0.16]:
        box('Lower bench support', (x, -0.65, 0.408), (0.045, 0.30, 0.044), seats, bench)
        for y in [-0.54, -0.76]:
            box('Lower bench leg', (x, y, 0.2155), (0.045, 0.045, 0.341), seats, bench)


def build_reference():
    coll = COLLECTIONS['Scale reference - 1700mm']
    mat = MATERIALS['Reference grey']
    x, y = -1.03, -0.57
    sphere('1700mm reference head', (x, y, 1.5925), (0.17, 0.19, 0.215), coll, mat)
    sphere('Reference torso', (x, y, 1.25), (0.34, 0.20, 0.46), coll, mat)
    sphere('Reference pelvis', (x, y, 1.00), (0.27, 0.18, 0.20), coll, mat)
    cylinder('Reference neck', (x, y, 1.45), (x, y, 1.51), 0.054, coll, mat)
    for side in [-1, 1]:
        cylinder('Reference thigh', (x + side * 0.075, y, 0.97), (x + side * 0.09, y, 0.57), 0.063, coll, mat)
        cylinder('Reference shin', (x + side * 0.09, y, 0.57), (x + side * 0.10, y, 0.10), 0.045, coll, mat)
        sphere('Reference foot', (x + side * 0.10, y - 0.045, 0.05), (0.10, 0.22, 0.10), coll, mat)
        cylinder('Reference upper arm', (x + side * 0.16, y, 1.40), (x + side * 0.22, y, 1.13), 0.044, coll, mat)
        cylinder('Reference forearm', (x + side * 0.22, y, 1.13), (x + side * 0.24, y - 0.025, 0.89), 0.034, coll, mat)
    coll['height_metres'] = 1.7


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def presentation():
    coll = COLLECTIONS['Presentation']
    mat = material('Studio floor', (0.38, 0.42, 0.43), roughness=0.85)
    box('Studio floor - not exported', (0, 0, -0.022), (200, 200, 0.04), coll, mat, 0)
    bpy.ops.object.camera_add(location=(3.25, -4.9, 3.05))
    camera = bpy.context.object
    camera.name = 'Camera - exterior'
    move_to(camera, coll)
    point_at(camera, (-0.12, -0.52, 0.99))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 3.55
    bpy.context.scene.camera = camera
    for name, pos, energy, size, color in [
        ('Key softbox', (1.5, -3.4, 4.5), 450, 3.0, (1, 0.93, 0.82)),
        ('Fill softbox', (-3, -1.8, 2.8), 260, 2.5, (0.82, 0.9, 1)),
        ('Top softbox', (1.0, 1.5, 4), 350, 2.0, (1, 1, 1)),
    ]:
        bpy.ops.object.light_add(type='AREA', location=pos)
        light = bpy.context.object
        light.name = name
        move_to(light, coll)
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
        light.data.color = color
        point_at(light, (0, -0.5, 1))
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.region_3d.view_perspective = 'CAMERA'
            space.overlay.show_overlays = False
            space.shading.type = 'MATERIAL'
    bpy.ops.object.select_all(action='DESELECT')


def save(name):
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / name))


def timber_textures():
    import numpy as np
    texture_dir = OUTPUT / 'textures'
    texture_dir.mkdir(exist_ok=True)
    u, v = np.meshgrid(np.linspace(0, 1, 1024), np.linspace(0, 1, 256))
    rng = np.random.default_rng(72)
    for name, base, strength in [('Spruce', [0.72, 0.555, 0.355], 1.0),
                                 ('Bench timber', [0.79, 0.65, 0.45], 0.45)]:
        warp = v + 0.014 * np.sin(u * 8 + v * 9) + 0.004 * np.sin(u * 21 + v * 16)
        broad = np.sin(warp * 95 + np.sin(warp * 47) * 1.7)
        fine = np.sin(warp * 410 + np.sin(u * 18) * 2)
        grain = 0.020 * broad + 0.006 * fine + rng.normal(0, 0.003, u.shape)
        if name == 'Spruce':
            for cx, cy, radius in [(0.22, 0.31, 0.034), (0.73, 0.77, 0.025)]:
                distance = np.sqrt(((u - cx) * 2.9) ** 2 + ((v - cy) * 0.62) ** 2)
                grain -= 0.16 * np.exp(-(distance / radius) ** 2)
                grain += 0.024 * np.sin(distance * 650) * np.exp(-(distance / (radius * 2.8)) ** 2)
        pixels = np.ones((256, 1024, 4), dtype=np.float32)
        pixels[:, :, :3] = np.clip(np.array(base)[None, None, :] + grain[:, :, None] * strength, 0, 1)
        img = bpy.data.images.new(name + ' - original grain', width=1024, height=256)
        img.pixels.foreach_set(pixels.ravel())
        img.filepath_raw = str(texture_dir / (name.lower().replace(' ', '-') + '.png'))
        img.file_format = 'PNG'
        img.save()
        img.pack()
        mat = MATERIALS[name]
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        node.label = 'Original generated grain; no vendor imagery'
        mat.node_tree.links.new(node.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])


def build_doors():
    front = COLLECTIONS['Cabin - front']
    seal = MATERIALS['Door seal']
    for x in [-0.588, 0.048]:
        box('Door jamb seal', (x, -1.175, 1.0), (0.016, 0.012, 1.84), front, seal, 0.0007)
    box('Door header seal', (-0.27, -1.175, 1.916), (0.62, 0.012, 0.008), front, seal, 0.0005)
    for side, hinge_x, sign in [('left', -0.58, -1), ('right', 0.04, 1)]:
        coll = COLLECTIONS[f'Door - {side} hinge']
        root = bpy.data.objects.new(f'door_{side}-hinge', None)
        coll.objects.link(root)
        root['asset_id'] = root.name
        pivot = bpy.data.objects.new(f'Door {side} swing pivot', None)
        coll.objects.link(pivot)
        pivot.parent = root
        pivot.location = (hinge_x, -1.185, 0)
        pivot['open_rotation_degrees'] = sign * 90
        leaf = []
        leaf.append(box(f'Door {side} glass 8mm', (-0.27, -1.185, 1.0), (0.62, 0.008, 1.82), coll, MATERIALS['Clear tempered glass - 8mm'], 0.0007))
        handle_x = 0.04 - 0.09 if side == 'left' else -0.58 + 0.09
        for y in [-1.239, -1.135]:
            leaf.append(cylinder(f'Door {side} wooden bar handle', (handle_x, y, 0.87), (handle_x, y, 1.15), 0.016, coll, MATERIALS['Bench timber']))
            for z in [0.91, 1.11]:
                leaf.append(cylinder('Handle mount', (handle_x, -1.185, z), (handle_x, y, z), 0.010, coll, MATERIALS['Stainless steel']))
        for z in [0.30, 1.70]:
            fixed = cylinder(f'Door {side} hinge barrel', (hinge_x, -1.193, z - 0.035), (hinge_x, -1.193, z + 0.035), 0.011, coll, MATERIALS['Stainless steel'])
            fixed.parent = root
            frame_x = hinge_x + sign * 0.022
            fixed = box('Hinge frame plate', (frame_x, -1.205, z), (0.038, 0.008, 0.062), coll, MATERIALS['Stainless steel'], 0.004)
            fixed.parent = root
            leaf_x = hinge_x - sign * 0.028
            leaf.append(box('Hinge glass clamp', (leaf_x, -1.194, z), (0.052, 0.020, 0.058), coll, MATERIALS['Stainless steel'], 0.005))
            for dz in [-0.017, 0.017]:
                screw = cylinder('Hinge fixing', (frame_x, -1.211, z + dz), (frame_x, -1.207, z + dz), 0.004, coll, MATERIALS['Graphite enamel'], 12)
                screw.parent = root
        bpy.context.view_layer.update()
        for obj in leaf:
            world = obj.matrix_world.copy()
            obj.parent = pivot
            obj.matrix_world = world
        coll['asset_id'] = f'door_{side}-hinge'
        coll['glass_thickness_metres'] = 0.008
    COLLECTIONS['Door - right hinge'].hide_render = True
    COLLECTIONS['Door - right hinge'].hide_viewport = True


def build_heaters():
    steel = MATERIALS['Stainless steel']
    dark = MATERIALS['Graphite enamel']
    for variant in ['integrated', 'external']:
        coll = COLLECTIONS[f'Heater - {variant} control']
        root = bpy.data.objects.new(f'heater_{variant}-control', None)
        coll.objects.link(root)
        root['asset_id'] = root.name
        root['rated_power_kw'] = 3.6
        root['geometry_status'] = 'Provisional envelope; detailed manufacturer dimensions unavailable in supplied brief.'
        box('Heater casing', (0.45, -0.86, 0.40), (0.28, 0.24, 0.46), coll, steel, 0.012)
        box('Heater front inset', (0.45, -0.983, 0.39), (0.239, 0.008, 0.366), coll, dark, 0.006)
        for z in [0.25, 0.31, 0.37, 0.43, 0.49, 0.55]:
            box('Front ventilation slot', (0.45, -0.988, z), (0.195, 0.003, 0.009), coll, MATERIALS['Door seal'], 0.002)
        for z in [0.23, 0.55]:
            box('Right wall mounting bracket', (0.6225, -0.86, z), (0.065, 0.16, 0.028), coll, steel)
        box('Stone tray', (0.45, -0.86, 0.63), (0.265, 0.225, 0.014), coll, dark, 0.003)
        for z in [0.655, 0.706]:
            for y in [-0.977, -0.743]:
                cylinder('Stainless rack rail', (0.316, y, z), (0.584, y, z), 0.005, coll, steel)
            for x in [0.316, 0.584]:
                cylinder('Stainless rack side', (x, -0.977, z), (x, -0.743, z), 0.005, coll, steel)
        for x in [0.316, 0.45, 0.584]:
            for y in [-0.977, -0.743]:
                cylinder('Rack upright', (x, y, 0.633), (x, y, 0.711), 0.004, coll, steel, 16)
        rng = random.Random(49)
        for row in range(3):
            for column in range(4):
                bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1,
                    location=(0.35 + column * 0.067 + rng.uniform(-0.006, 0.006),
                              -0.938 + row * 0.077 + rng.uniform(-0.006, 0.006), 0.671 + rng.uniform(-0.004, 0.01)))
                stone = bpy.context.object
                stone.dimensions = (0.063, 0.069, 0.064)
                stone.rotation_euler = [rng.random() * 3 for _ in range(3)]
                for vertex in stone.data.vertices:
                    vertex.co *= rng.uniform(0.85, 1.13)
                finish(stone, f'Sauna stone {row * 4 + column + 1:02}', coll, MATERIALS['Sauna stones'])
                bpy.context.view_layer.update()
                bottom = min((stone.matrix_world @ Vector(p)).z for p in stone.bound_box)
                stone.location.z += 0.637 - bottom
        if variant == 'integrated':
            box('Side-mounted control housing', (0.294, -0.863, 0.29), (0.032, 0.157, 0.14), coll, dark, 0.008)
            for y in [-0.903, -0.823]:
                cylinder('Integrated control dial', (0.278, y, 0.29), (0.261, y, 0.29), 0.022, coll, MATERIALS['Door seal'])
                box('Dial index', (0.260, y, 0.304), (0.002, 0.0025, 0.009), coll, steel, 0.0004)
        else:
            box('External wall controller', (0.115, -1.22, 1.37), (0.088, 0.04, 0.138), coll, dark, 0.008)
            screen = material('Controller screen', (0.08, 0.15, 0.13), roughness=0.23)
            box('Controller display', (0.115, -1.241, 1.395), (0.06, 0.003, 0.037), coll, screen, 0.002)
            cylinder('External controller dial', (0.115, -1.242, 1.335), (0.115, -1.25, 1.335), 0.012, coll, steel)
        for obj in list(coll.objects):
            if obj != root:
                obj.parent = root
        coll['asset_id'] = root.name
    COLLECTIONS['Heater - external control'].hide_render = True
    COLLECTIONS['Heater - external control'].hide_viewport = True


def finalize_presentation():
    for obj in COLLECTIONS['Scale reference - 1700mm'].objects:
        obj.location.y -= 0.85
    camera = bpy.context.scene.camera
    camera.location = (3.25, -5.2, 2.85)
    point_at(camera, (-0.22, -0.67, 1.0))
    camera.data.ortho_scale = 3.45
    # Spare camera shows seating, controls and the opening swing from above.
    bpy.ops.object.camera_add(location=(2.7, -4.0, 3.4))
    detail = bpy.context.object
    detail.name = 'Camera - cutaway'
    move_to(detail, COLLECTIONS['Presentation'])
    point_at(detail, (0, -0.55, 0.95))
    detail.data.type = 'ORTHO'
    detail.data.ortho_scale = 2.9
    bpy.context.scene.camera = camera
    bpy.context.scene['active_configuration'] = 'Left hinge / integrated control'
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
            area.spaces.active.region_3d.view_camera_zoom = 10
    bpy.ops.object.select_all(action='DESELECT')


if __name__ == '__main__':
    setup()
    build_cabin()
    build_reference()
    presentation()
    timber_textures()
    build_doors()
    build_heaters()
    finalize_presentation()
    save('sauna-pilot.blend')
