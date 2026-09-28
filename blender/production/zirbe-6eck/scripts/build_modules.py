"""Build every Zirbe 6-Eck module as its own editable .blend and its own GLB.

    blender -b --factory-startup --python blender/production/zirbe-6eck/scripts/build_modules.py [-- module-id ...]

Each module is built in an empty scene, validated against the module
conventions (blender/shared/scripts/module_kit.py), saved to
blender/production/zirbe-6eck/modules/<category>/<id>.blend and exported to
public/modules/<category>/<id>-<version>.glb (the URL in the module registry,
packages/configuration-core/modules/registry.ts).

Nothing here depends on the sauna's width/depth: modules are fixed-size parts
or 1 m profiles. The runtime assembler places, repeats and stretches them.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'shared' / 'scripts'))
import bpy  # noqa: E402
import module_kit as K  # noqa: E402

VERSION = '1.0.0'
HERE = Path(__file__).resolve().parents[1]
TEX = HERE / 'textures'
MODULES = []


def module(module_id, category, slots):
    def wrap(fn):
        MODULES.append((module_id, category, slots, fn))
        return fn
    return wrap


# ── exterior ────────────────────────────────────────────────────────────────
@module('slate-panel', 'exterior', {'slot:slate'})
def slate_panel(root):
    """One 400 x 570 x 12 mm riven slate tile. Origin: bottom-left corner on the
    wall surface; front face towards glTF +Z."""
    mat = K.material('slot:slate', TEX / 'slate_tiles.jpg')
    tile = K.box('slate_tile', 0.0015, 0.3985, -0.012, 0.0, 0.0015, 0.5685, mat, bevel=0.0015, parent=root)
    # front face -> one tile of the real 2 x 2 slate texture (u 0..0.5, v 0..0.5)
    uv = tile.data.uv_layers.active.data
    for poly in tile.data.polygons:
        for li in poly.loop_indices:
            co = tile.data.vertices[tile.data.loops[li].vertex_index].co
            uv[li].uv = (co.x / 0.4 * 0.5, co.z / 0.57 * 0.5)


@module('glass-profile', 'exterior', {'slot:metal'})
def glass_profile(root):
    """1 m aluminium U-channel holding the glass at the floor ("Aluminiumprofil
    am Boden") and at the head. Centred on the glass plane."""
    m = K.material('slot:metal')
    K.extrude_profile('channel', [(-0.016, 0), (0.016, 0), (0.016, 0.03), (0.011, 0.03), (0.011, 0.004), (-0.011, 0.004), (-0.011, 0.03), (-0.016, 0.03)], 1.0, m, parent=root)


# ── door ────────────────────────────────────────────────────────────────────
@module('glass-door', 'door', {'slot:glass', 'slot:metal', 'slot:bench_wood'})
def glass_door(root):
    """Frameless 8 mm clear glass door ~670 x 1875 without threshold. Origin on
    the hinge axis at floor level, leaf along +X; outside (stainless handle)
    towards glTF +Z, inside handle in wood."""
    glass, steel, wood = K.material('slot:glass'), K.material('slot:metal'), K.material('slot:bench_wood', TEX / 'espe.jpg')
    K.box('door_leaf', 0.004, 0.666, -0.004, 0.004, 0.010, 1.885, glass, bevel=0.0015, parent=root)
    for z in (0.28, 1.58):  # glass-to-glass clamping hinges
        K.box(f'hinge_{int(z * 100)}', -0.012, 0.045, -0.014, 0.014, z, z + 0.075, steel, bevel=0.003, parent=root)
    hx = 0.585
    # outside: brushed stainless two-point pull handle
    K.cylinder('handle_out', 0.0125, 0.42, (hx, -0.058, 1.02), steel, axis='Z', parent=root)
    for z in (0.86, 1.18):
        K.cylinder(f'handle_out_post_{int(z * 100)}', 0.008, 0.05, (hx, -0.03, z), steel, axis='Y', parent=root)
    # inside: wooden handle
    K.box('handle_in', hx - 0.016, hx + 0.016, 0.034, 0.058, 0.82, 1.22, wood, bevel=0.006, parent=root)
    for z in (0.86, 1.18):
        K.cylinder(f'handle_in_post_{int(z * 100)}', 0.007, 0.04, (hx, 0.022, z), steel, axis='Y', parent=root)
    K.tag(root, attach_handle=[hx, 1.02, 0.058])


# ── benches (profiles; the assembler stretches along the length axis only) ──
@module('bench-slat', 'bench', {'slot:bench_wood'})
def bench_slat(root):
    """28 x 90 mm Espe slat, 1 m along +X, top surface at y = 0, centred on z."""
    K.box('slat', 0, 1.0, -0.045, 0.045, -0.028, 0, K.material('slot:bench_wood', TEX / 'espe.jpg'), bevel=0.003, parent=root)


@module('bench-bearer', 'bench', {'slot:bench_wood'})
def bench_bearer(root):
    """45 x 45 mm bearer under the slats, 1 m along +X, top at y = 0."""
    K.box('bearer', 0, 1.0, -0.0225, 0.0225, -0.045, 0, K.material('slot:bench_wood', TEX / 'espe.jpg'), bevel=0.002, parent=root)


@module('backrest-rail', 'bench', {'slot:bench_wood'})
def backrest_rail(root):
    """Backrest rail with the slightly rounded top of the reference ("Rückenlehne
    oben leicht gerundet"). 1 m along +X, back face on the wall (y = 0), rail
    towards glTF +Z, bottom at 0."""
    prof = [(0, 0), (-0.027, 0), (-0.027, 0.08)]
    for i in range(1, 8):  # quarter-round on the room-side top edge
        a = math.pi / 2 * i / 8
        prof.append((-0.027 + 0.015 * (1 - math.cos(a)), 0.08 + 0.015 * math.sin(a)))
    prof += [(-0.012, 0.095), (0, 0.095)]
    K.extrude_profile('rail', prof, 1.0, K.material('slot:bench_wood', TEX / 'espe.jpg'), parent=root)


@module('skirt-slat', 'bench', {'slot:bench_wood'})
def skirt_slat(root):
    """Vertical cladding slat under the upper benches ("Zwischenbankverkleidung"),
    1 m tall (glTF +Y), 70 x 14 mm, front towards glTF +Z."""
    K.box('skirt', -0.035, 0.035, -0.014, 0, 0, 1.0, K.material('slot:bench_wood', TEX / 'espe.jpg'), bevel=0.002, parent=root)


# ── heaters (loaded only for the chosen heater set) ─────────────────────────
def _stones(root, w, d, top, mat, seed=7):
    import random
    rnd = random.Random(seed)
    nx, ny = max(2, int(w / 0.07)), max(2, int(d / 0.07))
    for i in range(nx):
        for j in range(ny):
            x = -w / 2 + (i + 0.5) * w / nx + rnd.uniform(-0.01, 0.01)
            y = -d / 2 + (j + 0.5) * d / ny + rnd.uniform(-0.01, 0.01)
            s = K.cylinder(f'stone_{i}_{j}', 0.03, 0.04, (x, y, top + 0.015 + rnd.uniform(0, 0.02)), mat, segments=7, parent=root)
            s.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))


