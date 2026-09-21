"""Package only deliverable files, excluding backups and local dependencies."""

import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'blender'
for name in ['validation-finished.json', 'validation-roundtrip.json', 'validation-configurations.json']:
    assert json.loads((OUTPUT / name).read_text())['status'] == 'pass', name
manifest = json.loads((OUTPUT / 'assets' / 'asset-manifest.json').read_text())
assert hashlib.sha256((OUTPUT / 'sauna-complete.blend').read_bytes()).hexdigest() == manifest['source_sha256']
for asset in manifest['assets']:
    assert hashlib.sha256((OUTPUT / 'assets' / asset['file']).read_bytes()).hexdigest() == asset['sha256']
files = [ROOT / 'OPEN-SAUNA.cmd', ROOT / 'requirements.pdf', ROOT / 'README.md', Path(__file__)]
files += list((ROOT / 'blender').glob('*.py'))
files += [OUTPUT / 'sauna-complete.blend', OUTPUT / 'README.md', OUTPUT / 'REVIEW.md']
files += list(OUTPUT.glob('validation*.json'))
for name in ['assets', 'textures', 'configurations', 'finished']:
    files += [p for p in (OUTPUT / name).rglob('*') if p.is_file() and p.suffix != '.blend1']
destination = ROOT / 'output' / 'sauna-blender-delivery.zip'
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in files:
        archive.write(path, path.relative_to(ROOT))
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
print(f'Verified {len(files)} packaged files: {destination} ({destination.stat().st_size:,} bytes)')
