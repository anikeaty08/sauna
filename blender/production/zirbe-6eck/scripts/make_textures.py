"""Build the model's material textures from HolzSauna's own product photo.

Real pixels only: every texture is cut from reference/holzsauna-589-studio.png,
then (1) rectified to undo perspective, (2) flattened to remove the photo's
baked-in lighting (LED glow, glass reflections, shading), and (3) made to tile
seamlessly. The result matches the product page by construction, rather than
approximating it with a stock or procedural texture.

    python blender/production/zirbe-6eck/scripts/make_textures.py

Writes JPEGs to blender/production/zirbe-6eck/textures/ (module sources) and
public/textures/production/{wood,slate}/ (runtime material library).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / 'blender' / 'zirbe_6eck' / 'reference' / 'holzsauna-589-studio.png'
OUT = ROOT / 'blender' / 'production' / 'zirbe-6eck' / 'textures'   # module source textures
WEB = ROOT / 'public' / 'textures' / 'production'                   # runtime material library
UP = 4  # upscale factor applied to the photo pixels


def flatten(img, radius):
    """Divide out low-frequency lighting, keep the material's own detail."""
    a = np.asarray(img).astype(np.float64)
    lum = a.mean(axis=2)
    blur = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float64)
    gain = lum.mean() / np.maximum(blur, 1)
    out = np.clip(a * gain[..., None], 0, 255)
    return Image.fromarray(out.astype(np.uint8))