def _box_heater(root, w, d, h, label_strip=True):
    black, steel, stones = K.material('slot:heater_black'), K.material('slot:metal'), K.material('slot:stones')
    wall = 0.012
    # casing with an open stone compartment on top
    K.box('casing', -w / 2, w / 2, -d / 2, d / 2, 0.02, h - 0.12, black, bevel=0.004, parent=root)
    for nm, (x0, x1, y0, y1) in {'rim_front': (-w / 2, w / 2, -d / 2, -d / 2 + wall), 'rim_back': (-w / 2, w / 2, d / 2 - wall, d / 2),
                                 'rim_left': (-w / 2, -w / 2 + wall, -d / 2, d / 2), 'rim_right': (w / 2 - wall, w / 2, -d / 2, d / 2)}.items():
        K.box(nm, x0, x1, y0, y1, h - 0.12, h, black, parent=root)
    K.box('plinth', -w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.01, d / 2 - 0.01, 0, 0.02, black, parent=root)
    if label_strip:  # brushed stainless accent stripe across the front
        K.box('accent', -w / 2 + 0.03, w / 2 - 0.03, -d / 2 - 0.002, -d / 2, h - 0.2, h - 0.19, steel, parent=root)
    for i in range(4):  # the vertical indicator slots of the reference heater
        K.box(f'slot_{i}', -0.004, 0.004, -d / 2 - 0.002, -d / 2, h * 0.42 + i * 0.05, h * 0.42 + i * 0.05 + 0.03, steel, parent=root)
    _stones(root, w - 2 * wall, d - 2 * wall, h - 0.12, stones)


@module('heater-harvia-virta', 'heater', {'slot:heater_black', 'slot:metal', 'slot:stones'})
def heater_virta(root):
    """Harvia Virta 9 kW (approx. 415 x 325 x 810 mm). Origin floor centre, front towards glTF +Z."""
    _box_heater(root, 0.415, 0.325, 0.81)


@module('heater-harvia-virta-combi', 'heater', {'slot:heater_black', 'slot:metal', 'slot:stones'})
def heater_virta_combi(root):
    """Harvia Virta Combi 9 kW: the Virta body plus the steamer's water tank on the side."""
    _box_heater(root, 0.415, 0.325, 0.81)
    K.box('water_tank', 0.2075, 0.2875, -0.12, 0.12, 0.3, 0.72, K.material('slot:heater_black'), bevel=0.004, parent=root)
    K.box('tank_lid', 0.215, 0.28, -0.1, 0.1, 0.72, 0.735, K.material('slot:metal'), parent=root)


