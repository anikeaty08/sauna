"""Refine the sauna's material finish, concealed lighting and product framing."""

import bpy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sauna_geometry', ROOT / 'blender' / 'build_sauna.py')
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)


def style_sauna():
    scene = bpy.context.scene
    if scene.get('aesthetic_finish'):
        raise RuntimeError('The aesthetic finish has already been applied.')
    geo.COLLECTIONS.update({c.name: c for c in scene.collection.children})
    geo.MATERIALS.update({m.name: m for m in bpy.data.materials})
    for name in ['Spruce', 'Bench timber']:
        mat = geo.MATERIALS[name]
        nodes = mat.node_tree.nodes
        texture = next(n for n in nodes if n.type == 'TEX_IMAGE')
        tone = nodes.new('ShaderNodeHueSaturation')
        tone.name = 'Natural pale timber finish'
        tone.inputs['Saturation'].default_value = 0.82
        tone.inputs['Value'].default_value = 1.035
        mat.node_tree.links.new(texture.outputs['Color'], tone.inputs['Color'])
        mat.node_tree.links.new(tone.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
        nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.58
    for obj in scene.objects:
        if obj.name.startswith(('Upper bench slat', 'Lower step slat', 'Backrest slat')):
            obj.modifiers['Soft manufactured edges'].width = 0.005
    glass = geo.MATERIALS['Clear tempered glass - 8mm'].node_tree.nodes['Principled BSDF']
    glass.inputs['Base Color'].default_value = (0.985, 1, 0.995, 1)

    coll = geo.collection('Lighting - concealed bench glow')
    aluminium = geo.MATERIALS['Stainless steel']
    diffuser = geo.material('Concealed warm strip diffuser', (1, 0.83, 0.62), roughness=0.45)
    bsdf = diffuser.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Emission Color'].default_value = (1, 0.66, 0.36, 1)
    bsdf.inputs['Emission Strength'].default_value = 2.5
    geo.box('Concealed strip channel', (0, -0.30, 0.836), (0.98, 0.018, 0.008), coll, aluminium, 0.001)
    geo.box('Concealed strip diffuser', (0, -0.30, 0.8315), (0.962, 0.012, 0.001), coll, diffuser, 0.0003)
    data = bpy.data.lights.new('Soft under-bench light', 'AREA')
    data.energy = 7
    data.color = (1, 0.72, 0.46)
    data.shape = 'RECTANGLE'
    data.size = 0.92
    data.size_y = 0.08
    light = bpy.data.objects.new('Soft under-bench light', data)
    coll.objects.link(light)
    light.location = (0, -0.30, 0.818)
    geo.point_at(light, (0, -0.31, 0.045))
    coll['optional'] = True
    coll['asset_id'] = 'lighting_under-bench'

    floor = geo.MATERIALS['Studio floor']
    floor.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.71, 0.735, 0.72, 1)
    floor.diffuse_color = (0.71, 0.735, 0.72, 1)
    reference = geo.COLLECTIONS['Scale reference - 1700mm']
    reference.hide_render = True
    reference.hide_viewport = True
    exterior = bpy.data.objects['Camera - exterior']
    exterior.location = (3.25, -5.2, 2.85)
    geo.point_at(exterior, (0, -0.60, 1.01))
    exterior.data.ortho_scale = 3.1
    cutaway = bpy.data.objects['Camera - cutaway']
    cutaway.data.ortho_scale = 2.85
    interior = bpy.data.objects['Camera - interior']
    interior.location = (-0.20, -1.10, 1.42)
    interior.data.lens = 14
    geo.point_at(interior, (-0.01, -0.30, 1.05))
    scene.camera = exterior
    scene['aesthetic_finish'] = 'Pale matte timber, eased seating edges, neutral glass, shaded warm lighting, concealed bench glow.'
    scene['active_configuration'] = 'Left hinge / integrated control / shaded lamp + concealed bench glow'
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'output' / 'blender' / 'sauna-complete.blend'))
    print('Aesthetic finish saved')


if __name__ == '__main__':
    style_sauna()