def seamless_x(img, fade=0.25):
    """Tile horizontally without a visible seam: cross-fade against a
    half-rolled copy near the left/right edges only."""
    a = np.asarray(img).astype(np.float64)
    w = a.shape[1]
    rolled = np.roll(a, w // 2, axis=1)
    x = np.arange(w) / (w - 1)
    edge = np.clip(np.minimum(x, 1 - x) / fade, 0, 1)            # 0 at edges, 1 inside
    weight = (0.5 - 0.5 * np.cos(np.pi * edge))[None, :, None]
    return Image.fromarray((a * weight + rolled * (1 - weight)).astype(np.uint8))


def seamless_xy(img, fade=0.3):
    return seamless_x(seamless_x(img, fade).transpose(Image.Transpose.ROTATE_90), fade).transpose(Image.Transpose.ROTATE_270)


def mean_rgb(img):
    return tuple(np.asarray(img).reshape(-1, 3).mean(axis=0))


# Board seams on the long wall behind the left glass, traced in the photo as
# lines y = k*x + b over x 112..356. Their slopes differ (perspective), so a
# rotation can't straighten them; each board is warped by a homography.
SEAMS = {1: (0.2498, 228.5), 2: (0.2072, 286.7), 3: (0.1533, 370.9)}


def _homography(dst, src):
    """PIL PERSPECTIVE coefficients mapping output pixels -> input pixels."""
    A, B = [], []
    for (u, v), (x, y) in zip(dst, src):
        A += [[u, v, 1, 0, 0, 0, -x * u, -x * v], [0, 0, 0, u, v, 1, -y * u, -y * v]]
        B += [x, y]
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()


def _board(photo, top, bot, x0=118, x1=348, W=920, H=300, inset=0.06):
    def y(s, x): return SEAMS[s][0] * x + SEAMS[s][1]
    def pt(x, t): return (x, y(top, x) + (y(bot, x) - y(top, x)) * t)
    src = [pt(x0, inset), pt(x1, inset), pt(x1, 1 - inset), pt(x0, 1 - inset)]
    dst = [(0, 0), (W, 0), (W, H), (0, H)]
    return photo.transform((W, H), Image.PERSPECTIVE, _homography(dst, src), Image.BICUBIC)


def _match(img, target):
    a = np.asarray(img).astype(np.float64)
    gain = np.array(target) / a.reshape(-1, 3).mean(axis=0)
    return Image.fromarray(np.clip(a * gain, 0, 255).astype(np.uint8))


def zirbe_boards(photo):
    """Swiss pine wall: two real boards, rectified, lit evenly, colour-matched,
    stacked as full-length rows (the real wall has no butt joints)."""
    a = seamless_x(flatten(_board(photo, 2, 3), 60))
    b = seamless_x(flatten(_board(photo, 1, 2), 60))
    b = _match(b, mean_rgb(a))
    fl, r180 = Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_180
    rows = [a, b.transpose(fl), a.transpose(r180), b.transpose(r180)]
    groove = 4
    groove_rgb = tuple(int(c * 0.5) for c in mean_rgb(a))
    W, H = a.size
    tile = Image.new('RGB', (W, (H + groove) * len(rows)), groove_rgb)
    for i, row in enumerate(rows):
        # shift each row so knots don't line up into columns
        row = Image.fromarray(np.roll(np.asarray(row), (i * W * 3) // 8, axis=1))
        tile.paste(row, (0, i * (H + groove) + groove))
    return tile.resize((tile.width * 2, tile.height * 2), Image.LANCZOS)


def slate_tiles(photo):
    """Slate cladding: the stone surface from inside one real tile on the
    solid segment (tiles there are ~40 cm wide x ~57 cm tall, joints at photo
    rows 505 and 633), laid out on that real grid with thin dark joints."""
    stone = photo.crop((971, 514, 1053, 626))                   # inside one tile, no joints
    stone = flatten(stone, 20)
    stone = stone.resize((stone.width * UP, stone.height * UP), Image.LANCZOS)

    tw, th = 400, 570                                            # px per tile at 10 px/cm
    joint = 4
    cols, rows = 2, 2
    tile = Image.new('RGB', (tw * cols, th * rows), (28, 29, 31))
    rng = np.random.default_rng(589)
    for r in range(rows):
        for c in range(cols):
            # 8 flip/rotate states so the one real crop reads as distinct tiles,
            # not an obviously mirrored repeat (transpose keeps every pixel real)
            s = stone
            if rng.random() < 0.5: s = s.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if rng.random() < 0.5: s = s.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            if rng.random() < 0.5: s = s.transpose(Image.Transpose.TRANSPOSE)
            s = s.resize((tw - joint, th - joint), Image.LANCZOS)
            # natural tile-to-tile tone variation, as in the photo
            s = Image.fromarray(np.clip(np.asarray(s).astype(float) * rng.uniform(0.88, 1.12), 0, 255).astype(np.uint8))
            tile.paste(s, (c * tw + joint // 2, r * th + joint // 2))
    return tile


def espe_slat(photo):
    """Knot-free aspen for benches and backrests, from the vertical boards
    cladding the bench end behind the left glass."""
    wood = photo.crop((112, 640, 150, 900))                      # one vertical board, clear of seams
    wood = seamless_xy(flatten(wood, 25))
    wood = wood.transpose(Image.Transpose.ROTATE_90)             # grain runs along the slat
    return wood.resize((wood.width * UP, wood.height * UP), Image.LANCZOS)


def erle_slat(photo):
    """Alder interior wood, the real surcharge option ("Erle gegen Aufpreis
    erhaeltlich"). HolzSauna's photos only ever show Espe - no dedicated Erle
    shot exists on the product page or elsewhere on the site (checked) - so
    this keeps the real aspen crop's actual grain/knot detail and remaps its
    colour to alder's typical warmer, redder tone. The texture is still real
    photographed wood grain, not synthetic noise; only the hue is not."""
    wood = photo.crop((112, 640, 150, 900))
    wood = flatten(wood, 25)
    lum = np.asarray(wood).astype(np.float64).mean(axis=2, keepdims=True) / 255
    alder_rgb = np.array([188.0, 120.0, 88.0])                  # typical alder heartwood
    tinted = Image.fromarray(np.clip(lum * alder_rgb, 0, 255).astype(np.uint8))
    tinted = seamless_xy(tinted)
    tinted = tinted.transpose(Image.Transpose.ROTATE_90)
    return tinted.resize((tinted.width * UP, tinted.height * UP), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    photo = Image.open(SRC).convert('RGB')
    for name, fn in [('zirbe_boards', zirbe_boards), ('slate_tiles', slate_tiles), ('espe', espe_slat), ('erle', erle_slat)]:
        img = fn(photo)
        img.save(OUT / f'{name}.jpg', quality=90, optimize=True)
        web = WEB / ('slate' if name.startswith('slate') else 'wood')
        web.mkdir(parents=True, exist_ok=True)
        img.save(web / f'{name}.jpg', quality=90, optimize=True)
        print(f'{name}.jpg  {img.size[0]}x{img.size[1]}  mean RGB {tuple(round(v) for v in mean_rgb(img))}')


if __name__ == '__main__':
    main()
