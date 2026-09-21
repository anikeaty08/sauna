"""Bake the finished timber on a calibrated UV plane for portable glTF materials."""

import bpy
from pathlib import Path


def prepare_materials(output):
    textures = Path(output) / 'textures' / 'gltf'
    textures.mkdir(parents=True, exist_ok=True)
    source_scene = bpy.context.scene
    bake_scene = bpy.data.scenes.new('Temporary material baking')
    bpy.context.window.scene = bake_scene
    bake_scene.render.engine = 'CYCLES'
    bake_scene.cycles.device = 'CPU'
    bake_scene.cycles.samples = 1
    bake_scene.render.bake.margin = 0
    replacements = {}
    try:
        for name in ['Spruce', 'Bench timber']:
            source = bpy.data.materials[name]
            material = source.copy()
            material.name = name + ' - portable finish'
            bpy.ops.mesh.primitive_plane_add(size=2)
            plane = bpy.context.object
            # Matches the physical UV scale used by build_sauna.box.
            plane.scale = (0.8, 0.12, 1)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            plane.data.materials.append(material)
            nodes = material.node_tree.nodes
            target = nodes.new('ShaderNodeTexImage')
            maps = {}
            for channel, bake_type in [('color', 'DIFFUSE'), ('normal', 'NORMAL')]:
                texture = bpy.data.images.new(name + ' baked ' + channel, width=1024, height=256)
                texture.colorspace_settings.name = 'sRGB' if channel == 'color' else 'Non-Color'
                target.image = texture
                nodes.active = target
                if channel == 'color':
                    bpy.ops.object.bake(type=bake_type, pass_filter={'COLOR'})
                else:
                    bpy.ops.object.bake(type=bake_type, normal_space='TANGENT')
                texture.filepath_raw = str(textures / (name.lower().replace(' ', '-') + '-' + channel + '.png'))
                texture.file_format = 'PNG'
                texture.save()
                texture.pack()
                maps[channel] = texture
            shader = nodes.get('Principled BSDF')
            # Keep only the supported shader and output; source material is untouched.
            for node in list(nodes):
                if node != shader and node.type != 'OUTPUT_MATERIAL':
                    nodes.remove(node)
            color = nodes.new('ShaderNodeTexImage')
            color.image = maps['color']
            normal_texture = nodes.new('ShaderNodeTexImage')
            normal_texture.image = maps['normal']
            normal = nodes.new('ShaderNodeNormalMap')
            material.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
            material.node_tree.links.new(normal_texture.outputs['Color'], normal.inputs['Color'])
            material.node_tree.links.new(normal.outputs['Normal'], shader.inputs['Normal'])
            replacements[source.name] = material
            bpy.data.objects.remove(plane, do_unlink=True)
        return replacements
    finally:
        bpy.context.window.scene = source_scene
        bpy.data.scenes.remove(bake_scene)