@module('heater-eos-mythos', 'heater', {'slot:heater_black', 'slot:metal', 'slot:stones'})
def heater_mythos(root):
    """EOS Mythos S35 black 9 kW with Cubius stones (approx. 450 x 450 x 860 mm)."""
    _box_heater(root, 0.45, 0.45, 0.86)


# ── control, lighting, accessories ─────────────────────────────────────────
@module('control-eos-emostyle', 'control', {'slot:display', 'slot:heater_black'})
def control_emostyle(root):
    """EOS EmoStyle Hi touch control (black maple housing), mounted beside the
    door on the outside. Origin: wall contact, centre; front towards glTF +Z."""
    K.box('housing', -0.055, 0.055, -0.025, 0, -0.085, 0.085, K.material('slot:heater_black'), bevel=0.004, parent=root)
    K.box('touch_glass', -0.05, 0.05, -0.027, -0.025, -0.08, 0.08, K.material('slot:display'), parent=root)


@module('control-huum-uku-glass', 'control', {'slot:display', 'slot:metal'})
def control_huum(root):
    """HUUM UKU Glass WiFi control (the Harvia sets), black glass front with a
    round display, mounted beside the door on the outside. Origin: wall contact."""
    K.box('glass_front', -0.0475, 0.0475, -0.02, 0, -0.0725, 0.0725, K.material('slot:display'), bevel=0.003, parent=root)
    K.cylinder('ring', 0.024, 0.003, (0, -0.0215, 0.02), K.material('slot:metal'), axis='Y', segments=40, parent=root)


@module('downlight', 'lighting', {'slot:metal', 'slot:led'})
def downlight(root):
    """Recessed ceiling spot. Origin on the ceiling surface; hangs to glTF -Y."""
    K.cylinder('bezel', 0.04, 0.006, (0, 0, -0.003), K.material('slot:metal'), parent=root)
    K.cylinder('lens', 0.027, 0.002, (0, 0, -0.007), K.material('slot:led'), parent=root)


@module('led-strip', 'lighting', {'slot:led'})
def led_strip(root):
    """Warm-white silicone LED strip, 1 m along +X, centred."""
    K.box('strip', 0, 1.0, -0.007, 0.007, -0.003, 0.003, K.material('slot:led'), parent=root)


@module('nova-bucket-set', 'accessory', {'slot:heater_black', 'slot:bench_wood', 'slot:metal'})
def nova_bucket(root):
    """Nova set: 5 l black infusion bucket and ladle. Origin floor centre."""
    black, wood, steel = K.material('slot:heater_black'), K.material('slot:bench_wood', TEX / 'espe.jpg'), K.material('slot:metal')
    K.cylinder('bucket', 0.105, 0.2, (0, 0, 0.1), black, segments=40, parent=root, bevel=0.004)
    K.cylinder('bucket_rim', 0.108, 0.01, (0, 0, 0.2), steel, segments=40, parent=root)
    ladle = K.cylinder('ladle_handle', 0.011, 0.42, (0.02, 0, 0.3), wood, parent=root)
    ladle.rotation_euler = (0.0, 0.45, 0.0)
    K.cylinder('ladle_cup', 0.035, 0.035, (-0.07, 0, 0.12), black, parent=root)


@module('climate-station', 'accessory', {'slot:zirbe', 'slot:dial', 'slot:glass', 'slot:heater_black'})
def climate_station(root):
    """Nova set: round thermo-hygrometer in a turned Zirbe casing, with the
    hourglass beside it. Origin: wall contact; front towards glTF +Z."""
    zirbe = K.material('slot:zirbe', TEX / 'zirbe_boards.jpg')
    K.cylinder('casing', 0.07, 0.025, (0, -0.0125, 0), zirbe, axis='Y', segments=48, parent=root, bevel=0.004)
    K.cylinder('dial', 0.056, 0.002, (0, -0.026, 0), K.material('slot:dial'), axis='Y', segments=48, parent=root)
    K.box('hand', -0.002, 0.002, -0.029, -0.027, 0, 0.045, K.material('slot:heater_black'), parent=root)
    K.box('glass_bracket', 0.1, 0.16, -0.03, 0, -0.1, 0.1, zirbe, parent=root)
    K.cylinder('hourglass', 0.018, 0.13, (0.13, -0.05, 0), K.material('slot:glass'), segments=24, parent=root)


def build(module_id, category, slots, fn):
    K.reset()
    root = K.empty(module_id)
    K.tag(root, module_id=module_id, module_version=VERSION, category=category)
    fn(root)
    K.validate(module_id, root, slots)
    K.save_and_export(HERE / 'modules' / category / f'{module_id}.blend',
                      K.ROOT / 'public' / 'modules' / category / f'{module_id}-{VERSION}.glb')
    print(f'built {category}/{module_id}')


if __name__ == '__main__':
    wanted = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for spec in MODULES:
        if not wanted or spec[0] in wanted:
            build(*spec)
