import json
import math
import re
import sys
from pathlib import Path

import cairo
import tempfile

from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'logo-master'))
import geometry as g

images = root / 'assets' / 'images'
store = root / 'play-store-assets'
name = 'Fama AI'
adaptive_safe = 66 / 108 * 512
splash_safe = 192 / 288 * 1152 / 2


def need(ok, *detail):
    if not ok:
        raise SystemExit(f'FAIL {detail}')


def hex_rgb(value):
    return tuple(round(c * 255) for c in g.rgb(value))


def render(path, width, height=None, opaque=False, background=False, mark=None):
    height = height or width
    surface = cairo.ImageSurface(cairo.FORMAT_RGB24 if opaque else cairo.FORMAT_ARGB32, width, height)
    ctx = cairo.Context(surface)
    if background:
        g.badge(ctx, width, height)
    if mark:
        s, centre, colours = mark
        g.draw(ctx, s, centre or (width / 2, height / 2), *colours)
    path.parent.mkdir(parents=True, exist_ok=True)
    surface.write_to_png(str(path))
    return path


def feature_graphic(path):
    width, height, s = 1024, 500, 3.4
    face = g.font(round(g.NAME_SIZE * s), 500)
    box = face.getbbox(name, anchor='ls')
    mark_width = (g.BOX[2] - g.BOX[0]) * s
    space = g.NAME_GAP * s
    left = (width - mark_width - space - (box[2] - box[0])) / 2
    centre = (left + mark_width / 2, height / 2)
    render(path, width, height, opaque=True, background=True, mark=(s, centre, g.ON_BADGE))
    image = Image.open(path).convert('RGB')
    ImageDraw.Draw(image).text((left + mark_width + space - box[0], (height - box[1] - box[3]) / 2), name,
                               font=face, fill=g.COLOURS['onPrimary'], anchor='ls')
    image.save(path)
    return path


def rgba(path):
    Image.open(path).convert('RGBA').save(path)
    return path


def write(images=images, store=store):
    return [
        render(images / 'icon.png', 1024, opaque=True, background=True, mark=(8, None, g.ON_BADGE)),
        render(images / 'adaptive-icon-background.png', 1024, opaque=True, background=True),
        render(images / 'adaptive-icon-foreground.png', 1024, mark=(7, None, g.ON_BADGE)),
        render(images / 'adaptive-icon-monochrome.png', 1024, mark=(7, None, ('onPrimary',))),
        render(images / 'splash-icon-light.png', 1152, mark=(7, None, (g.ON_LIGHT,))),
        render(images / 'splash-icon-dark.png', 1152, mark=(7, None, (g.ON_DARK,))),
        rgba(render(store / 'app-icon-512.png', 512, background=True, mark=(4, None, g.ON_BADGE))),
        feature_graphic(store / 'feature-graphic.png'),
    ]


def check_png(path, size, mode, colours=None, safe=None, badge=False):
    image = Image.open(path)
    need(image.size == size, (path, image.size))
    need(image.mode == mode, (path, image.mode))
    if mode == 'RGBA' and badge:
        need(image.getextrema()[3] == (255, 255), path)
    if badge:
        pixels = image.load()
        need(pixels[0, 0][:3] == hex_rgb(g.BADGE[0]), (path, pixels[0, 0]))
        need(pixels[size[0] - 1, size[1] - 1][:3] == hex_rgb(g.BADGE[1]), path)
    if safe:
        pixels = image.load()
        width, height = size
        for y in range(height):
            for x in range(width):
                if pixels[x, y][3]:
                    need(math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= safe, (path, x, y))
    if colours:
        solid = {p[:3] for _, p in image.getcolors(1 << 22) if p[3] == 255}
        brand = [hex_rgb(c) for c in colours]
        low, high = [tuple(f(c[i] for c in brand) for i in range(3)) for f in (min, max)]
        need(set(brand) <= solid, (path, solid))
        need(all(low[i] - 1 <= p[i] <= high[i] + 1 for p in solid for i in range(3)), (path, solid))


def tokens():
    text = (root / 'src' / 'theme.ts').read_text()
    light, dark = text.split('export const darkColors')
    pick = lambda block, key: re.search(rf"\b{key}: '(#[0-9A-F]{{6}})'", block).group(1)
    return {
        'primary': pick(light, 'primary'),
        'primaryContainer': pick(light, 'primaryContainer'),
        'onPrimary': pick(light, 'onPrimary'),
        'badgeEnd': pick(dark, 'primaryContainer'),
        'darkPrimary': pick(dark, 'primary'),
        'surface': pick(light, 'surface'),
        'darkSurface': pick(dark, 'surface'),
    }


def check_config():
    need(tokens() == g.COLOURS, ('logo-master/geometry.py COLOURS differ from src/theme.ts', tokens(), g.COLOURS))
    expo = json.loads((root / 'app.json').read_text())['expo']
    need(expo['name'] == name, expo['name'])
    need(expo['primaryColor'] == g.COLOURS['primary'])
    need(expo['android']['adaptiveIcon']['backgroundColor'] == g.COLOURS['primary'])
    splash = next(p[1] for p in expo['plugins'] if isinstance(p, list) and p[0] == 'expo-splash-screen')
    need(splash['backgroundColor'] == g.COLOURS['surface'])
    need(splash['dark']['backgroundColor'] == g.COLOURS['darkSurface'])
    need(splash['imageWidth'] * 4 == 1152, splash['imageWidth'])


def same(a, b):
    first, second = Image.open(a), Image.open(b)
    if first.size != second.size or first.mode != second.mode:
        return False
    return ImageChops.difference(first.convert('RGBA'), second.convert('RGBA')).getbbox(alpha_only=False) is None


def check_fresh():
    with tempfile.TemporaryDirectory() as scratch:
        for fresh in write(Path(scratch) / 'images', Path(scratch) / 'store'):
            committed = (images if fresh.parent.name == 'images' else store) / fresh.name
            need(committed.exists() and same(fresh, committed),
                 f'{committed.relative_to(root)} is not up to date with logo-master/geometry.py; run the build')


def check():
    check_config()
    check_fresh()
    need(g.reach() * 7 <= adaptive_safe, 'adaptive mark leaves the 66 dp safe circle')
    need(g.reach() * 7 <= splash_safe, 'splash mark leaves the 192 dp circle')
    check_png(images / 'icon.png', (1024, 1024), 'RGB', badge=True)
    check_png(images / 'adaptive-icon-background.png', (1024, 1024), 'RGB', badge=True)
    check_png(images / 'adaptive-icon-foreground.png', (1024, 1024), 'RGBA', colours=g.ON_BADGE, safe=adaptive_safe)
    check_png(images / 'adaptive-icon-monochrome.png', (1024, 1024), 'RGBA', colours=('onPrimary',), safe=adaptive_safe)
    check_png(images / 'splash-icon-light.png', (1152, 1152), 'RGBA', colours=(g.ON_LIGHT,), safe=splash_safe)
    check_png(images / 'splash-icon-dark.png', (1152, 1152), 'RGBA', colours=(g.ON_DARK,), safe=splash_safe)
    check_png(store / 'app-icon-512.png', (512, 512), 'RGBA', badge=True)
    check_png(store / 'feature-graphic.png', (1024, 500), 'RGB', badge=True)
    need(all(p.stat().st_size < 1024 * 1024 for p in store.glob('*.png')), 'a Play Store graphic is 1 MB or larger')


if __name__ == '__main__':
    if '--check' not in sys.argv:
        for path in write():
            print('wrote', path.relative_to(root))
    check()
    print('all logo asset checks passed')
