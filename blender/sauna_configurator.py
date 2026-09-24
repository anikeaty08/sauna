"""Parametric sauna configurator for Blender 5.x.

Builds a complete sauna from a configuration dictionary using the option
catalog in ``catalog.json`` (holzsauna.ch nach-Mass ranges plus the Espoo
quote).  Every generated object carries ``sku``, ``name_de``, ``price_chf``,
``dims_mm`` and ``category`` custom properties, which are exported as glTF
``extras`` so a viewer can show size and price on hover.

Usage inside Blender (Text editor or the MCP connection)::

    exec(compile(open(r'...\\blender\\sauna_configurator.py', encoding='utf-8').read(), 'sauna', 'exec'), {'__name__': '__main__', '__file__': r'...\\blender\\sauna_configurator.py'})

That registers the "Sauna" sidebar tab (N panel in the 3D viewport) and
builds the default configuration.

Headless::

    blender -b --python blender/sauna_configurator.py -- --config cfg.json --save out.blend --glb out.glb --json out.json --render prefix
"""

import bpy
import bmesh
import json
import math
import random
import sys
from pathlib import Path
from mathutils import Vector, Matrix

try:
    HERE = Path(__file__).resolve().parent
except NameError:  # pasted into the Blender text editor
    HERE = Path(bpy.data.filepath).resolve().parent.parent.parent / 'blender' if bpy.data.filepath else Path.cwd()
ROOT = HERE.parent
CATALOG = json.loads((HERE / 'catalog.json').read_text(encoding='utf-8'))
TOP_COLLECTION = 'Sauna configurator'
SECTIONS = ['Cabin - back', 'Cabin - left', 'Cabin - front', 'Cabin - right', 'Cabin - corner',
            'Cabin - roof', 'Door', 'Interior - benches', 'Heater', 'Control', 'Lighting',
            'Accessories', 'Ventilation']

DEFAULT_CONFIG = {
    'family': 'fichte',
    'width_cm': 200,
    'depth_cm': 180,
    'height_cm': 202,
    'board_orientation': 'horizontal',
    'cladding': 'none',          # none | schiefer | altholz
    'entry': 'front',            # front | corner | glasfront | corner_glasfront | glass_corner
    'door': {'hinge': 'left', 'position': 'left', 'corner': 'right'},
    'window': 'auto',            # auto | none | <width cm>
    'interior': {
        'material': 'espe_exklusiv_gerade',
        'layout': 'L',           # straight | L | U
        'upper_depth_cm': 50, 'lower_depth_cm': 30,
        'upper_height_cm': 86, 'lower_height_cm': 44,
        'backrests': True, 'side_backrests': True, 'apron': True,
        'floor_grate': True, 'headrests': 2, 'sliding_stool': True,
    },
    'heater': {'sku': 'HARVIA-VIRTA-90', 'position': 'front_right'},
    'control': 'UKU-WIFI-CB',
    'lighting': ['ZS2', 'LED-2.5'],
    'accessories': ['S2340'],
    'ventilation': True,
    'services': ['M', 'L1'],
}


# ----------------------------------------------------------------------------
# Small geometry helpers (data API only, so they work headless and in the UI)
# ----------------------------------------------------------------------------

def get_collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if coll.name not in parent.children:
        parent.children.link(coll)
    return coll


def clear_collection(coll):
    for obj in list(coll.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and getattr(data, 'users', 1) == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)


def assign_uvs(obj, scale=(1.6, 0.24)):
    """Planar per-face mapping; grain runs along the object's longest axis."""
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name='UVMap')
    uv = mesh.uv_layers.active
    coords = [v.co for v in mesh.vertices]
    if not coords:
        return
    extent = [max(c[i] for c in coords) - min(c[i] for c in coords) for i in range(3)]
    grain_axis = max(range(3), key=lambda i: extent[i])
    offset = (hash(obj.name) % 977) / 977
    for polygon in mesh.polygons:
        normal_axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        axes = [i for i in range(3) if i != normal_axis]
        u_axis = grain_axis if grain_axis in axes else axes[0]
        v_axis = next(i for i in axes if i != u_axis)
        for loop_index in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (co[u_axis] / scale[0] + offset, co[v_axis] / scale[1] + offset)


def new_object(name, bm, coll, mat, bevel=0.001, smooth=False, uvs=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    if mat is not None:
        mesh.materials.append(mat)
    if smooth:
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    if uvs:
        assign_uvs(obj)
    if bevel:
        modifier = obj.modifiers.new('Soft edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3 if bevel < 0.006 else 5
        modifier.limit_method = 'ANGLE'
    return obj


def box(name, center, size, coll, mat, bevel=0.001, rot_z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if rot_z:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, 'Z'), verts=bm.verts)
    obj = new_object(name, bm, coll, mat, bevel)
    obj.location = center
    return obj


def prism(name, points, z0, z1, coll, mat, bevel=0.001):
    """Vertical prism over a counter-clockwise 2D polygon."""
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    cz = (z0 + z1) / 2
    bm = bmesh.new()
    bottom = [bm.verts.new((x - cx, y - cy, z0 - cz)) for x, y in points]
    top = [bm.verts.new((x - cx, y - cy, z1 - cz)) for x, y in points]
    bm.faces.new(bottom[::-1])
    bm.faces.new(top)
    n = len(points)
    for i in range(n):
        bm.faces.new((bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]))
    bm.normal_update()
    obj = new_object(name, bm, coll, mat, bevel)
    obj.location = (cx, cy, cz)
    return obj


def cylinder(name, a, b, radius, coll, mat, vertices=24, bevel=None):
    a, b = Vector(a), Vector(b)
    delta = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=vertices, radius1=radius, radius2=radius, depth=delta.length)
    obj = new_object(name, bm, coll, mat, min(radius / 5, 0.002) if bevel is None else bevel, smooth=True)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    obj.location = (a + b) / 2
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    return obj


def ellipsoid(name, center, size, coll, mat, subdivisions=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=0.5)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    obj = new_object(name, bm, coll, mat, 0, smooth=True)
    obj.location = center
    return obj


