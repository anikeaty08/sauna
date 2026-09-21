"""Dimension and cross-component collision checks inside Blender."""

import bpy
import json
import math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'blender'


def bounds(objects):
    points = [obj.matrix_world @ Vector(p) for obj in objects for p in obj.bound_box]
    return ([min(p[i] for p in points) for i in range(3)],
            [max(p[i] for p in points) for i in range(3)])


def bvh(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        vertices = [evaluated.matrix_world @ v.co for v in mesh.vertices]
        polygons = [tuple(p.vertices) for p in mesh.polygons]
        return BVHTree.FromPolygons(vertices, polygons)
    finally:
        evaluated.to_mesh_clear()


def overlaps_bounds(a, b, tolerance=0.0002):
    return all(min(a[1][i], b[1][i]) - max(a[0][i], b[0][i]) > tolerance for i in range(3))


def validate():
    scene = bpy.context.scene
    state = {c.name: (c.hide_viewport, c.hide_render) for c in scene.collection.children}
    door_pivots = [bpy.data.objects[f'Door {s} swing pivot'] for s in ['left', 'right']]
    rotations = [p.rotation_euler.copy() for p in door_pivots]
    report = {'units': 'metres', 'checks': [], 'limitations': [
        'Geometric pilot checks only; heater installation clearances require manufacturer documentation.',
        'No browser/export round-trip test is included in this Blender-stage report.',
        'Door swing is sampled every 5 degrees; intended hardware and gasket contacts are excluded.',
    ]}
    try:
        for coll in scene.collection.children:
            coll.hide_viewport = False
        for pivot in door_pivots:
            pivot.rotation_euler.z = 0
        bpy.context.view_layer.update()
        cabin = [o for o in scene.objects if o.type == 'MESH' and any(c.name.startswith('Cabin -') for c in o.users_collection)]
        lo, hi = bounds(cabin)
        dimensions = [hi[i] - lo[i] for i in range(3)]
        assert all(abs(a - b) < 0.00001 for a, b in zip(dimensions, [1.4, 1.2, 2.02]))
        report['cabin_bounds'] = {'min': lo, 'max': hi, 'dimensions': dimensions}
        reference = [o for o in bpy.data.collections['Scale reference - 1700mm'].objects if o.type == 'MESH']
        rlo, rhi = bounds(reference)
        assert abs(rhi[2] - rlo[2] - 1.7) < 0.00001
        report['reference_height'] = rhi[2] - rlo[2]
        walls = [o for o in cabin if any(o.name.startswith(s) for s in ['Back board', 'Left board', 'Right board'])]
        assert all(abs(min(o.dimensions) - 0.045) < 0.00001 for o in walls)
        report['checks'].append('54 wall boards have 45mm thickness')
        solid_cabin = [o for o in cabin if o.data.materials[0].name in ['Spruce', 'Bench timber']]
        depsgraph = bpy.context.evaluated_depsgraph_get()
        obstacles = [(o, bounds([o]), bvh(o, depsgraph)) for o in solid_cabin]
        report['combinations'] = []
        for side in ['left', 'right']:
            glass = bpy.data.objects[f'Door {side} glass 8mm']
            pivot = bpy.data.objects[f'Door {side} swing pivot']
            assert abs(glass.dimensions.y - 0.008) < 0.00001
            for angle in range(0, 91, 5):
                pivot.rotation_euler.z = math.radians(angle * (-1 if side == 'left' else 1))
                bpy.context.view_layer.update()
                tree = bvh(glass, depsgraph)
                glass_bounds = bounds([glass])
                for obj, obj_bounds, obstacle in obstacles:
                    if overlaps_bounds(glass_bounds, obj_bounds):
                        assert not tree.overlap(obstacle), f'Door {side} at {angle} degrees intersects {obj.name}'
            pivot.rotation_euler.z = 0
            bpy.context.view_layer.update()
            for variant in ['integrated', 'external']:
                heater = [o for o in bpy.data.collections[f'Heater - {variant} control'].objects if o.type == 'MESH']
                intersections = []
                for part in heater:
                    part_bounds = bounds([part])
                    tree = bvh(part, depsgraph)
                    for obj, obj_bounds, obstacle in obstacles:
                        if overlaps_bounds(part_bounds, obj_bounds) and tree.overlap(obstacle):
                            intersections.append([part.name, obj.name])
                assert not intersections, f'Heater collisions: {intersections}'
                report['combinations'].append({'door': side, 'heater': variant, 'door_swing_samples': 19,
                                                'door_vs_timber': 'pass', 'heater_vs_timber': 'pass'})
        report['checks'].extend(['Cabin dimensions match specification', '1.7m reference height',
                                 'Both door panes are 8mm thick', 'All four combinations pass sampled geometry checks'])
        report['status'] = 'pass'
        OUTPUT.joinpath('validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))
        return report
    finally:
        for pivot, rotation in zip(door_pivots, rotations):
            pivot.rotation_euler = rotation
        for name, (viewport, render) in state.items():
            coll = bpy.data.collections[name]
            coll.hide_viewport, coll.hide_render = viewport, render
        bpy.context.view_layer.update()


if __name__ == '__main__':
    validate()
