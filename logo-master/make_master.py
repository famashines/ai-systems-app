import math
from pathlib import Path

import cairo
from PIL import Image, ImageDraw

import geometry as g

here = Path(__file__).parent
grid_light = '#ECEFF4'
grid_dark = '#C4C6D0'
ink = '#1A1C20'
note = '#B3261E'


def surface_png(surface, path):
    surface.write_to_png(str(path))
    return Image.open(path).convert('RGB')


def construction(path):
    size, height, s = 1400, 1600, 14
    c = (size / 2, 130 + g.VIEW / 2 * s)
    surface = cairo.ImageSurface(cairo.FORMAT_RGB24, size, height)
    ctx = cairo.Context(surface)
    ctx.set_source_rgb(1, 1, 1)
    ctx.paint()
    half = g.VIEW / 2
    for i in range(-int(half), int(half) + 1):
        ctx.set_source_rgb(*g.rgb(grid_dark if i % 4 == 0 else grid_light))
        ctx.set_line_width(1)
        for a, b in (((g.OPTICAL[0] + i, g.OPTICAL[1] - half), (g.OPTICAL[0] + i, g.OPTICAL[1] + half)),
                     ((g.OPTICAL[0] - half, g.OPTICAL[1] + i), (g.OPTICAL[0] + half, g.OPTICAL[1] + i))):
            ctx.move_to(*g.place(a, s, c))
            ctx.line_to(*g.place(b, s, c))
            ctx.stroke()
    g.draw(ctx, s, c, 'primaryContainer')
    ctx.set_source_rgb(*g.rgb(ink))
    ctx.set_line_width(1.5)
    ctx.set_dash([8, 6])
    ctx.arc(*g.place(g.CENTRE, s, c), g.R * s, 0, 2 * math.pi)
    ctx.stroke()
    ctx.set_source_rgb(*g.rgb(note))
    ctx.arc(*g.place(g.OPTICAL, s, c), g.reach() * s, 0, 2 * math.pi)
    ctx.stroke()
    x0, y0, x1, y1 = g.BOX
    ctx.set_source_rgb(*g.rgb(g.ON_LIGHT))
    for grow in (0, g.CLEAR):
        a = g.place((x0 - grow, y0 - grow), s, c)
        b = g.place((x1 + grow, y1 + grow), s, c)
        ctx.rectangle(a[0], a[1], b[0] - a[0], b[1] - a[1])
        ctx.stroke()
    ctx.set_dash([])
    ctx.set_line_width(2)
    for p, colour in ((g.CENTRE, ink), (g.OPTICAL, note)):
        x, y = g.place(p, s, c)
        ctx.set_source_rgb(*g.rgb(colour))
        ctx.move_to(x - 12, y)
        ctx.line_to(x + 12, y)
        ctx.move_to(x, y - 12)
        ctx.line_to(x, y + 12)
        ctx.stroke()
    for a, b in g.EDGES:
        ctx.set_source_rgb(*g.rgb(g.ON_LIGHT))
        ctx.set_line_width(1.5)
        ctx.move_to(*g.place(a, s, c))
        ctx.line_to(*g.place(b, s, c))
        ctx.stroke()
    for p, r in g.NODES:
        ctx.arc(*g.place(p, s, c), r * s, 0, 2 * math.pi)
        ctx.stroke()
    image = surface_png(surface, path)
    draw = ImageDraw.Draw(image)
    big, small = g.font(30, 500), g.font(22, 400)
    draw.text((40, 30), 'Fama AI mark - construction', font=big, fill=ink)
    draw.text((40, 74), f'1 unit = 1 grid square ; bold line every 4 units ; R = {g.R} ; node r = {g.NODE} ; hub r = {g.HUB} ; edge = {g.EDGE}',
              font=small, fill=ink)
    labels = [
        (g.place(g.APEX, s, c), f'apex (0, -{g.R}) r {g.NODE}', (30, -10)),
        (g.place(g.LEFT, s, c), f'left (-16 sqrt3, 16) r {g.NODE}', (-150, 70)),
        (g.place(g.RIGHT, s, c), f'right (16 sqrt3, 16) r {g.NODE}', (-120, 70)),
        (g.place(g.CENTRE, s, c), f'hub = centroid (0, 0) r {g.HUB}', (24, 24)),
        (g.place(g.OPTICAL, s, c), 'optical centre (0, -4) = canvas centre', (24, -40)),
        (g.place((g.BOX[0] - g.CLEAR, g.BOX[1] - g.CLEAR), s, c), f'clear space {g.CLEAR} (= node r) around the mark box', (10, 6)),
    ]
    for (x, y), text, (dx, dy) in labels:
        draw.text((x + dx, y + dy), text, font=small, fill=ink)
    draw.text((40, height - 110), f'dashed black: circumcircle R = {g.R} through the three node centres',
              font=small, fill=ink)
    draw.text((40, height - 80), f'dashed red: reach = {g.reach():.2f} from the optical centre (fit this inside every safe circle)',
              font=small, fill=note)
    draw.text((40, height - 50), 'dashed blue: mark box and clear-space box', font=small, fill=g.COLOURS[g.ON_LIGHT])
    image.save(path)


def cell(kind, px):
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, px, px)
    ctx = cairo.Context(surface)
    c = (px / 2, px / 2)
    if kind == 'icon':
        ctx.arc(px / 2, px / 2, px / 2, 0, 2 * math.pi)
        ctx.clip()
        g.badge(ctx, px, px)
        g.draw(ctx, px * 7 / 1024 * 108 / 72, c, *g.ON_BADGE)
    else:
        bg, mark = {'light': ('surface', g.ON_LIGHT), 'dark': ('darkSurface', g.ON_DARK), 'mono': ('#44474F', 'onPrimary')}[kind]
        ctx.set_source_rgb(*g.rgb(bg))
        ctx.paint()
        g.draw(ctx, px / g.VIEW, c, mark)
    data = Image.frombuffer('RGBA', (px, px), bytes(surface.get_data()), 'raw', 'BGRA', 0, 1)
    return data


def proof(path):
    sizes = (16, 24, 32, 48, 64, 96, 192)
    kinds = ('icon', 'light', 'dark', 'mono')
    pad, top, left = 24, 90, 150
    width = max(980, left + sum(sizes) + pad * (len(sizes) + 1))
    height = top + len(kinds) * (max(sizes) + pad) + pad
    image = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((pad, 24), 'Fama AI mark - small-size proof (rendered at each size, not scaled down)', font=g.font(26, 500), fill=ink)
    x = left + pad
    for px in sizes:
        draw.text((x, top - 34), f'{px}', font=g.font(20, 400), fill=ink)
        x += px + pad
    for row, kind in enumerate(kinds):
        y = top + row * (max(sizes) + pad)
        draw.text((pad, y + max(sizes) / 2 - 12), kind, font=g.font(22, 400), fill=ink)
        x = left + pad
        for px in sizes:
            tile = cell(kind, px)
            image.paste(tile, (x, y + (max(sizes) - px) // 2), tile)
            x += px + pad
    image.save(path)


(here / 'fama-ai-mark.svg').write_text(g.mark_svg())
(here / 'fama-ai-icon.svg').write_text(g.icon_svg())
construction(here / 'construction.png')
proof(here / 'proof.png')
print('wrote fama-ai-mark.svg fama-ai-icon.svg construction.png proof.png')
