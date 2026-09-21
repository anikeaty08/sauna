"""Build every preset in presets.json headlessly: summary JSON, GLB, optional renders.

    blender -b --python blender/build_presets.py -- [--render] [--only id] [--samples N] [--size PX]
"""

import bpy
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sauna_configurator as sc  # noqa: E402

OUT = HERE.parent / 'output' / 'blender' / 'configurator' / 'presets'


def main(argv):
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--views', default='exterior,cutaway,interior')
    parser.add_argument('--only')
    parser.add_argument('--samples', type=int, default=32)
    parser.add_argument('--size', type=int, default=900)
    parser.add_argument('--no-glb', action='store_true')
    args = parser.parse_args(argv)
    presets = json.loads((HERE / 'presets.json').read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    sc.clean_default_scene()
    report = []
    for preset in presets:
        if args.only and preset['id'] != args.only:
            continue
        started = time.time()
        builder, summary = sc.build(preset['config'])
        entry = {'id': preset['id'], 'total_chf': summary['total_chf'], 'warnings': summary['warnings'],
                 'objects': sum(len(c.objects) for c in bpy.data.collections[sc.TOP_COLLECTION].children if c.name != 'Presentation')}
        (OUT / f'{preset["id"]}.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
        if not args.no_glb:
            sc.export_glb(OUT / f'{preset["id"]}.glb', draco=False)
        if args.render:
            sc.render(str(OUT / preset['id']), tuple(args.views.split(',')), args.samples, args.size)
        entry['seconds'] = round(time.time() - started, 1)
        report.append(entry)
        print(json.dumps(entry, ensure_ascii=False))
    (OUT / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