def empty(name, coll, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.1
    obj.empty_display_type = 'PLAIN_AXES'
    coll.objects.link(obj)
    obj.location = location
    return obj


def tag(objects, category, sku, name_de, price, dims_mm, **extra):
    """Attach the metadata that the viewer shows on hover."""
    if not isinstance(objects, (list, tuple)):
        objects = [objects]
    for obj in objects:
        obj['category'] = category
        obj['sku'] = sku
        obj['name_de'] = name_de
        obj['price_chf'] = float(price)
        obj['dims_mm'] = 'x'.join(str(int(round(v))) for v in dims_mm)
        for key, value in extra.items():
            obj[key] = value
    return objects


def offset_polygon(points, distance):
    """Inward offset of a CCW polygon with mitred corners."""
    n = len(points)
    lines = []
    for i in range(n):
        p0, p1 = Vector(points[i]), Vector(points[(i + 1) % n])
        d = (p1 - p0).normalized()
        normal = Vector((-d.y, d.x))
        lines.append((p0 + normal * distance, d))
    result = []
    for i in range(n):
        (a, da), (b, db) = lines[i - 1], lines[i]
        cross = da.x * db.y - da.y * db.x
        if abs(cross) < 1e-9:
            result.append(tuple(b))
        else:
            t = ((b - a).x * db.y - (b - a).y * db.x) / cross
            result.append(tuple(a + da * t))
    return result


def clip_polygon(subject, clip):
    """Sutherland-Hodgman clip of a polygon against a convex CCW polygon."""
    output = list(subject)
    n = len(clip)
    for i in range(n):
        a, b = Vector(clip[i]), Vector(clip[(i + 1) % n])
        edge = b - a
        inside = lambda p: edge.x * (p[1] - a.y) - edge.y * (p[0] - a.x) >= -1e-9
        input_list, output = output, []
        if not input_list:
            break
        s = input_list[-1]
        for e in input_list:
            if inside(e):
                if not inside(s):
                    output.append(intersect(s, e, a, b))
                output.append(e)
            elif inside(s):
                output.append(intersect(s, e, a, b))
            s = e
    return output


def intersect(p, q, a, b):
    p, q, a, b = Vector(p), Vector(q), Vector(a), Vector(b)
    d1, d2 = q - p, b - a
    cross = d1.x * d2.y - d1.y * d2.x
    if abs(cross) < 1e-12:
        # p-q runs parallel to (or exactly along) the clip edge a-b; there is
        # no unique crossing point, so the segment already lies on the
        # boundary and q is the correct Sutherland-Hodgman output point.
        return tuple(q)
    t = ((a - p).x * d2.y - (a - p).y * d2.x) / cross
    return tuple(p + d1 * t)


def subtract_intervals(span, holes):
    """Return the parts of [span0, span1] not covered by any (h0, h1) hole."""
    pieces = [list(span)]
    for h0, h1 in holes:
        next_pieces = []
        for a, b in pieces:
            if h1 <= a or h0 >= b:
                next_pieces.append([a, b])
            else:
                if h0 > a:
                    next_pieces.append([a, h0])
                if h1 < b:
                    next_pieces.append([h1, b])
        pieces = next_pieces
    return [(a, b) for a, b in pieces if b - a > 0.004]


# ----------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------

def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0, transmission=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if transmission:
        bsdf.inputs['Transmission Weight'].default_value = transmission
        bsdf.inputs['IOR'].default_value = 1.45
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def wood_material(wood_key):
    spec = CATALOG['woods'][wood_key]
    name = f'Wood - {wood_key}'
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = material(name, spec['color'], roughness=0.55)
    try:
        import numpy as np
    except ImportError:
        return mat
    u, v = np.meshgrid(np.linspace(0, 1, 1024), np.linspace(0, 1, 256))
    rng = np.random.default_rng(abs(hash(wood_key)) % 1000)
    warp = v + 0.014 * np.sin(u * 8 + v * 9) + 0.004 * np.sin(u * 21 + v * 16)
    broad = np.sin(warp * 95 + np.sin(warp * 47) * 1.7)
    fine = np.sin(warp * 410 + np.sin(u * 18) * 2)
    grain = (0.020 * broad + 0.006 * fine + rng.normal(0, 0.003, u.shape)) * spec['grain']
    if spec.get('knots'):
        for cx, cy, radius in [(0.22, 0.31, 0.034), (0.73, 0.77, 0.025)]:
            distance = np.sqrt(((u - cx) * 2.9) ** 2 + ((v - cy) * 0.62) ** 2)
            grain -= 0.16 * np.exp(-(distance / radius) ** 2)
            grain += 0.024 * np.sin(distance * 650) * np.exp(-(distance / (radius * 2.8)) ** 2)
    pixels = np.ones((256, 1024, 4), dtype=np.float32)
    pixels[:, :, :3] = np.clip(np.array(spec['color'])[None, None, :] + grain[:, :, None], 0, 1)
    image = bpy.data.images.new(name + ' grain', width=1024, height=256)
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    node.label = 'Generated grain'
    mat.node_tree.links.new(node.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return mat


def materials():
    return {
        'steel': material('Stainless steel', (0.48, 0.52, 0.55), metallic=0.92, roughness=0.28),
        'black': material('Black enamel', (0.035, 0.042, 0.045), metallic=0.55, roughness=0.32),
        'alu': material('Anodised aluminium', (0.62, 0.64, 0.66), metallic=0.85, roughness=0.35),
        'seal': material('Door seal', (0.017, 0.02, 0.019), roughness=0.76),
        'stones': material('Sauna stones', (0.09, 0.095, 0.09), roughness=0.92),
        'glass': material('Clear tempered glass - 8mm', (0.96, 0.99, 0.98), roughness=0.025, transmission=1.0, alpha=0.2),
        'ceramic': material('Red ceramic', (0.55, 0.12, 0.08), roughness=0.35),
        'white': material('White plastic', (0.9, 0.9, 0.88), roughness=0.4),
        'gold': material('Gold glass', (0.85, 0.65, 0.3), metallic=0.9, roughness=0.15),
        'mirror': material('Mirror glass', (0.9, 0.9, 0.92), metallic=1.0, roughness=0.05),
        'screen': material('Controller screen', (0.08, 0.15, 0.13), roughness=0.23, emission=(0.2, 0.6, 0.5), strength=0.6),
        'led_warm': material('LED warm white', (1, 0.85, 0.6), roughness=0.5, emission=(1, 0.72, 0.4), strength=6),
        'led_rgb': material('LED RGB', (0.9, 0.6, 1), roughness=0.5, emission=(0.6, 0.35, 1), strength=5),
        'opal': material('Opal diffuser', (1, 0.95, 0.85), roughness=0.6, emission=(1, 0.8, 0.55), strength=3),
        'bucket_black': material('Matte black bucket', (0.04, 0.04, 0.045), roughness=0.7),
        'sand': material('Sand', (0.9, 0.82, 0.55), roughness=0.9),
        'studio': material('Studio floor', (0.38, 0.42, 0.43), roughness=0.85),
        'grate_black': material('Black steel plate', (0.03, 0.03, 0.03), metallic=0.4, roughness=0.5),
        'slate': material('Slate cladding', (0.075, 0.08, 0.085), roughness=0.62),
    }


# ----------------------------------------------------------------------------
# Configuration handling and pricing
# ----------------------------------------------------------------------------

def normalise(config):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    for key, value in (config or {}).items():
        if isinstance(value, dict) and isinstance(cfg.get(key), dict):
            cfg[key].update(value)
        else:
            cfg[key] = value
    family = CATALOG['families'][cfg['family']]
    if cfg['interior']['material'] not in family['interior_options']:
        cfg['interior']['material'] = family['interior_default']
    if cfg['entry'] not in family['entries']:
        cfg['entry'] = family['entries'][0]
    if cfg.get('cladding', 'none') not in CATALOG['claddings']:
        cfg['cladding'] = 'none'
    return cfg


def price_cabin(cfg, warnings):
    family = CATALOG['families'][cfg['family']]
    w, d, h = cfg['width_cm'], cfg['depth_cm'], cfg['height_cm']
    if 'sizes' in family:
        match = next((s for s in family['sizes'] if s['w'] == w and s['d'] == d), None)
        if match is None:
            match = min(family['sizes'], key=lambda s: abs(s['w'] - w) + abs(s['d'] - d))
            warnings.append(f'{w}x{d} cm ist keine Espoo-Standardgroesse; Preis der naechsten Groesse {match["w"]}x{match["d"]} verwendet (auf Anfrage).')
        base = match['price']
        note = f'Aktionspreis CHF {match["aktion"]} solange Vorrat'
        surcharge_w = surcharge_d = 0
    else:
        base = family['base_price']
        note = ''

        def lookup(table, value, label):
            steps = sorted(int(k) for k in table)
            if str(value) in table:
                return table[str(value)]
            larger = [s for s in steps if s >= value]
            if not larger:
                warnings.append(f'{label} {value} cm liegt ueber dem Konfigurator-Maximum {steps[-1]} cm (auf Anfrage).')
                return table[str(steps[-1])]
            warnings.append(f'{label} {value} cm ist ein Zwischenmass; Aufpreis der Stufe {larger[0]} cm verwendet.')
            return table[str(larger[0])]
        surcharge_w = lookup(family['width_cm'], w, 'Breite')
        surcharge_d = lookup(family['depth_cm'], d, 'Tiefe')
    if h != family['height_cm']:
        warnings.append(f'Hoehe {h} cm weicht vom Standard {family["height_cm"]} cm ab (auf Anfrage).')
    return base, surcharge_w, surcharge_d, note


def price_items(cfg):
    """Line items for the configuration; returns (items, total, warnings)."""
    warnings = []
    family = CATALOG['families'][cfg['family']]
    items = []
    base, sw, sd, note = price_cabin(cfg, warnings)
    items.append({'category': 'cabin', 'sku': family['sku'], 'name_de': f'{family["name_de"]} {cfg["width_cm"]}x{cfg["depth_cm"]}x{cfg["height_cm"]} cm',
                  'qty': 1, 'price_chf': base, 'note': note})
    if sw:
        items.append({'category': 'cabin', 'sku': 'BREITE', 'name_de': f'Aufpreis Breite {cfg["width_cm"]} cm', 'qty': 1, 'price_chf': sw, 'note': ''})
    if sd:
        items.append({'category': 'cabin', 'sku': 'TIEFE', 'name_de': f'Aufpreis Tiefe {cfg["depth_cm"]} cm', 'qty': 1, 'price_chf': sd, 'note': ''})
    entry_price = family.get('entry_prices', {}).get(cfg['entry'], 0)
    if entry_price:
        items.append({'category': 'cabin', 'sku': 'EINSTIEG', 'name_de': 'Aufpreis ' + CATALOG['entries'][cfg['entry']]['name_de'], 'qty': 1, 'price_chf': entry_price, 'note': ''})
    if family.get('window_price') and cfg['entry'] in ('front', 'corner') and cfg['window'] != 'none':
        items.append({'category': 'cabin', 'sku': 'FENSTER', 'name_de': 'Aufpreis grosses Fenster', 'qty': 1, 'price_chf': family['window_price'], 'note': ''})
    cladding = CATALOG['claddings'][cfg.get('cladding', 'none')]
    if cladding['price']:
        items.append({'category': 'cabin', 'sku': 'VERKLEIDUNG-' + cfg['cladding'].upper(), 'name_de': cladding['name_de'], 'qty': 1, 'price_chf': cladding['price'], 'note': cladding.get('price_note', '')})
    interior = CATALOG['interiors'][cfg['interior']['material']]
    items.append({'category': 'interior', 'sku': cfg['interior']['material'], 'name_de': f'Inneneinrichtung {interior["name_de"]}',
                  'qty': 1, 'price_chf': interior['price'], 'note': interior.get('note', '')})
    heater = CATALOG['heaters'].get(cfg['heater']['sku'])
    if heater:
        volume = cfg['width_cm'] * cfg['depth_cm'] * cfg['height_cm'] / 1e6
        note = 'Masse ca.' if heater.get('approx') else ''
        if not (heater['m3'][0] <= volume <= heater['m3'][1]):
            warnings.append(f'Ofen {cfg["heater"]["sku"]} ist fuer {heater["m3"][0]}-{heater["m3"][1]} m3 ausgelegt; Kabine hat {volume:.1f} m3.')
        items.append({'category': 'heater', 'sku': cfg['heater']['sku'], 'name_de': heater['name_de'], 'qty': 1,
                      'price_chf': heater['price'], 'note': (heater.get('price_note', '') + ' ' + note).strip()})
        control = CATALOG['controls'].get(cfg['control'], CATALOG['controls']['none'])
        if heater['control'] == 'external' and cfg['control'] == 'none':
            warnings.append('Dieser Ofen benoetigt eine externe Saunasteuerung.')
        if heater['control'] in ('integrated', 'none') and cfg['control'] != 'none':
            warnings.append('Ofen hat eine integrierte Steuerung / ist holzbefeuert; externe Steuerung ist nicht erforderlich.')
        if cfg['control'] != 'none':
            items.append({'category': 'control', 'sku': cfg['control'], 'name_de': control['name_de'], 'qty': 1, 'price_chf': control['price'], 'note': ''})
    for sku in cfg['lighting']:
        spec = CATALOG['lighting'].get(sku)
        if spec:
            items.append({'category': 'lighting', 'sku': sku, 'name_de': spec['name_de'], 'qty': 1, 'price_chf': spec['price'], 'note': ''})
    for sku in cfg['accessories']:
        spec = CATALOG['accessories'].get(sku)
        if spec:
            if spec.get('requires') and spec['requires'] not in cfg['accessories']:
                warnings.append(f'{sku} benoetigt {spec["requires"]}.')
            items.append({'category': 'accessory', 'sku': sku, 'name_de': spec['name_de'], 'qty': 1, 'price_chf': spec['price'], 'note': spec.get('price_note', '')})
    for sku in cfg['services']:
        spec = CATALOG['services'].get(sku)
        if spec:
            items.append({'category': 'service', 'sku': sku, 'name_de': spec['name_de'], 'qty': 1, 'price_chf': spec['price'], 'note': ''})
    if any(CATALOG['lighting'].get(s, {}).get('kind') in ('backrest_strip', 'under_bench') for s in cfg['lighting']) and 'M' in cfg['services'] and 'M-LED' not in cfg['services']:
        warnings.append('LED-Beleuchtung mit Montage: Aufpreis M-LED (CHF 150) fehlt.')
    total = round(sum(i['price_chf'] * i['qty'] for i in items), 2)
    return items, total, warnings


# ----------------------------------------------------------------------------
# Reusable component builders (shared with export_library.py)
# ----------------------------------------------------------------------------

def heater_parts(spec, coll, mats, cx, wall_y, z_base, at_back, side):
    """Build a heater against a wall at ``wall_y``; the room is toward +Y for a
    front wall (``at_back`` False) and toward -Y for the back wall."""
    w, d, h = [v / 1000 for v in spec['dims_mm']]
    r = -1 if at_back else 1                      # direction into the room
    gap = 0.0 if spec['mount'] == 'wall' else 0.05
    y_near, y_far = wall_y + r * gap, wall_y + r * (gap + d)
    y0, y1 = min(y_near, y_far), max(y_near, y_far)
    cy = (y0 + y1) / 2
    z0 = z_base + (0.15 if spec['mount'] == 'wall' else 0.0)
    body_mat = mats['black'] if spec['color'] == 'black' else mats['steel']
    parts = []
    if spec['shape'] == 'cylinder':
        parts.append(cylinder('Heater mantle', (cx, cy, z0 + 0.02), (cx, cy, z0 + h), w / 2, coll, body_mat, 48, 0.003))
        parts.append(cylinder('Heater base', (cx, cy, z0), (cx, cy, z0 + 0.02), w / 2 - 0.02, coll, mats['black'], 32))
        parts.append(box('Mantle opening', (cx, y_far + r * 0.004 - r * w / 2 + r * (w / 2), z0 + h * 0.55), (w * 0.62, 0.006, h * 0.6), coll, mats['stones'], 0.002))
        stones_z = z0 + h
        stones_area = (cx - w / 2 + 0.05, cx + w / 2 - 0.05, cy - w / 2 + 0.05, cy + w / 2 - 0.05)
    else:
        parts.append(box('Heater casing', (cx, cy, z0 + h / 2), (w, d, h), coll, body_mat, 0.012))
        front_y = y_far + r * 0.004
        parts.append(box('Heater front inset', (cx, front_y, z0 + h * 0.4), (w * 0.85, 0.008, h * 0.65), coll, mats['black'], 0.006))
        for i in range(6):
            parts.append(box('Front ventilation slot', (cx, front_y + r * 0.004, z0 + h * 0.15 + i * h * 0.1), (w * 0.7, 0.003, 0.009), coll, mats['seal'], 0.002))
        parts.append(box('Stone tray', (cx, cy, z0 + h + 0.007), (w - 0.015, d - 0.015, 0.014), coll, mats['black'], 0.003))
        for z in (z0 + h + 0.025, z0 + h + 0.075):
            for y in (y0 + 0.012, y1 - 0.012):
                parts.append(cylinder('Rack rail', (cx - w / 2 + 0.006, y, z), (cx + w / 2 - 0.006, y, z), 0.005, coll, mats['steel']))
            for x in (cx - w / 2 + 0.006, cx + w / 2 - 0.006):
                parts.append(cylinder('Rack side', (x, y0 + 0.012, z), (x, y1 - 0.012, z), 0.005, coll, mats['steel']))
        if spec['mount'] == 'wall':
            for z in (z0 + 0.08, z0 + h - 0.08):
                parts.append(box('Wall mounting bracket', (cx, wall_y + r * 0.01, z), (w * 0.5, 0.02, 0.028), coll, mats['steel']))
        stones_z = z0 + h + 0.014
        stones_area = (cx - w / 2 + 0.03, cx + w / 2 - 0.03, y0 + 0.03, y1 - 0.03)
    rng = random.Random(49)
    sx0, sx1, sy0, sy1 = stones_area
    columns = max(2, int((sx1 - sx0) / 0.068))
    rows = max(2, int((sy1 - sy0) / 0.072))
    for row in range(rows):
        for c in range(columns):
            x = sx0 + (c + 0.5) * (sx1 - sx0) / columns + rng.uniform(-0.006, 0.006)
            y = sy0 + (row + 0.5) * (sy1 - sy0) / rows + rng.uniform(-0.006, 0.006)
            stone = ellipsoid(f'Sauna stone {row * columns + c + 1:02}', (x, y, stones_z + 0.032 + rng.uniform(0, 0.012)), (0.063, 0.069, 0.064), coll, mats['stones'], 1)
            stone.rotation_euler = [rng.random() * 3 for _ in range(3)]
            parts.append(stone)
    if spec['control'] == 'integrated':
        ctrl_x = cx - side * (w / 2 + 0.016)
        parts.append(box('Side-mounted control housing', (ctrl_x, cy, z0 + 0.12), (0.032, min(0.157, d * 0.7), 0.14), coll, mats['black'], 0.008))
        for dy in (-0.04, 0.04):
            a = (ctrl_x - side * 0.016, cy + dy, z0 + 0.12)
            b = (ctrl_x - side * 0.033, cy + dy, z0 + 0.12)
            parts.append(cylinder('Integrated control dial', a, b, 0.022, coll, mats['seal']))
    if spec.get('combi'):
        tank_x = cx - side * (w / 2 + 0.05)
        parts.append(box('Steam water tank', (tank_x, cy, z0 + h * 0.35), (0.09, d * 0.8, h * 0.6), coll, body_mat, 0.006))
    if spec.get('wood_fired'):
        parts.append(box('Firebox door', (cx, y_far + r * 0.006, z0 + 0.25), (w * 0.6, 0.012, 0.3), coll, mats['steel'], 0.004))
        parts.append(cylinder('Flue pipe', (cx, cy, z0 + h), (cx, cy, z0 + h + 1.6), 0.06, coll, mats['black'], 32))
    return parts, {'y0': y0, 'y1': y1, 'z0': z0, 'stones_top': stones_z + 0.07}


def guard_parts(zone, coll, mat, x_l, x_r, y_f, y_b, gz=0.72):
    guard = []
    rails = []
    if zone[0] > x_l + 0.02:
        rails.append(((zone[0], zone[2]), (zone[0], zone[3])))
    if zone[1] < x_r - 0.02:
        rails.append(((zone[1], zone[2]), (zone[1], zone[3])))
    if zone[2] > y_f + 0.02:
        rails.append(((zone[0], zone[2]), (zone[1], zone[2])))
    if zone[3] < y_b - 0.02:
        rails.append(((zone[0], zone[3]), (zone[1], zone[3])))
    posts = set()
    for (ax, ay), (bx, by) in rails:
        size = (abs(bx - ax) + 0.035 if abs(bx - ax) > 1e-6 else 0.035, abs(by - ay) + 0.035 if abs(by - ay) > 1e-6 else 0.035, 0.038)
        guard.append(box('Heater guard rail', ((ax + bx) / 2, (ay + by) / 2, gz - 0.019), size, coll, mat, 0.003))
        posts.add((round(ax, 4), round(ay, 4)))
        posts.add((round(bx, 4), round(by, 4)))
    for px, py in posts:
        guard.append(box('Heater guard upright', (px, py, gz / 2 - 0.02), (0.028, 0.028, gz - 0.04), coll, mat, 0.002))
    return guard


def control_parts(spec, coll, mats, wood, x, y, z, side):
    """Wall controller on an exterior wall whose outward normal is ``side`` * X."""
    w, d, h = [v / 1000 for v in spec['dims_mm']]
    body = mats['black'] if spec['color'] in ('black', 'mirror', 'gold') else (mats['white'] if spec['color'] == 'white' else wood)
    parts = [box('Wall controller body', (x + side * d / 2, y, z), (d, w, h), coll, body, 0.006 if spec['series'] == 'classic' else 0.002)]
    face_mat = {'glass': {'black': mats['black'], 'mirror': mats['mirror'], 'gold': mats['gold']}}.get(spec['series'], {}).get(spec['color'], body)
    face_x = x + side * (d + 0.001)
    parts.append(box('Controller face', (face_x, y, z), (0.002, w - 0.006, h - 0.006), coll, face_mat, 0.001))
    parts.append(box('Controller display', (face_x + side * 0.001, y, z + h * 0.12), (0.002, w * 0.6, h * 0.28), coll, mats['screen'], 0.001))
    parts.append(cylinder('Controller dial', (face_x, y, z - h * 0.25), (face_x + side * 0.006, y, z - h * 0.25), 0.014, coll, mats['steel']))
    return parts


def lamp_parts(coll, mats, x, y, z, side):
    """Slatted aspen wall lamp on a wall whose inward normal is ``side`` * X."""
    espe = wood_material('espe')
    parts = [box('Lamp wall mount', (x + side * 0.013, y, z), (0.026, 0.235, 0.315), coll, espe, 0.002),
             box('Lamp opal diffuser', (x + side * 0.055, y, z), (0.05, 0.19, 0.25), coll, mats['opal'], 0.002)]
    for i in range(7):
        parts.append(box('Lamp shade slat', (x + side * 0.104, y - 0.105 + i * 0.035, z), (0.012, 0.022, 0.30), coll, espe, 0.001))
    light = bpy.data.lights.new('Sauna lamp', 'POINT')
    light.energy = 25
    light.color = (1, 0.8, 0.6)
    light.shadow_soft_size = 0.06
    lamp = bpy.data.objects.new('Sauna lamp light', light)
    coll.objects.link(lamp)
    lamp.location = (x + side * 0.06, y, z)
    parts.append(lamp)
    return parts


def bucket_parts(spec, coll, mats, x, y):
    bucket_r = 0.11 if spec['bucket_l'] >= 5 else 0.095
    bucket_mat = mats['bucket_black'] if spec['bucket'] == 'black' else wood_material('fichte')
    return [cylinder('Bucket', (x, y, 0.0), (x, y, 0.20), bucket_r, coll, bucket_mat, 32, 0.002),
            cylinder('Bucket handle', (x - bucket_r, y, 0.19), (x + bucket_r, y, 0.19), 0.006, coll, mats['steel'], 12),
            cylinder('Ladle', (x + 0.03, y + 0.05, 0.03), (x - 0.12, y - 0.08, 0.40), 0.012, coll, wood_material('fichte'), 12)]


def instrument_parts(coll, mats, x, y, z, side):
    """Climate station and hourglass on a back wall (room toward -Y)."""
    espe = wood_material('espe')
    return [box('Climate station', (x, y - 0.012, z), (0.14, 0.024, 0.20), coll, espe, 0.002),
            box('Climate dials', (x, y - 0.026, z), (0.10, 0.004, 0.16), coll, mats['white'], 0.001),
            box('Hourglass frame', (x + side * 0.25, y - 0.012, z - 0.06), (0.06, 0.024, 0.18), coll, espe, 0.002),
            cylinder('Hourglass', (x + side * 0.25, y - 0.024, z - 0.14), (x + side * 0.25, y - 0.024, z + 0.02), 0.02, coll, mats['glass'], 16, 0)]


def evaporator_parts(coll, mats, x, y, z):
    return [cylinder('Evaporator stand', (x, y, z - 0.03), (x, y, z + 0.05), 0.012, coll, mats['steel'], 16),
            cylinder('Evaporator base', (x, y, z + 0.05), (x, y, z + 0.06), 0.10, coll, mats['steel'], 32),
            cylinder('Salt evaporator pot', (x, y, z + 0.06), (x, y, z + 0.16), 0.10, coll, mats['ceramic'], 32, 0.004)]


def speaker_parts(coll, mats, x, y, z):
    """One speaker on a back wall face at ``y`` (room toward -Y)."""
    return [box('Speaker wood frame', (x, y - 0.035, z), (0.20, 0.07, 0.20), coll, wood_material('erle'), 0.003),
            cylinder('Speaker cone', (x, y - 0.07, z), (x, y - 0.075, z), 0.075, coll, mats['white'], 32)]


def ergo_backrest_parts(coll, x, y, z):
    pappel = wood_material('pappel')
    return [box(f'Ergo backrest slat {i + 1}', (x, y + 0.08 + i * 0.062, z + 0.02 + i * 0.011), (0.52, 0.05, 0.02), coll, pappel, 0.004) for i in range(6)]


def tub_parts(coll, mats, x, y, side):
    laerche = wood_material('laerche')
    tub = ellipsoid('Plunge tub', (x, y, 0.5), (1.2, 0.8, 1.6), coll, laerche, 3)
    bm = bmesh.new()
    bm.from_mesh(tub.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.5 or v.co.z < -0.5], context='VERTS')
    bm.to_mesh(tub.data)
    bm.free()
    return [tub, cylinder('Tub rim', (x, y, 0.98), (x, y, 1.0), 0.6, coll, laerche, 48, 0.003),
            box('Tub step', (x + (0.75 if side < 0 else -0.75), y, 0.25), (0.35, 0.5, 0.5), coll, laerche, 0.004)]


def lid_parts(coll, x, y):
    return [ellipsoid('Tub lid', (x, y, 1.015), (1.22, 0.82, 0.03), coll, wood_material('laerche'), 3)]


def grille_parts(coll, mat, x, y, z, r, width=0.15, slats=3, slider=False):
    """Ventilation cover on a wall face at ``y``; ``r`` is the direction into the room."""
    parts = [box('Ventilation grille', (x, y, z), (width, 0.024, 0.10), coll, mat, 0.002)]
    if slider:
        parts.append(box('Grille slider', (x, y + r * 0.016, z), (width - 0.02, 0.006, 0.05), coll, mat, 0.001))
    else:
        for i in range(slats):
            parts.append(box('Grille slat', (x, y + r * 0.014, z - 0.03 + i * 0.03), (width - 0.02, 0.006, 0.014), coll, mat, 0.001))
    return parts


# ----------------------------------------------------------------------------
# The builder
# ----------------------------------------------------------------------------

class SaunaBuilder:
    def __init__(self, config):
        self.cfg = normalise(config)
        self.family = CATALOG['families'][self.cfg['family']]
        self.warnings = []
        self.mat = materials()
        self.wall_mat = wood_material(self.family['wall_wood'])
        interior = CATALOG['interiors'][self.cfg['interior']['material']]
        self.interior = interior
        self.bench_mat = wood_material(interior['wood'])
        self.slat = interior['slat_mm'] / 1000
        self.round = 0.007 if interior['rounded'] else 0.0025
        # cabin dimensions in metres
        self.W = self.cfg['width_cm'] / 100
        self.D = self.cfg['depth_cm'] / 100
        self.H = self.cfg['height_cm'] / 100
        self.t = self.family['wall_mm'] / 1000
        self.tc = self.family['ceiling_mm'] / 1000
        self.door_w, self.door_h = [v / 1000 for v in self.family['door_mm']]
        self.frame = self.family['door_frame_mm'] / 1000
        self.z_c = self.H - self.tc                # ceiling underside
        self.z_door_top = min(self.door_h + 0.01, self.z_c - 0.03)
        self.x_l, self.x_r = -self.W / 2 + self.t, self.W / 2 - self.t
        self.y_f, self.y_b = -self.D + self.t, -self.t
        self.colls = {}
        self.door_info = None
        self.heater_zone = None                    # (x0, x1, y0, y1) incl. guard clearance
        self.heater_side = 1                       # +1 right wall, -1 left wall
        self.heater_top = None
        self.benches = []                          # dicts with bounds of upper benches
        self.lower_bench = None

    # -- scene plumbing -------------------------------------------------------
    def prepare_collections(self):
        top = get_collection(TOP_COLLECTION)
        for name in SECTIONS:
            coll = get_collection(name, top)
            clear_collection(coll)
            coll.hide_viewport = False
            coll.hide_render = False
            self.colls[name] = coll
        return top

    # -- plan geometry --------------------------------------------------------
    def plan(self):
        W, D = self.W, self.D
        cfg = self.cfg
        corner = cfg['door']['corner'] if cfg['entry'] in ('corner', 'corner_glasfront') else None
        c = (self.door_w + 2 * self.frame + 2 * 0.06) / math.sqrt(2)
        # Remembered for build_interior(): the back-wall bench sizing below
        # used to treat the cabin as a plain W x D rectangle even when this
        # corner chamfer eats into that same wall run, so the back bench (and
        # its cladding/legs, both derived from its extent) stuck straight out
        # through the angled glass corner.
        self.corner_side, self.corner_cut = corner, c
        if corner == 'right':
            points = [(W / 2, 0), (-W / 2, 0), (-W / 2, -D), (W / 2 - c, -D), (W / 2, -D + c)]
        elif corner == 'left':
            points = [(W / 2, 0), (-W / 2, 0), (-W / 2, -D + c), (-W / 2 + c, -D), (W / 2, -D)]
        else:
            points = [(W / 2, 0), (-W / 2, 0), (-W / 2, -D), (W / 2, -D)]
        self.exterior = points
        self.interior_poly = offset_polygon(points, self.t)
        self.segments = []
        n = len(points)
        for i in range(n):
            p0, p1 = Vector(points[i]), Vector(points[(i + 1) % n])
            d = (p1 - p0).normalized()
            name = 'corner'
            if abs(p0.y) < 1e-6 and abs(p1.y) < 1e-6:
                name = 'back'
            elif abs(p0.x + W / 2) < 1e-6 and abs(p1.x + W / 2) < 1e-6:
                name = 'left'
            elif abs(p0.y + D) < 1e-6 and abs(p1.y + D) < 1e-6:
                name = 'front'
            elif abs(p0.x - W / 2) < 1e-6 and abs(p1.x - W / 2) < 1e-6:
                name = 'right'
            self.segments.append({'name': name, 'p0': p0, 'p1': p1, 'd': d, 'n': Vector((-d.y, d.x)),
                                  'L': (p1 - p0).length, 'q0': Vector(self.interior_poly[i]),
                                  'q1': Vector(self.interior_poly[(i + 1) % n]), 'openings': [], 'index': i, 'glass': False})
        return self.segments

    def segment(self, name):
        return next(s for s in self.segments if s['name'] == name)

    def wall_quad(self, seg, ua, ub):
        e0 = seg['p0'] + seg['d'] * ua
        e1 = seg['p0'] + seg['d'] * ub
        i0 = seg['q0'] if ua <= 1e-6 else e0 + seg['n'] * self.t
        i1 = seg['q1'] if ub >= seg['L'] - 1e-6 else e1 + seg['n'] * self.t
        return [tuple(e0), tuple(e1), tuple(i1), tuple(i0)]

    def wall_piece(self, seg, ua, ub, z0, z1, name, coll, bevel=0.0012):
        if ub - ua < 0.004 or z1 - z0 < 0.004:
            return None
        return prism(name, self.wall_quad(seg, ua, ub), z0, z1, coll, self.wall_mat, bevel)

    # -- walls ---------------------------------------------------------------
    def build_walls(self):
        cfg = self.cfg
        family = self.family
        for seg in self.segments:
            coll = self.colls[f'Cabin - {seg["name"]}']
            objs = []
            span_z = (0, self.z_c)
            if cfg['board_orientation'] == 'horizontal':
                rows = max(1, round(self.z_c / 0.112))
                row_h = self.z_c / rows
                for r in range(rows):
                    z0, z1 = r * row_h, (r + 1) * row_h
                    breaks = sorted({z0, z1} | {o['z0'] for o in seg['openings'] if z0 < o['z0'] < z1} | {o['z1'] for o in seg['openings'] if z0 < o['z1'] < z1})
                    for a, b in zip(breaks, breaks[1:]):
                        holes = [(o['u0'], o['u1']) for o in seg['openings'] if o['z0'] <= a + 1e-6 and o['z1'] >= b - 1e-6]
                        for ua, ub in subtract_intervals((0, seg['L']), holes):
                            obj = self.wall_piece(seg, ua, ub, a, b, f'{seg["name"].title()} board {r + 1:02}', coll)
                            if obj:
                                objs.append(obj)
            else:
                cols = max(1, round(seg['L'] / 0.112))
                col_w = seg['L'] / cols
                for c in range(cols):
                    u0, u1 = c * col_w, (c + 1) * col_w
                    breaks = sorted({u0, u1} | {o['u0'] for o in seg['openings'] if u0 < o['u0'] < u1} | {o['u1'] for o in seg['openings'] if u0 < o['u1'] < u1})
                    for a, b in zip(breaks, breaks[1:]):
                        holes = [(o['z0'], o['z1']) for o in seg['openings'] if o['u0'] <= a + 1e-6 and o['u1'] >= b - 1e-6]
                        for za, zb in subtract_intervals(span_z, holes):
                            obj = self.wall_piece(seg, a, b, za, zb, f'{seg["name"].title()} board {c + 1:02}', coll)
                            if obj:
                                objs.append(obj)
            tag(objs, 'cabin', family['sku'], f'Wand {seg["name"]} - {CATALOG["woods"][family["wall_wood"]]["name_de"]} {family["wall_mm"]} mm',
                0, (seg['L'] * 1000, family['wall_mm'], self.z_c * 1000), included_in='cabin')
        self.build_cladding()
        # ceiling boards clipped to the plan
        coll = self.colls['Cabin - roof']
        strips = max(4, round(self.W / 0.115))
        objs = []
        for i in range(strips):
            x0 = -self.W / 2 + i * self.W / strips
            x1 = x0 + self.W / strips
            poly = clip_polygon([(x0, -self.D - 0.1), (x1, -self.D - 0.1), (x1, 0.1), (x0, 0.1)], self.exterior)
            if len(poly) >= 3:
                objs.append(prism(f'Ceiling board {i + 1:02}', poly, self.z_c, self.H, coll, self.wall_mat, 0.001))
        tag(objs, 'cabin', family['sku'], f'Decke {family["ceiling_mm"]} mm', 0, (self.W * 1000, self.D * 1000, family['ceiling_mm']), included_in='cabin')
        # interior perimeter trim at the ceiling and floor skirting
        for name, z0, z1 in [('Ceiling trim', self.z_c - 0.03, self.z_c), ('Skirting', 0, 0.06)]:
            inner = offset_polygon(self.exterior, self.t)
            inner2 = offset_polygon(self.exterior, self.t + 0.018)
            for i in range(len(inner)):
                quad = [inner[i], inner[(i + 1) % len(inner)], inner2[(i + 1) % len(inner)], inner2[i]]
                seg = self.segments[i]
                if seg['openings'] and name == 'Skirting':
                    continue
                objs = [prism(f'{name} {seg["name"]}', quad[::-1], z0, z1, self.colls[f'Cabin - {seg["name"]}'], self.wall_mat, 0.001)]
                tag(objs, 'cabin', family['sku'], name, 0, (seg['L'] * 1000, 18, (z1 - z0) * 1000), included_in='cabin')

    def build_cladding(self):
        kind = self.cfg.get('cladding', 'none')
        if kind == 'none':
            return
        spec = CATALOG['claddings'][kind]
        mat = self.mat['slate'] if kind == 'schiefer' else wood_material('altholz')
        thickness = 0.012 if kind == 'schiefer' else 0.02
        for seg in self.segments:
            if seg['glass']:
                continue
            coll = self.colls[f'Cabin - {seg["name"]}']
            holes = [(o['u0'] - 0.01, o['u1'] + 0.01, o['z0'], o['z1']) for o in seg['openings']]
            objs = []
            if kind == 'schiefer':
                tile_w, tile_h, joint = 0.60, 0.30, 0.004
                cols = max(1, round(seg['L'] / tile_w))
                rows = max(1, round(self.z_c / tile_h))
                for r in range(rows):
                    z0, z1 = r * self.z_c / rows, (r + 1) * self.z_c / rows
                    for c in range(cols):
                        u0, u1 = c * seg['L'] / cols, (c + 1) * seg['L'] / cols
                        if any(h[0] < u1 and h[1] > u0 and h[2] < z1 and h[3] > z0 for h in holes):
                            continue
                        e0 = seg['p0'] + seg['d'] * (u0 + joint)
                        e1 = seg['p0'] + seg['d'] * (u1 - joint)
                        quad = [tuple(e0 - seg['n'] * thickness), tuple(e1 - seg['n'] * thickness), tuple(e1), tuple(e0)]
                        objs.append(prism(f'Slate tile {r + 1:02}-{c + 1:02}', quad, z0 + joint, z1 - joint, coll, mat, 0.001))
            else:
                rows = max(1, round(self.z_c / 0.14))
                for r in range(rows):
                    z0, z1 = r * self.z_c / rows, (r + 1) * self.z_c / rows
                    row_holes = [(h[0], h[1]) for h in holes if h[2] < z1 and h[3] > z0]
                    for u0, u1 in subtract_intervals((0, seg['L']), row_holes):
                        e0 = seg['p0'] + seg['d'] * u0
                        e1 = seg['p0'] + seg['d'] * u1
                        quad = [tuple(e0 - seg['n'] * thickness), tuple(e1 - seg['n'] * thickness), tuple(e1), tuple(e0)]
                        objs.append(prism(f'Reclaimed board {r + 1:02}', quad, z0 + 0.002, z1 - 0.002, coll, mat, 0.0015))
            tag(objs, 'cabin', 'VERKLEIDUNG-' + kind.upper(), spec['name_de'], spec['price'], (seg['L'] * 1000, thickness * 1000, self.z_c * 1000))

    # -- openings: door, window, glass front -----------------------------------
    def layout_front(self):
        cfg = self.cfg
        entry = cfg['entry']
        chamfered = entry in ('corner', 'corner_glasfront')
        seg = self.segment('corner') if chamfered else self.segment('front')
        L = seg['L']
        door_block = self.door_w + 2 * self.frame
        edge = self.t + 0.06
        if chamfered:
            u0 = (L - door_block) / 2
        else:
            position = cfg['door']['position']
            if entry == 'glass_corner':
                position = cfg['door']['corner']
            if position == 'left':
                u0 = edge
            elif position == 'right':
                u0 = L - edge - door_block
            else:
                u0 = (L - door_block) / 2
        u0 = min(max(u0, edge), L - edge - door_block)
        seg['openings'].append({'kind': 'door', 'u0': u0, 'u1': u0 + door_block, 'z0': 0, 'z1': self.z_door_top + 0.045})
        self.door_info = {'seg': seg, 'u0': u0 + self.frame, 'u1': u0 + self.frame + self.door_w}
        # heater side: opposite the door when possible
        door_centre_x = (seg['p0'] + seg['d'] * (u0 + door_block / 2)).x
        if chamfered or entry == 'glass_corner':
            self.heater_side = -1 if cfg['door']['corner'] == 'right' else 1
        else:
            self.heater_side = 1 if door_centre_x <= 0 else -1
        position = cfg['heater']['position']
        if position in ('front_left', 'back_left'):
            self.heater_side = -1
        elif position in ('front_right', 'back_right'):
            self.heater_side = 1
        if (chamfered or entry == 'glass_corner') and position.startswith('front') and ((self.heater_side > 0) == (cfg['door']['corner'] == 'right')):
            self.heater_side = -self.heater_side
            self.warnings.append('Ofenposition lag in der Einstiegs-Ecke; Ofen auf die gegenueberliegende Seite verschoben.')
        glass_side = self.segment(cfg['door']['corner'])
        if entry == 'glasfront':
            self.layout_glass(seg)
        elif entry == 'corner_glasfront':
            self.layout_glass(self.segment('front'))
            self.layout_glass(glass_side)
        elif entry == 'glass_corner':
            self.layout_glass(seg)
            self.layout_glass(glass_side)
        elif entry == 'front':
            self.layout_window(seg, u0, u0 + door_block)
        else:
            # corner entry keeps an optional window in the straight front wall
            self.layout_window(self.segment('front'), None, None)

    def layout_window(self, seg, door_u0, door_u1):
        cfg = self.cfg
        if cfg['window'] == 'none':
            return
        L = seg['L']
        edge = self.t + 0.06
        frame = 0.05
        if door_u0 is None:
            # corner entry: window centred in the front wall, away from the heater corner
            free = (edge, L - edge)
        else:
            right = (door_u1 + 0.02, L - edge)
            left = (edge, door_u0 - 0.02)
            free = right if (right[1] - right[0]) >= (left[1] - left[0]) else left
        avail = free[1] - free[0] - 2 * frame
        if cfg['window'] == 'auto':
            width = min(0.95, avail)
        else:
            width = float(cfg['window']) / 100
            if width > avail:
                self.warnings.append(f'Fenster {cfg["window"]} cm passt nicht; auf {avail * 100:.0f} cm reduziert.')
                width = avail
        if width < 0.30:
            self.warnings.append('Kein Platz fuer ein Fenster neben der Tuere; Fenster entfaellt.')
            return
        if door_u0 is None:
            u0 = (L - width) / 2 - frame
        elif free[0] > edge:
            u0 = free[0]
        else:
            u0 = free[1] - width - 2 * frame
        seg['openings'].append({'kind': 'window', 'u0': u0, 'u1': u0 + width + 2 * frame, 'z0': 0.10, 'z1': self.z_door_top + 0.045,
                                'glass': (u0 + frame, u0 + frame + width, 0.15, self.z_door_top)})

    def layout_glass(self, seg):
        """Turn a whole wall segment into a glass wall (door included when it is the door wall)."""
        L = seg['L']
        post = self.t + 0.03
        seg['glass'] = True
        seg['openings'] = [o for o in seg['openings'] if o['kind'] == 'door']
        seg['openings'].append({'kind': 'glasfront', 'u0': post, 'u1': L - post, 'z0': 0, 'z1': self.z_door_top + 0.045})

    def build_openings(self):
        family = self.family
        mats = self.mat
        for seg in self.segments:
            coll = self.colls[f'Cabin - {seg["name"]}']
            for opening in seg['openings']:
                if opening['kind'] == 'door':
                    self.build_door_frame(seg, opening, coll, timber=not seg['glass'])
                elif opening['kind'] == 'window':
                    frame = 0.05
                    u0, u1, z1 = opening['u0'], opening['u1'], opening['z1']
                    g = opening['glass']
                    objs = [self.wall_piece(seg, u0, u0 + frame, opening['z0'], z1, 'Window jamb', coll, 0.002),
                            self.wall_piece(seg, u1 - frame, u1, opening['z0'], z1, 'Window jamb', coll, 0.002),
                            self.wall_piece(seg, u0 + frame, u1 - frame, opening['z0'], g[2], 'Window sill', coll, 0.002),
                            self.wall_piece(seg, u0 + frame, u1 - frame, g[3], z1, 'Window head', coll, 0.002)]
                    tag([o for o in objs if o], 'cabin', family['sku'], 'Fensterrahmen', 0, ((u1 - u0) * 1000, family['wall_mm'], (z1 - opening['z0']) * 1000), included_in='cabin')
                    glass = self.pane(seg, g[0], g[1], g[2], g[3], 'Window glass 8mm', coll, mats['glass'])
                    tag(glass, 'cabin', family['sku'], 'Wandhohes Fenster 8 mm ESG Klarglas', 0, ((g[1] - g[0]) * 1000, 8, (g[3] - g[2]) * 1000), included_in='cabin')
                elif opening['kind'] == 'glasfront':
                    self.build_glasfront(seg, opening, coll)

    def pane(self, seg, u0, u1, z0, z1, name, coll, mat, thickness=0.008, inset=None):
        inset = self.t / 2 if inset is None else inset
        centre = seg['p0'] + seg['d'] * ((u0 + u1) / 2) + seg['n'] * inset
        angle = math.atan2(seg['d'].y, seg['d'].x)
        obj = box(name, (centre.x, centre.y, (z0 + z1) / 2), (u1 - u0, thickness, z1 - z0), coll, mat, 0.0007, angle)
        return obj

    def build_door_frame(self, seg, opening, coll, timber=True):
        family = self.family
        u0, u1, z1 = opening['u0'], opening['u1'], opening['z1']
        if timber:
            objs = [self.wall_piece(seg, u0, u0 + self.frame, 0, z1, 'Door jamb', coll, 0.002),
                    self.wall_piece(seg, u1 - self.frame, u1, 0, z1, 'Door jamb', coll, 0.002),
                    self.wall_piece(seg, u0 + self.frame, u1 - self.frame, self.z_door_top, z1, 'Door lintel', coll, 0.002)]
            tag([o for o in objs if o], 'cabin', family['sku'], 'Tuerrahmen, schwellenlos', 0, ((u1 - u0) * 1000, family['wall_mm'], z1 * 1000), included_in='cabin')
        seal = self.mat['seal']
        d0, d1 = self.door_info['u0'], self.door_info['u1']
        for u in (d0 - 0.006, d1 + 0.006):
            tag(self.pane(seg, u - 0.006, u + 0.006, 0.02, self.z_door_top, 'Door jamb seal', coll, seal, 0.012, self.t * 0.25),
                'cabin', family['sku'], 'Tuerdichtung', 0, (12, 12, self.z_door_top * 1000), included_in='cabin')
        tag(self.pane(seg, d0, d1, self.z_door_top - 0.008, self.z_door_top, 'Door header seal', coll, seal, 0.012, self.t * 0.25),
            'cabin', family['sku'], 'Tuerdichtung', 0, (self.door_w * 1000, 12, 8), included_in='cabin')

    def build_glasfront(self, seg, opening, coll):
        family = self.family
        mats = self.mat
        u0, u1, z_top = opening['u0'], opening['u1'], self.z_door_top
        profile = 0.04
        has_door = self.door_info['seg'] is seg
        if has_door:
            d0, d1 = self.door_info['u0'] - self.frame, self.door_info['u1'] + self.frame
            spans = [(u0, d0), (d1, u1)]
        else:
            d0 = d1 = None
            spans = [(u0, u1)]
        # door jambs are aluminium profiles on a glass front
        panes = []
        for a, b in spans:
            if b - a < 0.05:
                continue
            count = max(1, math.ceil((b - a) / 1.05))
            width = (b - a) / count
            for i in range(count):
                panes.append((a + i * width, a + (i + 1) * width))
        profiles = sorted({u0, u1} | ({d0, d1} if has_door else set()) | {p[0] for p in panes} | {p[1] for p in panes})
        objs = []
        for u in profiles:
            objs.append(self.pane(seg, u - profile / 2, u + profile / 2, 0, z_top + 0.045, 'Glass front profile', coll, mats['alu'], self.t * 0.6, self.t / 2))
        objs.append(self.pane(seg, u0, u1, z_top, z_top + 0.045, 'Glass front head profile', coll, mats['alu'], self.t * 0.6, self.t / 2))
        objs.append(self.pane(seg, u0, u1, 0, 0.012, 'Glass front base profile', coll, mats['alu'], self.t * 0.6, self.t / 2))
        tag(objs, 'cabin', family['sku'], 'Glasfront Aluminiumprofil', 0, ((u1 - u0) * 1000, family['wall_mm'], (z_top + 0.045) * 1000), included_in='cabin')
        for a, b in panes:
            glass = self.pane(seg, a + profile / 2, b - profile / 2, 0.012, z_top, 'Glass front pane 8mm', coll, mats['glass'])
            tag(glass, 'cabin', family['sku'], 'Glasfront 8 mm Klarglas', 0, ((b - a) * 1000, 8, z_top * 1000), included_in='cabin')
        if has_door:
            d0, d1 = self.door_info['u0'], self.door_info['u1']
            tag(self.pane(seg, d0, d1, self.z_door_top - 0.008, self.z_door_top, 'Door header seal', coll, mats['seal'], 0.012, self.t * 0.25),
                'cabin', family['sku'], 'Tuerdichtung', 0, (self.door_w * 1000, 12, 8), included_in='cabin')

    # -- door leaf -------------------------------------------------------------
    def build_door(self):
        cfg = self.cfg
        family = self.family
        coll = self.colls['Door']
        mats = self.mat
        seg = self.door_info['seg']
        u0, u1 = self.door_info['u0'], self.door_info['u1']
        hinge = cfg['door']['hinge']
        sign = 1 if hinge == 'left' else -1
        hinge_u = u0 if hinge == 'left' else u1
        angle = math.atan2(seg['d'].y, seg['d'].x)
        inset = self.t * 0.25                       # leaf sits toward the outer face
        root = empty('door', coll)
        pivot = empty('Door swing pivot', coll)
        pivot.parent = root
        pivot['open_rotation_degrees'] = -90 * sign
        pivot['hinge'] = hinge
        # build the leaf in a local frame: u along +X from the hinge, wall normal +Y, then place the pivot
        leaf_w, leaf_h = self.door_w - 0.008, self.z_door_top - 0.02
        cx = sign * leaf_w / 2
        parts = [box('Door glass 8mm', (cx, 0, 0.012 + leaf_h / 2), (leaf_w, 0.008, leaf_h), coll, mats['glass'], 0.0007)]
        handle_x = sign * (leaf_w - 0.09)
        for y, mat, label in [(0.055, self.bench_mat, 'wood inside'), (-0.055, mats['steel'], 'stainless outside')]:
            parts.append(cylinder(f'Door bar handle ({label})', (handle_x, y, 0.87), (handle_x, y, 1.15), 0.016, coll, mat))
            for z in (0.91, 1.11):
                parts.append(cylinder('Handle mount', (handle_x, 0, z), (handle_x, y, z), 0.010, coll, mats['steel']))
        for z in (0.30, leaf_h - 0.25):
            parts.append(box('Hinge glass clamp', (sign * 0.03, 0, z), (0.052, 0.020, 0.058), coll, mats['steel'], 0.004))
            fixed = cylinder('Door hinge barrel', (-sign * 0.006, -0.012, z - 0.035), (-sign * 0.006, -0.012, z + 0.035), 0.011, coll, mats['steel'])
            fixed.parent = root
            plate = box('Hinge frame plate', (-sign * 0.03, -0.02, z), (0.038, 0.008, 0.062), coll, mats['steel'], 0.004)
            plate.parent = root
        for part in parts:
            part.parent = pivot
        hinge_point = seg['p0'] + seg['d'] * hinge_u + seg['n'] * inset
        root.location = (hinge_point.x, hinge_point.y, 0)
        root.rotation_euler = (0, 0, angle)
        name = f'Ganzglastuere 8 mm ESG {family["door_mm"][0]}x{family["door_mm"][1]} mm, Anschlag {"links" if hinge == "left" else "rechts"}'
        tag([root, pivot, *parts, *[o for o in coll.objects if o.parent is root and o.type == 'MESH']], 'door', family['sku'], name, 0,
            (family['door_mm'][0], 8, family['door_mm'][1]), included_in='cabin', hinge=hinge)
        root['hinge_pivot_local'] = [hinge_point.x, hinge_point.y, 0]
        root['open_rotation_degrees'] = -90 * sign
        self.door_root = root

    # -- heater ----------------------------------------------------------------
    def build_heater(self):
        cfg = self.cfg
        sku = cfg['heater']['sku']
        spec = CATALOG['heaters'].get(sku)
        coll = self.colls['Heater']
        if not spec:
            self.warnings.append(f'Unbekannter Ofen {sku}; kein Ofen gebaut.')
            return
        mats = self.mat
        w, d, h = [v / 1000 for v in spec['dims_mm']]
        side = self.heater_side
        position = cfg['heater']['position']
        at_back = position.startswith('back') or position == 'centre_back'
        clearance = 0.05
        if position == 'centre_back':
            x0, x1 = -w / 2, w / 2
        elif side > 0:
            x1 = self.x_r - clearance
            x0 = x1 - w
        else:
            x0 = self.x_l + clearance
            x1 = x0 + w
        wall_y = self.y_b if at_back else self.y_f
        z0 = 0.006 if ('FLOOR-PLATE' in cfg['accessories'] and spec['mount'] == 'floor') else 0.0
        # heater_parts() already places every mesh at its absolute world position,
        # so the root empty must stay at the origin - giving it the heater's own
        # location would double-offset every child once parented below.
        root = empty('heater', coll)
        parts, info = heater_parts(spec, coll, mats, (x0 + x1) / 2, wall_y, z0, at_back, side)
        self.heater_top = info['stones_top']
        for part in parts:
            part.parent = root
        volume = self.W * self.D * self.H
        tag([root, *parts], 'heater', sku, spec['name_de'], spec['price'], spec['dims_mm'], kw=spec['kw'],
            control=spec['control'], mount=spec['mount'], dims_approx=bool(spec.get('approx')), cabin_m3=round(volume, 2))
        y0, y1 = info['y0'], info['y1']
        # guard and zone
        gx0, gx1, gy0, gy1 = x0 - clearance, x1 + clearance, y0 - clearance, y1 + clearance
        zone = [max(gx0, self.x_l), min(gx1, self.x_r), max(gy0, self.y_f), min(gy1, self.y_b)]
        if spec['guard']:
            guard = guard_parts(zone, coll, self.bench_mat, self.x_l, self.x_r, self.y_f, self.y_b,
                                0.72 if spec['mount'] == 'wall' else min(0.9, info['z0'] + h * 0.85))
            for g in guard:
                g.parent = root
            tag(guard, 'interior', 'GUARD', 'Ofenschutzgitter (im Lieferumfang)', 0, ((zone[1] - zone[0]) * 1000, (zone[3] - zone[2]) * 1000, 720), included_in='cabin')
        zone[0] -= 0.02
        zone[1] += 0.02
        zone[2] -= 0.02
        zone[3] += 0.02
        self.heater_zone = tuple(zone)
        self.heater_pos = ((x0 + x1) / 2, (y0 + y1) / 2, info['z0'], h, at_back)
        # door / heater conflict check on the same wall
        seg = self.door_info['seg']
        if seg['name'] == 'front' and not at_back:
            dx0 = (seg['p0'] + seg['d'] * self.door_info['u0']).x
            dx1 = (seg['p0'] + seg['d'] * self.door_info['u1']).x
            if min(dx0, dx1) < zone[1] and max(dx0, dx1) > zone[0]:
                self.warnings.append('Ofen ueberschneidet den Tuerbereich; Ofenposition oder Tuerposition aendern.')
        if 'FLOOR-PLATE' in cfg['accessories']:
            plate_spec = CATALOG['accessories']['FLOOR-PLATE']
            plate = box('Floor protection plate', ((x0 + x1) / 2, (y0 + y1) / 2, 0.003), (max(w + 0.1, 0.6), max(d + 0.1, 0.5), 0.006), coll, mats['grate_black'], 0.001)
            plate.parent = root
            tag(plate, 'accessory', 'FLOOR-PLATE', plate_spec['name_de'], plate_spec['price'], plate_spec['dims_mm'])

    # -- control ---------------------------------------------------------------
    def build_control(self):
        cfg = self.cfg
        sku = cfg['control']
        spec = CATALOG['controls'].get(sku)
        coll = self.colls['Control']
        heater = CATALOG['heaters'].get(cfg['heater']['sku'], {})
        mats = self.mat
        parts = []
        if spec and sku != 'none':
            side = self.heater_side
            x = side * self.W / 2
            y = self.y_f + 0.25 if not self.heater_pos[4] else self.y_b - 0.25
            z = 1.35
            parts += control_parts(spec, coll, mats, self.bench_mat, x, y, z, side)
            hx, hy, hz0, hh, at_back = self.heater_pos
            sensor_y = self.y_f + 0.012 if not at_back else self.y_b - 0.012
            parts.append(box('Temperature sensor', (hx, sensor_y, min(self.z_c - 0.12, hz0 + hh + 0.35)), (0.03, 0.024, 0.06), coll, mats['white'], 0.002))
            seg = self.door_info['seg']
            u = self.door_info['u0'] - 0.03 if cfg['door']['hinge'] == 'right' else self.door_info['u1'] + 0.03
            p = seg['p0'] + seg['d'] * u + seg['n'] * (self.t + 0.01)
            parts.append(box('Door sensor', (p.x, p.y, self.z_door_top - 0.03), (0.02, 0.02, 0.05), coll, mats['white'], 0.002, math.atan2(seg['d'].y, seg['d'].x)))
            tag(parts, 'control', sku, spec['name_de'], spec['price'], spec['dims_mm'], wifi=bool(spec.get('wifi')), series=spec.get('series', ''))
        elif heater.get('control') == 'external':
            self.warnings.append('Externe Steuerung fehlt fuer diesen Ofen.')

    # -- benches ---------------------------------------------------------------
    def bench(self, name, x0, x1, y0, y1, z_top, along='x', legs=True, apron=False):
        """Slatted bench; returns (objects, front_y_or_x)."""
        coll = self.colls['Interior - benches']
        mat = self.bench_mat
        objs = []
        slat_w, gap = 0.078, 0.008
        s = self.slat
        if along == 'x':
            depth = y1 - y0
            count = max(1, int((depth + gap) / (slat_w + gap)))
            pitch = depth / count
            for i in range(count):
                y = y1 - (i + 0.5) * pitch
                objs.append(box(f'{name} slat {i + 1}', ((x0 + x1) / 2, y, z_top - s / 2), (x1 - x0, pitch - gap, s), coll, mat, self.round))
            span_positions = [x0 + 0.04, x1 - 0.04]
            n_extra = int((x1 - x0) / 0.85)
            for i in range(1, n_extra + 1):
                span_positions.insert(-1, x0 + (x1 - x0) * i / (n_extra + 1))
            if legs:
                for x in span_positions:
                    objs.append(box(f'{name} support', (x, (y0 + y1) / 2, z_top - s - 0.024), (0.045, depth - 0.02, 0.048), coll, mat, 0.002))
                    for y in (y0 + 0.035, y1 - 0.035):
                        objs.append(box(f'{name} leg', (x, y, (z_top - s - 0.048) / 2), (0.045, 0.045, z_top - s - 0.048), coll, mat, 0.002))
            if apron:
                objs.append(box(f'{name} front apron', ((x0 + x1) / 2, y0 + 0.014, z_top - s - 0.05), (x1 - x0, 0.028, 0.10), coll, mat, self.round))
        else:
            width = x1 - x0
            count = max(1, int((width + gap) / (slat_w + gap)))
            pitch = width / count
            for i in range(count):
                x = x0 + (i + 0.5) * pitch
                objs.append(box(f'{name} slat {i + 1}', (x, (y0 + y1) / 2, z_top - s / 2), (pitch - gap, y1 - y0, s), coll, mat, self.round))
            span_positions = [y0 + 0.04, y1 - 0.04]
            n_extra = int((y1 - y0) / 0.85)
            for i in range(1, n_extra + 1):
                span_positions.insert(-1, y0 + (y1 - y0) * i / (n_extra + 1))
            if legs:
                for y in span_positions:
                    objs.append(box(f'{name} support', ((x0 + x1) / 2, y, z_top - s - 0.024), (width - 0.02, 0.045, 0.048), coll, mat, 0.002))
                    for x in (x0 + 0.035, x1 - 0.035):
                        objs.append(box(f'{name} leg', (x, y, (z_top - s - 0.048) / 2), (0.045, 0.045, z_top - s - 0.048), coll, mat, 0.002))
            if apron:
                inner_x = x0 + 0.014 if x0 > 0 else x1 - 0.014
                objs.append(box(f'{name} front apron', (inner_x, (y0 + y1) / 2, z_top - s - 0.05), (0.028, y1 - y0, 0.10), coll, mat, self.round))
        return objs

    def cladding(self, name, x0, x1, y, z0, z1, along='x'):
        """Vertical slat cladding (Zwischenbankverkleidung) in a plane."""
        coll = self.colls['Interior - benches']
        objs = []
        slat_w, gap = 0.07, 0.009
        length = (x1 - x0)
        count = max(1, int((length + gap) / (slat_w + gap)))
        pitch = length / count
        for i in range(count):
            p = x0 + (i + 0.5) * pitch
            if along == 'x':
                objs.append(box(f'{name} slat {i + 1}', (p, y, (z0 + z1) / 2), (pitch - gap, 0.014, z1 - z0), coll, self.bench_mat, 0.002))
            else:
                objs.append(box(f'{name} slat {i + 1}', (y, p, (z0 + z1) / 2), (0.014, pitch - gap, z1 - z0), coll, self.bench_mat, 0.002))
        return objs

    def backrest(self, name, a, b, wall, z=1.04):
        """Two backrest slats along a wall. wall: 'back', 'left' or 'right'."""
        coll = self.colls['Interior - benches']
        objs = []
        for i, zz in enumerate((z, z + 0.13)):
            if wall == 'back':
                objs.append(box(f'{name} slat {i + 1}', ((a + b) / 2, self.y_b - 0.045 - 0.0135, zz + 0.0475), (b - a, 0.027, 0.095), coll, self.bench_mat, self.round))
            else:
                x = self.x_l + 0.045 + 0.0135 if wall == 'left' else self.x_r - 0.045 - 0.0135
                objs.append(box(f'{name} slat {i + 1}', (x, (a + b) / 2, zz + 0.0475), (0.027, b - a, 0.095), coll, self.bench_mat, self.round))
        for p in (a + 0.06, b - 0.06):
            if wall == 'back':
                objs.append(box(f'{name} standoff', (p, self.y_b - 0.0225, z + 0.11), (0.045, 0.045, 0.265), coll, self.bench_mat))
            else:
                x = self.x_l + 0.0225 if wall == 'left' else self.x_r - 0.0225
                objs.append(box(f'{name} standoff', (x, p, z + 0.11), (0.045, 0.045, 0.265), coll, self.bench_mat))
        return objs

    def headrest(self, name, x, y, z, along='x'):
        coll = self.colls['Interior - benches']
        objs = []
        for i in range(5):
            rise = 0.03 + i * 0.015
            if along == 'x':
                objs.append(box(f'{name} slat {i + 1}', (x, y - 0.12 + i * 0.06, z + rise / 2 + 0.008), (0.40, 0.05, 0.016), coll, self.bench_mat, self.round))
            else:
                objs.append(box(f'{name} slat {i + 1}', (x - 0.12 + i * 0.06, y, z + rise / 2 + 0.008), (0.05, 0.40, 0.016), coll, self.bench_mat, self.round))
        for p in (-0.17, 0.17):
            if along == 'x':
                objs.append(box(f'{name} side', (x + p, y, z + 0.03), (0.02, 0.30, 0.06), coll, self.bench_mat, 0.002))
            else:
                objs.append(box(f'{name} side', (x, y + p, z + 0.03), (0.30, 0.02, 0.06), coll, self.bench_mat, 0.002))
        return objs

    def build_interior(self):
        cfg = self.cfg['interior']
        coll = self.colls['Interior - benches']
        up_d, lo_d = cfg['upper_depth_cm'] / 100, cfg['lower_depth_cm'] / 100
        up_z, lo_z = cfg['upper_height_cm'] / 100, cfg['lower_height_cm'] / 100
        layout = cfg['layout']
        zone = self.heater_zone
        side = self.heater_side
        interior_name = self.interior['name_de']
        root = empty('interior', coll)
        objs = []
        # side benches for L / U
        side_benches = []
        if layout in ('L', 'U'):
            sides = [-side] if layout == 'L' else [-1, 1]
            for s in sides:
                y_end = self.y_f + 0.30
                if zone and ((s > 0 and zone[1] > self.x_r - up_d - 0.05) or (s < 0 and zone[0] < self.x_l + up_d + 0.05)):
                    y_end = max(y_end, zone[3] + 0.03)
                # A chamfered corner on THIS side shortens the side wall the
                # bench runs along - it doesn't reach all the way to self.y_f
                # any more. Verified (Blender MCP, zirbe-eck-glasfront): the
                # side bench's deep end (y_end) reached -1.66 while the real
                # wall only starts at -1.28, so the bench (and its cladding,
                # built from these same bounds) ran 0.38 m past the wall,
                # straight through the diagonal glass corner.
                wall_name = 'right' if s > 0 else 'left'
                if getattr(self, 'corner_side', None) == wall_name:
                    wall_seg = next((sg for sg in self.segments if sg['name'] == wall_name), None)
                    if wall_seg:
                        wall_limit = min(wall_seg['q0'].y, wall_seg['q1'].y)
                        y_end = max(y_end, wall_limit + 0.03)
                y_start = self.y_b - up_d
                if y_start - y_end < 0.45:
                    self.warnings.append('Kabine zu kurz fuer eine seitliche Liege; Layout auf gerade reduziert.')
                    continue
                x0, x1 = (self.x_l, self.x_l + up_d) if s < 0 else (self.x_r - up_d, self.x_r)
                objs += self.bench(f'Side bench {"left" if s < 0 else "right"}', x0, x1, y_end, y_start, up_z, 'y', legs=True, apron=cfg['apron'])
                side_benches.append((s, x0, x1, y_end, y_start))
                if cfg['backrests']:
                    objs += self.backrest(f'Side backrest {"left" if s < 0 else "right"}', y_end + 0.02, self.y_b - 0.05, 'left' if s < 0 else 'right')
                if cfg['apron']:
                    inner_x = x1 + 0.007 if s < 0 else x0 - 0.007
                    objs += self.cladding(f'Side bench cladding {"left" if s < 0 else "right"}', y_end, y_start, inner_x, 0.10, up_z - self.slat - 0.10, 'y')
        # main upper bench along the back wall
        bx0 = self.x_l + (up_d if any(s < 0 for s, *_ in side_benches) else 0)
        bx1 = self.x_r - (up_d if any(s > 0 for s, *_ in side_benches) else 0)
        # A chamfered corner shortens THIS SAME wall run - x_l/x_r are the
        # plain-rectangle bounds and don't know that. Verified (Blender MCP,
        # zirbe-eck-glasfront): with no clamp, the back bench's own cladding
        # slats and legs projected straight through the angled glass corner.
        if getattr(self, 'corner_side', None) == 'right':
            bx1 = min(bx1, self.x_r - self.corner_cut - 0.03)
        elif getattr(self, 'corner_side', None) == 'left':
            bx0 = max(bx0, self.x_l + self.corner_cut + 0.03)
        if zone and zone[3] > self.y_b - up_d - 0.03:
            # heater at the back wall: keep the bench clear of it
            if zone[0] > 0:
                bx1 = min(bx1, zone[0])
            else:
                bx0 = max(bx0, zone[1])
        objs += self.bench('Upper bench', bx0, bx1, self.y_b - up_d, self.y_b, up_z, 'x', legs=True, apron=cfg['apron'])
        self.benches.append({'x0': bx0, 'x1': bx1, 'y0': self.y_b - up_d, 'y1': self.y_b, 'z': up_z})
        if cfg['backrests']:
            objs += self.backrest('Backrest', bx0 + 0.02, bx1 - 0.02, 'back')
            if cfg['side_backrests'] and layout == 'straight':
                for s in (-1, 1):
                    if zone and ((s > 0 and zone[1] > self.x_r - 0.1 and zone[3] > self.y_b - up_d) or (s < 0 and zone[0] < self.x_l + 0.1 and zone[3] > self.y_b - up_d)):
                        continue
                    objs += self.backrest(f'Side backrest {"left" if s < 0 else "right"}', self.y_b - up_d, self.y_b - 0.05, 'left' if s < 0 else 'right')
        # lower bench / sliding stool in front of the upper bench
        lx0, lx1 = bx0, bx1
        ly1 = self.y_b - up_d
        ly0 = ly1 - lo_d
        if zone and zone[3] > ly0 - 0.03 and zone[2] < ly1:
            if zone[0] > 0:
                lx1 = min(lx1, zone[0])
            else:
                lx0 = max(lx0, zone[1])
        if lx1 - lx0 > 0.5 and ly0 > self.y_f + 0.45:
            stool = self.bench('Lower bench' if not cfg['sliding_stool'] else 'Sliding stool', lx0 + 0.01, lx1 - 0.01, ly0, ly1, lo_z, 'x', legs=True, apron=True)
            objs += stool
            self.lower_bench = {'x0': lx0, 'x1': lx1, 'y0': ly0, 'y1': ly1, 'z': lo_z}
            tag(stool, 'interior', self.cfg['interior']['material'], f'Untere Liege / Hocker {"verschiebbar" if cfg["sliding_stool"] else "fest"} - {interior_name}', 0,
                ((lx1 - lx0) * 1000, lo_d * 1000, lo_z * 1000), included_in='cabin')
        else:
            self.warnings.append('Kein Platz fuer die untere Liege.')
        # cladding between benches under the upper bench front
        if cfg['apron']:
            spans = []
            if self.lower_bench:
                lb = self.lower_bench
                if lb['x0'] - bx0 > 0.05:
                    spans.append((bx0, lb['x0'] - 0.01, 0.10))
                spans.append((lb['x0'], lb['x1'], lo_z + 0.01))
                if bx1 - lb['x1'] > 0.05:
                    spans.append((lb['x1'] + 0.01, bx1, 0.10))
            else:
                spans.append((bx0, bx1, 0.10))
            for a, b, z0 in spans:
                objs += self.cladding('Bench cladding', a, b, self.y_b - up_d + 0.007, z0, up_z - self.slat - 0.10, 'x')
        # headrests
        count = int(cfg.get('headrests', 2))
        placed = 0
        if count and side_benches:
            s, sx0, sx1, sy0, sy1 = side_benches[0]
            objs += self.headrest('Headrest', (sx0 + sx1) / 2, sy0 + 0.25, up_z, 'y')
            placed += 1
        if count > placed:
            x = bx0 + 0.30 if (side_benches and side_benches[0][0] > 0) or not side_benches else bx1 - 0.30
            objs += self.headrest('Headrest', x, self.y_b - up_d / 2, up_z, 'x')
            placed += 1
            if count > placed and bx1 - bx0 > 1.2:
                objs += self.headrest('Headrest', bx1 - 0.30 if x < 0 else bx0 + 0.30, self.y_b - up_d / 2, up_z, 'x')
        # floor grate
        if cfg['floor_grate']:
            grate = []
            y_front = self.y_f + 0.02
            y_back = (self.lower_bench['y0'] if self.lower_bench else self.y_b - up_d) - 0.02
            gx0 = self.x_l + 0.02 + (up_d if any(s < 0 for s, *_ in side_benches) else 0)
            gx1 = self.x_r - 0.02 - (up_d if any(s > 0 for s, *_ in side_benches) else 0)
            if y_back - y_front > 0.2 and gx1 - gx0 > 0.3:
                runner_z = 0.014
                for x in (gx0 + 0.05, gx1 - 0.05, (gx0 + gx1) / 2):
                    if zone and zone[0] < x < zone[1]:
                        continue
                    grate.append(box('Floor grate runner', (x, (y_front + y_back) / 2, runner_z), (0.045, y_back - y_front, 0.028), coll, self.bench_mat, 0.002))
                count_s = int((y_back - y_front) / 0.075)
                for i in range(count_s):
                    y = y_front + (i + 0.5) * (y_back - y_front) / count_s
                    pieces = [(gx0, gx1)]
                    if zone and zone[2] - 0.02 < y < zone[3] + 0.02:
                        pieces = subtract_intervals((gx0, gx1), [(zone[0] - 0.02, zone[1] + 0.02)])
                    for a, b in pieces:
                        grate.append(box(f'Floor grate slat {i + 1}', ((a + b) / 2, y, 0.028 + 0.011), (b - a, 0.06, 0.022), coll, self.bench_mat, 0.002))
                tag(grate, 'interior', 'BODENROST', 'Bodenrost (im Lieferumfang)', 0, ((gx1 - gx0) * 1000, (y_back - y_front) * 1000, 50), included_in='cabin')
                for g in grate:
                    g.parent = root
        untagged = [o for o in objs if 'sku' not in o]
        tag(untagged, 'interior', self.cfg['interior']['material'], f'Inneneinrichtung {interior_name}, Liegen {up_d * 100:.0f}/{lo_d * 100:.0f} cm', self.interior['price'],
            ((bx1 - bx0) * 1000, up_d * 1000, up_z * 1000), layout=layout)
        tag(root, 'interior', self.cfg['interior']['material'], f'Inneneinrichtung {interior_name}', self.interior['price'], (self.W * 1000, self.D * 1000, up_z * 1000), layout=layout)
        for o in objs:
            if o.parent is None:
                o.parent = root

    # -- lighting --------------------------------------------------------------
    def build_lighting(self):
        cfg = self.cfg
        coll = self.colls['Lighting']
        mats = self.mat
        side = -self.heater_side
        for sku in cfg['lighting']:
            spec = CATALOG['lighting'].get(sku)
            if not spec:
                continue
            parts = []
            kind = spec['kind']
            if kind == 'wall_lamp':
                x = self.x_l if side < 0 else self.x_r
                parts += lamp_parts(coll, mats, x, self.y_f + 0.42, 1.62, -side)
            elif kind == 'backrest_strip' and self.benches:
                length = min(spec['length_m'], sum(b['x1'] - b['x0'] for b in self.benches) - 0.1)
                b = self.benches[0]
                x0 = b['x0'] + 0.05
                x1 = min(b['x1'] - 0.05, x0 + length)
                z = 1.04 + 0.13 + 0.095 + 0.006
                parts.append(box('LED strip warm white', ((x0 + x1) / 2, self.y_b - 0.03, z), (x1 - x0, 0.010, 0.003), coll, mats['led_warm'], 0))
                light = bpy.data.lights.new('LED strip light', 'AREA')
                light.energy = 12
                light.color = (1, 0.75, 0.45)
                light.shape = 'RECTANGLE'
                light.size = x1 - x0
                light.size_y = 0.02
                lamp = bpy.data.objects.new('LED strip area light', light)
                coll.objects.link(lamp)
                lamp.location = ((x0 + x1) / 2, self.y_b - 0.035, z + 0.004)
                parts.append(lamp)
            elif kind == 'under_bench' and self.benches:
                b = self.benches[0]
                strips = spec['strips']
                span = b['x1'] - b['x0'] - 0.2
                pitch = span / strips
                y = b['y0'] + 0.03
                z = b['z'] - self.slat - 0.11
                for i in range(strips):
                    x = b['x0'] + 0.1 + (i + 0.5) * pitch
                    parts.append(box(f'Lumia LED strip {i + 1}', (x, y, z), (min(0.67, pitch - 0.02), 0.012, 0.005), coll, mats['led_rgb'], 0))
                light = bpy.data.lights.new('Lumia light', 'AREA')
                light.energy = 10
                light.color = (0.7, 0.45, 1)
                light.shape = 'RECTANGLE'
                light.size = span
                light.size_y = 0.02
                lamp = bpy.data.objects.new('Lumia area light', light)
                coll.objects.link(lamp)
                lamp.location = ((b['x0'] + b['x1']) / 2, y - 0.01, z - 0.005)
                lamp.rotation_euler = (math.radians(90), 0, 0)
                parts.append(lamp)
            else:
                continue
            tag(parts, 'lighting', sku, spec['name_de'], spec['price'], spec['dims_mm'])

    # -- accessories ------------------------------------------------------------
    def build_accessories(self):
        cfg = self.cfg
        coll = self.colls['Accessories']
        mats = self.mat
        zone = self.heater_zone
        side = self.heater_side
        for sku in cfg['accessories']:
            spec = CATALOG['accessories'].get(sku)
            if not spec:
                continue
            parts = []
            kind = spec['kind']
            if kind == 'set':
                x = (zone[0] - 0.22 if side > 0 else zone[1] + 0.22) if zone else 0.3
                parts += bucket_parts(spec, coll, mats, x, self.y_f + 0.30)
                for p in parts:
                    p.location.z += 0.05
                if not spec.get('no_wall'):
                    wx = -side * (self.W / 2 - self.t - 0.3)
                    parts += instrument_parts(coll, mats, wx, self.y_b - 0.045, 1.58, side)
            elif kind == 'evaporator' and self.heater_top:
                parts += evaporator_parts(coll, mats, self.heater_pos[0], self.heater_pos[1], self.heater_top)
            elif kind == 'speakers':
                for x in (self.x_l + 0.25, self.x_r - 0.25):
                    parts += speaker_parts(coll, mats, x, self.y_b - 0.045, self.z_c - 0.16)
            elif kind == 'ergo_backrest' and self.benches:
                b = self.benches[0]
                parts += ergo_backrest_parts(coll, b['x0'] + 0.45 if side > 0 else b['x1'] - 0.45, b['y0'], b['z'])
            elif kind == 'foot_mat' and self.lower_bench:
                lb = self.lower_bench
                parts.append(box('Foot warming mat', ((lb['x0'] + lb['x1']) / 2, lb['y0'] - 0.35, 0.055), (0.61, 0.41, 0.008), coll, mats['grate_black'], 0.001))
            elif kind == 'plunge_tub':
                parts += tub_parts(coll, mats, -side * (self.W / 2 + 0.9), -self.D / 2, side)
            elif kind == 'plunge_lid':
                parts += lid_parts(coll, -side * (self.W / 2 + 0.9), -self.D / 2)
            else:
                continue
            tag(parts, 'accessory', sku, spec['name_de'], spec['price'], spec['dims_mm'], dims_approx=bool(spec.get('approx')))

    # -- ventilation ----------------------------------------------------------
    def build_ventilation(self):
        if not self.cfg['ventilation'] or not self.heater_pos:
            return
        coll = self.colls['Ventilation']
        hx, hy, hz0, hh, at_back = self.heater_pos
        r = -1 if at_back else 1
        wall_y = self.y_f + 0.012 if not at_back else self.y_b - 0.012
        parts = grille_parts(coll, self.bench_mat, hx, wall_y, 0.15, r, 0.15, 3)
        ox = -self.heater_side * (self.W / 2 - self.t - 0.25)
        oy = self.y_b - 0.012 if not at_back else self.y_f + 0.012
        parts += grille_parts(coll, self.bench_mat, ox, oy, self.z_c - 0.20, -r, 0.20, 0, slider=True)
        tag(parts, 'cabin', 'VENT', 'Zu- und Abluft (im Lieferumfang)', 0, (200, 24, 100), included_in='cabin')

    # -- presentation ----------------------------------------------------------
    def build_presentation(self):
        coll = get_collection('Presentation', get_collection(TOP_COLLECTION))
        clear_collection(coll)
        S = max(self.W, self.D)
        floor = box('Studio floor - not exported', (0, -self.D / 2, -0.022), (40, 40, 0.04), coll, self.mat['studio'], 0)
        floor['export'] = False
        cam = bpy.data.cameras.new('Camera - exterior')
        cam.type = 'ORTHO'
        cam.ortho_scale = 1.55 * S + 1.3
        cam.clip_end = 100
        camera = bpy.data.objects.new('Camera - exterior', cam)
        coll.objects.link(camera)
        target = Vector((-0.1 * S, -self.D / 2, self.H * 0.48))
        camera.location = target + Vector((3.25, -5.2, 2.85)) * (S / 1.4 + 0.5)
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        cutaway = bpy.data.cameras.new('Camera - cutaway')
        cutaway.type = 'ORTHO'
        cutaway.ortho_scale = 1.4 * S + 1.0
        cutaway.clip_end = 100
        cut = bpy.data.objects.new('Camera - cutaway', cutaway)
        coll.objects.link(cut)
        target = Vector((0, -self.D * 0.55, self.H * 0.42))
        cut.location = target + Vector((2.7, -4.0, 3.4)) * (S / 1.4 + 0.5)
        cut.rotation_euler = (target - cut.location).to_track_quat('-Z', 'Y').to_euler()
        interior = bpy.data.cameras.new('Camera - interior')
        interior.lens = 16
        interior.clip_start = 0.02
        inter = bpy.data.objects.new('Camera - interior', interior)
        coll.objects.link(inter)
        seg = self.door_info['seg']
        p = seg['p0'] + seg['d'] * ((self.door_info['u0'] + self.door_info['u1']) / 2) + seg['n'] * (self.t + 0.05)
        inter.location = (p.x, p.y, 1.45)
        target = Vector((self.heater_side * 0.1 * self.W, self.y_b - 0.4, 0.95))
        inter.rotation_euler = (target - inter.location).to_track_quat('-Z', 'Y').to_euler()
        for name, pos, energy, size, color in [
            ('Key softbox', (1.5, -3.4, 4.5), 450, 3.0, (1, 0.93, 0.82)),
            ('Fill softbox', (-3, -1.8, 2.8), 260, 2.5, (0.82, 0.9, 1)),
            ('Top softbox', (1.0, 1.5, 4), 350, 2.0, (1, 1, 1)),
        ]:
            light = bpy.data.lights.new(name, 'AREA')
            light.energy = energy * (S / 1.4) ** 1.5
            light.shape = 'DISK'
            light.size = size
            light.color = color
            obj = bpy.data.objects.new(name, light)
            coll.objects.link(obj)
            obj.location = Vector(pos) * (S / 1.4 + 0.3)
            obj.rotation_euler = (Vector((0, -self.D / 2, 1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
        for obj in coll.objects:
            obj['export'] = False
        bpy.context.scene.camera = camera
        self.cameras = {'exterior': camera, 'cutaway': cut, 'interior': inter}

    # -- orchestration ---------------------------------------------------------
    def build(self, presentation=True):
        scene = bpy.context.scene
        scene.unit_settings.system = 'METRIC'
        scene.unit_settings.length_unit = 'METERS'
        self.prepare_collections()
        self.plan()
        self.layout_front()
        self.build_walls()
        self.build_openings()
        self.build_door()
        self.build_heater()
        self.build_control()
        self.build_interior()
        self.build_lighting()
        self.build_accessories()
        self.build_ventilation()
        if presentation:
            self.build_presentation()
        items, total, warnings = price_items(self.cfg)
        self.warnings = warnings + self.warnings
        summary = {'config': self.cfg, 'items': items, 'total_chf': total,
                   'total_excl_vat_chf': round(total / (1 + CATALOG.get('meta', {}).get('vat_rate', 0.081)), 2),
                   'warnings': self.warnings,
                   'cabin_bounds_m': {'x': [-self.W / 2, self.W / 2], 'y': [-self.D, 0], 'z': [0, self.H]},
                   'volume_m3': round(self.W * self.D * self.H, 2)}
        scene['sauna_config'] = json.dumps(self.cfg)
        scene['sauna_summary'] = json.dumps(summary)
        scene['sauna_total_chf'] = total
        text = bpy.data.texts.get('Konfiguration') or bpy.data.texts.new('Konfiguration')
        text.clear()
        text.write(format_summary(summary))
        return summary


def format_summary(summary):
    lines = ['SAUNA KONFIGURATION', '']
    cfg = summary['config']
    lines.append(f'Familie: {cfg["family"]}  Masse: {cfg["width_cm"]} x {cfg["depth_cm"]} x {cfg["height_cm"]} cm  ({summary["volume_m3"]} m3)')
    lines.append(f'Einstieg: {cfg["entry"]}  Tuere: {cfg["door"]["hinge"]}  Layout: {cfg["interior"]["layout"]}')
    lines.append('')
    lines.append(f'{"Pos":>3} {"Art.Nr.":<22} {"Bezeichnung":<80} {"CHF":>10}')
    for i, item in enumerate(summary['items'], 1):
        note = f'  [{item["note"]}]' if item.get('note') else ''
        lines.append(f'{i:>3} {item["sku"]:<22} {(item["name_de"] + note)[:80]:<80} {item["price_chf"]:>10.2f}')
    lines.append('')
    lines.append(f'{"Gesamtbetrag inkl. 8.1% MwSt":<107} {summary["total_chf"]:>10.2f}')
    lines.append(f'{"Gesamt exkl. MwSt":<107} {summary["total_excl_vat_chf"]:>10.2f}')
    if summary['warnings']:
        lines.append('')
        lines.append('Hinweise:')
        lines += [f' - {w}' for w in summary['warnings']]
    return '\n'.join(lines)


# ----------------------------------------------------------------------------
# Export, render and headless entry point
# ----------------------------------------------------------------------------

def set_door(angle_degrees):
    pivot = bpy.data.objects.get('Door swing pivot')
    if pivot:
        sign = 1 if pivot['open_rotation_degrees'] < 0 else -1
        pivot.rotation_euler = (0, 0, math.radians(-sign * abs(angle_degrees)))


def export_glb(filepath, draco=True):
    """Export the generated sauna (not the presentation rig) as one GLB with extras."""
    filepath = Path(filepath)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    top = bpy.data.collections.get(TOP_COLLECTION)
    set_door(0)
    for obj in bpy.data.objects:
        obj.select_set(False)
    for coll in top.children:
        if coll.name == 'Presentation':
            continue
        for obj in coll.objects:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(filepath), export_format='GLB', use_selection=True, use_active_scene=True,
        export_yup=True, export_animations=False, export_extras=True, export_apply=True,
        export_lights=True,
        export_draco_mesh_compression_enable=draco, export_draco_mesh_compression_level=6,
    )
    summary = json.loads(bpy.context.scene['sauna_summary'])
    filepath.with_suffix('.config.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    return filepath


def render(prefix, views=('exterior', 'cutaway', 'interior'), samples=48, size=1100):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new('Soft studio world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.7, 0.75, 0.8, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    outputs = []
    cfg = json.loads(scene['sauna_config'])
    # Force the door closed before the FIRST view too, not just between views.
    # The loop below resets to closed AFTER each view, but assumed build() left
    # it closed to begin with - true for most entry types, but corner_glasfront's
    # door pivot came out of build() already rotated open, so an exterior-only
    # render (no cutaway/interior first) shipped with the door hanging ajar.
    set_door(0)
    for view in views:
        camera = bpy.data.objects.get(f'Camera - {view}')
        if camera is None:
            continue
        scene.camera = camera
        hidden = []
        if view == 'cutaway':
            for name in ('Cabin - roof', 'Cabin - right'):
                coll = bpy.data.collections.get(name)
                if coll:
                    coll.hide_render = True
                    hidden.append(coll)
            set_door(75)
        if view == 'interior':
            set_door(90)
        path = Path(f'{prefix}-{view}.png')
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        for coll in hidden:
            coll.hide_render = False
        set_door(0)
        outputs.append(path)
    return outputs


def build(config=None, presentation=True):
    builder = SaunaBuilder(config or {})
    summary = builder.build(presentation)
    return builder, summary


def clean_default_scene():
    for name in ('Cube', 'Light', 'Camera'):
        obj = bpy.data.objects.get(name)
        if obj and not obj.users_collection[0].name.startswith(TOP_COLLECTION):
            bpy.data.objects.remove(obj, do_unlink=True)


def main_cli(argv):
    import argparse
    parser = argparse.ArgumentParser(description='Build a sauna configuration headlessly.')
    parser.add_argument('--config', help='JSON configuration file')
    parser.add_argument('--save', help='Save .blend to this path')
    parser.add_argument('--glb', help='Export GLB to this path')
    parser.add_argument('--json', help='Write the price/summary JSON here')
    parser.add_argument('--render', help='Render prefix; writes <prefix>-exterior/cutaway/interior.png')
    parser.add_argument('--views', default='exterior,cutaway,interior')
    parser.add_argument('--samples', type=int, default=48)
    parser.add_argument('--size', type=int, default=1100)
    args = parser.parse_args(argv)
    config = json.loads(Path(args.config).read_text(encoding='utf-8')) if args.config else {}
    clean_default_scene()
    builder, summary = build(config)
    print(format_summary(summary))
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    if args.glb:
        export_glb(args.glb)
    if args.render:
        render(args.render, tuple(v for v in args.views.split(',') if v), args.samples, args.size)
    if args.save:
        Path(args.save).parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.save).resolve()))
    return summary


# ----------------------------------------------------------------------------
# Blender UI: "Sauna" tab in the 3D viewport sidebar
# ----------------------------------------------------------------------------

def _enum(items):
    return [(k, v, '') for k, v in items]


def _family_items(self, context):
    return [(k, f['name_de'], '') for k, f in CATALOG['families'].items()]


def _width_items(self, context):
    fam = CATALOG['families'][self.family]
    if 'sizes' in fam:
        values = sorted({s['w'] for s in fam['sizes']})
    else:
        values = sorted(int(k) for k in fam['width_cm'])
    return [(str(v), f'{v} cm', '') for v in values]


def _depth_items(self, context):
    fam = CATALOG['families'][self.family]
    if 'sizes' in fam:
        values = sorted({s['d'] for s in fam['sizes']})
    else:
        values = sorted(int(k) for k in fam['depth_cm'])
    return [(str(v), f'{v} cm', '') for v in values]


def _interior_items(self, context):
    fam = CATALOG['families'][self.family]
    return [(k, f'{CATALOG["interiors"][k]["name_de"]} (+{CATALOG["interiors"][k]["price"]})', '') for k in fam['interior_options']]


def _heater_items(self, context):
    return [(k, f'{h["kw"]} kW - CHF {h["price"]} - {h["name_de"][:48]}', '') for k, h in CATALOG['heaters'].items()]


def _control_items(self, context):
    return [(k, f'{c["name_de"]} (CHF {c["price"]})', '') for k, c in CATALOG['controls'].items()]


def _flag_name(prefix, key):
    return prefix + '_' + key.replace('-', '_').replace('.', '_').lower()


class SaunaSettings(bpy.types.PropertyGroup):
    family: bpy.props.EnumProperty(name='Familie', items=_family_items)
    width: bpy.props.EnumProperty(name='Breite', items=_width_items)
    depth: bpy.props.EnumProperty(name='Tiefe', items=_depth_items)
    custom_size: bpy.props.BoolProperty(name='Freies Mass (auf Anfrage)', default=False)
    width_cm: bpy.props.IntProperty(name='Breite cm', default=200, min=100, max=400)
    depth_cm: bpy.props.IntProperty(name='Tiefe cm', default=180, min=100, max=400)
    height_cm: bpy.props.IntProperty(name='Hoehe cm', default=202, min=180, max=240)
    orientation: bpy.props.EnumProperty(name='Bretter', items=_enum([('horizontal', 'waagrecht'), ('vertical', 'senkrecht')]))
    entry: bpy.props.EnumProperty(name='Einstieg', items=_enum([('front', 'Fronteinstieg'), ('corner', 'Eckeinstieg'), ('glasfront', 'Glasfront'), ('corner_glasfront', 'Eckeinstieg + Glasfront'), ('glass_corner', 'Glaseck')]))
    cladding: bpy.props.EnumProperty(name='Aussen', items=_enum([('none', 'Holz sichtbar'), ('schiefer', 'Schieferplatten (+1700)'), ('altholz', 'Altholz Fichte (+2200)')]))
    hinge: bpy.props.EnumProperty(name='Anschlag', items=_enum([('left', 'DIN links'), ('right', 'DIN rechts')]))
    door_position: bpy.props.EnumProperty(name='Tuerposition', items=_enum([('left', 'links'), ('centre', 'mittig'), ('right', 'rechts')]))
    corner: bpy.props.EnumProperty(name='Eck-Seite', items=_enum([('right', 'rechts'), ('left', 'links')]))
    window: bpy.props.EnumProperty(name='Fenster', items=_enum([('auto', 'automatisch'), ('none', 'kein Fenster'), ('60', '60 cm'), ('80', '80 cm'), ('100', '100 cm')]))
    interior: bpy.props.EnumProperty(name='Inneneinrichtung', items=_interior_items)
    layout: bpy.props.EnumProperty(name='Liegen', items=_enum([('straight', 'gerade (2 Ebenen)'), ('L', 'L-Form'), ('U', 'U-Form')]))
    upper_depth: bpy.props.IntProperty(name='Obere Liege Tiefe cm', default=50, min=40, max=70)
    lower_depth: bpy.props.IntProperty(name='Untere Liege Tiefe cm', default=30, min=25, max=50)
    upper_height: bpy.props.IntProperty(name='Obere Liege Hoehe cm', default=86, min=75, max=100)
    lower_height: bpy.props.IntProperty(name='Untere Liege Hoehe cm', default=44, min=35, max=55)
    backrests: bpy.props.BoolProperty(name='Rueckenlehnen', default=True)
    side_backrests: bpy.props.BoolProperty(name='Seitliche Rueckenlehnen', default=True)
    apron: bpy.props.BoolProperty(name='Zwischenbankverkleidung', default=True)
    floor_grate: bpy.props.BoolProperty(name='Bodenrost', default=True)
    headrests: bpy.props.IntProperty(name='Kopfstuetzen', default=2, min=0, max=3)
    sliding_stool: bpy.props.BoolProperty(name='Hocker verschiebbar', default=True)
    heater: bpy.props.EnumProperty(name='Saunaofen', items=_heater_items)
    heater_position: bpy.props.EnumProperty(name='Ofenposition', items=_enum([('front_right', 'vorne rechts'), ('front_left', 'vorne links'), ('back_right', 'hinten rechts'), ('back_left', 'hinten links'), ('centre_back', 'hinten mittig')]))
    control: bpy.props.EnumProperty(name='Steuerung', items=_control_items)
    ventilation: bpy.props.BoolProperty(name='Zu-/Abluft', default=True)
    door_open: bpy.props.FloatProperty(name='Tuer oeffnen', default=0, min=0, max=90, subtype='ANGLE' if False else 'NONE')


for _key in CATALOG['lighting']:
    SaunaSettings.__annotations__[_flag_name('light', _key)] = bpy.props.BoolProperty(name=CATALOG['lighting'][_key]['name_de'][:40], default=_key in DEFAULT_CONFIG['lighting'])
for _key in CATALOG['accessories']:
    SaunaSettings.__annotations__[_flag_name('acc', _key)] = bpy.props.BoolProperty(name=CATALOG['accessories'][_key]['name_de'][:40], default=_key in DEFAULT_CONFIG['accessories'])
for _key in CATALOG['services']:
    SaunaSettings.__annotations__[_flag_name('srv', _key)] = bpy.props.BoolProperty(name=CATALOG['services'][_key]['name_de'][:40], default=_key in DEFAULT_CONFIG['services'])


def settings_to_config(s):
    return {
        'family': s.family,
        'width_cm': s.width_cm if s.custom_size else int(s.width),
        'depth_cm': s.depth_cm if s.custom_size else int(s.depth),
        'height_cm': s.height_cm,
        'board_orientation': s.orientation,
        'cladding': s.cladding,
        'entry': s.entry,
        'door': {'hinge': s.hinge, 'position': s.door_position, 'corner': s.corner},
        'window': s.window,
        'interior': {'material': s.interior, 'layout': s.layout, 'upper_depth_cm': s.upper_depth, 'lower_depth_cm': s.lower_depth,
                     'upper_height_cm': s.upper_height, 'lower_height_cm': s.lower_height, 'backrests': s.backrests,
                     'side_backrests': s.side_backrests, 'apron': s.apron, 'floor_grate': s.floor_grate,
                     'headrests': s.headrests, 'sliding_stool': s.sliding_stool},
        'heater': {'sku': s.heater, 'position': s.heater_position},
        'control': s.control,
        'lighting': [k for k in CATALOG['lighting'] if getattr(s, _flag_name('light', k))],
        'accessories': [k for k in CATALOG['accessories'] if getattr(s, _flag_name('acc', k))],
        'ventilation': s.ventilation,
        'services': [k for k in CATALOG['services'] if getattr(s, _flag_name('srv', k))],
    }


def config_to_settings(cfg, s):
    cfg = normalise(cfg)
    s.family = cfg['family']
    fam = CATALOG['families'][cfg['family']]
    widths = [int(k) for k in fam['width_cm']] if 'width_cm' in fam else sorted({x['w'] for x in fam['sizes']})
    depths = [int(k) for k in fam['depth_cm']] if 'depth_cm' in fam else sorted({x['d'] for x in fam['sizes']})
    s.custom_size = cfg['width_cm'] not in widths or cfg['depth_cm'] not in depths
    if not s.custom_size:
        s.width, s.depth = str(cfg['width_cm']), str(cfg['depth_cm'])
    s.width_cm, s.depth_cm, s.height_cm = cfg['width_cm'], cfg['depth_cm'], cfg['height_cm']
    s.orientation, s.entry, s.cladding = cfg['board_orientation'], cfg['entry'], cfg.get('cladding', 'none')
    s.hinge, s.door_position, s.corner = cfg['door']['hinge'], cfg['door']['position'], cfg['door']['corner']
    s.window = str(cfg['window']) if str(cfg['window']) in ('auto', 'none', '60', '80', '100') else 'auto'
    i = cfg['interior']
    s.interior, s.layout = i['material'], i['layout']
    s.upper_depth, s.lower_depth, s.upper_height, s.lower_height = i['upper_depth_cm'], i['lower_depth_cm'], i['upper_height_cm'], i['lower_height_cm']
    s.backrests, s.side_backrests, s.apron, s.floor_grate, s.headrests, s.sliding_stool = i['backrests'], i['side_backrests'], i['apron'], i['floor_grate'], int(i['headrests']), i['sliding_stool']
    s.heater, s.heater_position, s.control, s.ventilation = cfg['heater']['sku'], cfg['heater']['position'], cfg['control'], cfg['ventilation']
    for k in CATALOG['lighting']:
        setattr(s, _flag_name('light', k), k in cfg['lighting'])
    for k in CATALOG['accessories']:
        setattr(s, _flag_name('acc', k), k in cfg['accessories'])
    for k in CATALOG['services']:
        setattr(s, _flag_name('srv', k), k in cfg['services'])


class SAUNA_OT_rebuild(bpy.types.Operator):
    bl_idname = 'sauna.rebuild'
    bl_label = 'Sauna neu aufbauen'
    bl_description = 'Rebuild the sauna from the settings above'

    def execute(self, context):
        cfg = settings_to_config(context.scene.sauna)
        builder, summary = build(cfg)
        set_door(context.scene.sauna.door_open)
        for w in summary['warnings']:
            self.report({'WARNING'}, w)
        self.report({'INFO'}, f'Gesamt CHF {summary["total_chf"]:.2f}')
        return {'FINISHED'}


class SAUNA_OT_export(bpy.types.Operator):
    bl_idname = 'sauna.export_glb'
    bl_label = 'GLB exportieren'
    filepath: bpy.props.StringProperty(subtype='FILE_PATH', default=str(ROOT / 'output' / 'blender' / 'configurator' / 'sauna.glb'))

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

    def execute(self, context):
        path = export_glb(self.filepath)
        self.report({'INFO'}, f'Exportiert: {path}')
        return {'FINISHED'}


class SAUNA_OT_save_config(bpy.types.Operator):
    bl_idname = 'sauna.save_config'
    bl_label = 'Konfiguration speichern (JSON)'
    filepath: bpy.props.StringProperty(subtype='FILE_PATH', default=str(ROOT / 'output' / 'blender' / 'configurator' / 'config.json'))

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

    def execute(self, context):
        summary = json.loads(context.scene.get('sauna_summary', '{}')) or {'config': settings_to_config(context.scene.sauna)}
        Path(self.filepath).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
        return {'FINISHED'}


class SAUNA_OT_load_config(bpy.types.Operator):
    bl_idname = 'sauna.load_config'
    bl_label = 'Konfiguration laden (JSON)'
    filepath: bpy.props.StringProperty(subtype='FILE_PATH')

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

    def execute(self, context):
        data = json.loads(Path(self.filepath).read_text(encoding='utf-8'))
        config_to_settings(data.get('config', data), context.scene.sauna)
        return bpy.ops.sauna.rebuild()


class SAUNA_OT_door(bpy.types.Operator):
    bl_idname = 'sauna.door'
    bl_label = 'Tuer auf/zu'

    def execute(self, context):
        s = context.scene.sauna
        s.door_open = 0 if s.door_open > 1 else 90
        set_door(s.door_open)
        return {'FINISHED'}


class SAUNA_PT_panel(bpy.types.Panel):
    bl_label = 'Sauna Konfigurator'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Sauna'

    def draw(self, context):
        s = context.scene.sauna
        layout = self.layout
        col = layout.column(align=True)
        col.prop(s, 'family')
        col.prop(s, 'custom_size')
        if s.custom_size:
            col.prop(s, 'width_cm')
            col.prop(s, 'depth_cm')
        else:
            col.prop(s, 'width')
            col.prop(s, 'depth')
        col.prop(s, 'height_cm')
        col.prop(s, 'orientation')
        col.prop(s, 'cladding')
        box_ = layout.box()
        box_.label(text='Front und Tuere', icon='MOD_WIREFRAME')
        box_.prop(s, 'entry')
        box_.prop(s, 'hinge')
        if s.entry in ('corner', 'corner_glasfront', 'glass_corner'):
            box_.prop(s, 'corner')
        else:
            box_.prop(s, 'door_position')
        if s.entry in ('front', 'corner'):
            box_.prop(s, 'window')
        box_ = layout.box()
        box_.label(text='Inneneinrichtung', icon='OUTLINER_OB_ARMATURE')
        box_.prop(s, 'interior')
        box_.prop(s, 'layout')
        row = box_.row(align=True)
        row.prop(s, 'upper_depth')
        row.prop(s, 'lower_depth')
        row = box_.row(align=True)
        row.prop(s, 'upper_height')
        row.prop(s, 'lower_height')
        for name in ('backrests', 'side_backrests', 'apron', 'floor_grate', 'sliding_stool'):
            box_.prop(s, name)
        box_.prop(s, 'headrests')
        box_ = layout.box()
        box_.label(text='Ofen und Steuerung', icon='LIGHT_SUN')
        box_.prop(s, 'heater')
        box_.prop(s, 'heater_position')
        box_.prop(s, 'control')
        box_.prop(s, 'ventilation')
        box_ = layout.box()
        box_.label(text='Beleuchtung', icon='LIGHT')
        for k in CATALOG['lighting']:
            box_.prop(s, _flag_name('light', k), text=f'{CATALOG["lighting"][k]["name_de"][:34]} ({CATALOG["lighting"][k]["price"]})')
        box_ = layout.box()
        box_.label(text='Zubehoer', icon='PACKAGE')
        for k in CATALOG['accessories']:
            box_.prop(s, _flag_name('acc', k), text=f'{CATALOG["accessories"][k]["name_de"][:34]} ({CATALOG["accessories"][k]["price"]})')
        box_ = layout.box()
        box_.label(text='Montage / Lieferung', icon='TOOL_SETTINGS')
        for k in CATALOG['services']:
            box_.prop(s, _flag_name('srv', k), text=f'{CATALOG["services"][k]["name_de"][:34]} ({CATALOG["services"][k]["price"]})')
        layout.separator()
        layout.operator('sauna.rebuild', icon='FILE_REFRESH')
        row = layout.row(align=True)
        row.operator('sauna.door', icon='ARROW_LEFTRIGHT')
        row.operator('sauna.export_glb', icon='EXPORT')
        row = layout.row(align=True)
        row.operator('sauna.save_config', icon='FILE_TICK')
        row.operator('sauna.load_config', icon='FILE_FOLDER')
        total = context.scene.get('sauna_total_chf')
        if total is not None:
            layout.label(text=f'Gesamt inkl. MwSt: CHF {total:,.2f}'.replace(',', "'"), icon='FUND')
        summary = context.scene.get('sauna_summary')
        if summary:
            for w in json.loads(summary).get('warnings', [])[:6]:
                layout.label(text=w[:60], icon='ERROR')


class SAUNA_PT_selected(bpy.types.Panel):
    bl_label = 'Ausgewaehltes Element'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Sauna'
    bl_parent_id = 'SAUNA_PT_panel'

    def draw(self, context):
        obj = context.active_object
        layout = self.layout
        if not obj or 'sku' not in obj:
            layout.label(text='Objekt anklicken, um Groesse und Preis zu sehen.')
            return
        layout.label(text=obj['name_de'][:60], icon='INFO')
        layout.label(text=f'Art.Nr. {obj["sku"]}   Kategorie: {obj["category"]}')
        layout.label(text=f'Masse (BxTxH mm): {obj["dims_mm"]}')
        price = obj['price_chf']
        included = obj.get('included_in')
        layout.label(text=f'Preis: CHF {price:,.2f}'.replace(',', "'") if price else ('Im Lieferumfang der Kabine enthalten' if included else 'CHF 0.00'))
        for key in ('kw', 'control', 'mount', 'layout', 'wifi', 'hinge'):
            if key in obj:
                layout.label(text=f'{key}: {obj[key]}')


CLASSES = [SaunaSettings, SAUNA_OT_rebuild, SAUNA_OT_export, SAUNA_OT_save_config, SAUNA_OT_load_config, SAUNA_OT_door, SAUNA_PT_panel, SAUNA_PT_selected]


def register():
    for cls in CLASSES:
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            bpy.utils.unregister_class(cls)
            bpy.utils.register_class(cls)
    bpy.types.Scene.sauna = bpy.props.PointerProperty(type=SaunaSettings)


def unregister():
    for cls in reversed(CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass
    if hasattr(bpy.types.Scene, 'sauna'):
        del bpy.types.Scene.sauna


if __name__ == '__main__':
    if bpy.app.background:
        argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
        main_cli(argv)
    else:
        register()
        scene = bpy.context.scene
        existing = scene.get('sauna_config')
        config_to_settings(json.loads(existing) if existing else DEFAULT_CONFIG, scene.sauna)
        if not existing:
            clean_default_scene()
            build(settings_to_config(scene.sauna))
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.shading.type = 'MATERIAL'
                area.spaces.active.show_region_ui = True
