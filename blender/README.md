# Blender asset pipeline (optional, offline)

This directory is a self-contained, parametric Blender generator. It is
**not** part of the deployed web app or its Docker build — see the root
[README](../README.md). It exists to (re)produce the preset product photos
and downloadable `.glb` models that are committed under `public/assets/images/presets/`
and `public/assets/models/presets/`, and to keep the pricing/spec catalog in sync
between the Python and JS sides.

## Files

| File | Purpose |
|---|---|
| `catalog.json` | Master pricing/spec catalog (families, woods, heaters, accessories, …). Mirrored to `public/assets/data/catalog.json` for the web app. |
| `presets.json` | The ready-made designs shown in the preset picker, as full configurations. Mirrored to `public/assets/data/presets.json`. |
| `sauna_configurator.py` | Builds a complete sauna in Blender from a configuration dict, driven by `catalog.json`. Every object carries `sku`/`name`/`price_chf`/`dims_mm` custom properties, exported as glTF `extras`. |
| `build_presets.py` | Headless batch runner: builds every entry in `presets.json`, writing a summary JSON, a `.glb`, and (optionally) renders for each. |

## Usage

Requires Blender 5.x on the PATH.

Interactively (Text editor or the Blender MCP connection) — builds the
default configuration and registers a "Sauna" sidebar tab (N panel):

```python
exec(compile(open(r'blender/sauna_configurator.py', encoding='utf-8').read(), 'sauna', 'exec'),
     {'__name__': '__main__', '__file__': r'blender/sauna_configurator.py'})
```

Headless, one configuration:

```bash
blender -b --python blender/sauna_configurator.py -- --config cfg.json --save out.blend --glb out.glb --json out.json --render prefix
```

Headless, every preset at once (writes to `output/blender/configurator/presets/`, gitignored):

```bash
blender -b --python blender/build_presets.py -- --render --samples 32 --size 900
```

After regenerating, copy the presets you want to ship into `public/assets/images/presets/`,
`public/assets/models/presets/` and `public/assets/data/` — those committed copies are what
the running app and Docker build actually use.
