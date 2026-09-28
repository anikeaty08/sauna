"""Shared helpers for authoring configurator modules in Blender (headless).

Conventions every module follows (docs/architecture.md):
  * metres; Blender Z-up. The glTF exporter converts to Y-up, so
      Blender +X -> glTF +X (length), Blender +Z -> glTF +Y (up),
      Blender -Y -> glTF +Z (the module's front / visible face).
  * origin = the module's `base` attachment point.
  * profile modules are exactly 1.000 m along their length axis.
  * materials are named by finish slot ("slot:bench_wood", "slot:slate", ...);
    the runtime material library replaces them by name, so one slot = one
    consistent finish everywhere (no stray colours per object).
"""
from __future__ import annotations

import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]

# Finish slots: base PBR values that match the runtime material library, so a
# module looks right on its own in Blender too.
SLOTS = {
    'slot:slate':        dict(color=(0.20, 0.20, 0.21), rough=0.78, metal=0.0),
    'slot:zirbe':        dict(color=(0.74, 0.52, 0.32), rough=0.62, metal=0.0),
    'slot:bench_wood':   dict(color=(0.84, 0.74, 0.60), rough=0.60, metal=0.0),
    'slot:glass':        dict(color=(0.96, 0.98, 0.97), rough=0.02, metal=0.0, transmission=1.0),
    'slot:metal':        dict(color=(0.78, 0.78, 0.77), rough=0.32, metal=1.0),
    'slot:heater_black': dict(color=(0.03, 0.03, 0.035), rough=0.55, metal=0.25),
    'slot:stones':       dict(color=(0.16, 0.16, 0.16), rough=0.95, metal=0.0),
    'slot:display':      dict(color=(0.01, 0.01, 0.012), rough=0.08, metal=0.0),
    'slot:led':          dict(color=(1.0, 0.72, 0.42), rough=0.4, metal=0.0, emission=(1.0, 0.62, 0.3), strength=4.0),
    'slot:dial':         dict(color=(0.93, 0.92, 0.88), rough=0.5, metal=0.0),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(slot: str, image: str | None = None):
    """One material per finish slot, optionally with a real photo texture."""
    if slot in bpy.data.materials:
        return bpy.data.materials[slot]
    spec = SLOTS[slot]
    mat = bpy.data.materials.new(slot)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*spec['color'], 1.0)
    bsdf.inputs['Roughness'].default_value = spec['rough']
    bsdf.inputs['Metallic'].default_value = spec['metal']
    if spec.get('transmission'):
        bsdf.inputs['Transmission Weight'].default_value = spec['transmission']
        bsdf.inputs['IOR'].default_value = 1.5
    if spec.get('emission'):
        bsdf.inputs['Emission Color'].default_value = (*spec['emission'], 1.0)
        bsdf.inputs['Emission Strength'].default_value = spec['strength']
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(image), check_existing=True)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def _uv_box(bm: bmesh.types.BMesh, tile: float = 1.0):
    """World-scale box projection (1 UV unit = `tile` metres)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co[a] / tile, co[b] / tile)


def _object(name: str, bm: bmesh.types.BMesh, mat, parent=None, uv_tile: float = 1.0):
    bm.normal_update()
    _uv_box(bm, uv_tile)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    for p in mesh.polygons:
        p.use_smooth = False
    return obj


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0, parent=None, uv_tile=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z0 + (v.co.z + 0.5) * (z1 - z0)))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES', profile=0.5)
    return _object(name, bm, mat, parent, uv_tile)


def cylinder(name, radius, depth, center, mat, axis='Z', segments=32, parent=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if len(e.link_faces) == 2 and abs(e.calc_face_angle(0)) > 0.8], offset=bevel, segments=2, affect='EDGES')
    rot = {'Z': None, 'X': ('Y', math.pi / 2), 'Y': ('X', math.pi / 2)}[axis]
    if rot:
        from mathutils import Matrix
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]))
    # Mesh stays centred on the object origin, the object sits at `center`, so a
    # later rotation turns the part about itself, not about the module origin.
    obj = _object(name, bm, mat, parent)
    obj.location = Vector(center)
    return obj


def extrude_profile(name, profile_yz, length, mat, parent=None, uv_tile=1.0):
    """Extrude a closed 2D profile (list of (y, z) points, CCW seen from +X) along +X."""
    bm = bmesh.new()
    ring0 = [bm.verts.new((0.0, y, z)) for y, z in profile_yz]
    ring1 = [bm.verts.new((length, y, z)) for y, z in profile_yz]
    n = len(profile_yz)
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _object(name, bm, mat, parent, uv_tile)


def empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def tag(obj, **extras):
    """glTF extras: the runtime reads module id, kind, attachment points."""
    for k, v in extras.items():
        obj[k] = v
    return obj


def validate(module_id: str, root, allowed_slots: set[str]):
    """Fail the build rather than ship a module that breaks the conventions."""
    problems = []
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            for m in obj.data.materials:
                if m is None or m.name not in allowed_slots:
                    problems.append(f'{obj.name}: material {m and m.name} not in {sorted(allowed_slots)}')
            if not obj.data.uv_layers:
                problems.append(f'{obj.name}: no UVs')
    if root.parent is not None or tuple(root.location) != (0.0, 0.0, 0.0):
        problems.append('root must sit at the origin')
    if problems:
        raise SystemExit(f'[{module_id}] invalid module:\n  ' + '\n  '.join(problems))


def save_and_export(blend_path: Path, glb_path: Path):
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format='GLB', use_selection=False,
        export_extras=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_image_format='JPEG', export_image_quality=85,
    )
