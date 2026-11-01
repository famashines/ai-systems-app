import math

R = 32
NODE = 8.5
HUB = 6.5
EDGE = 4
HALF = R * math.sqrt(3) / 2

APEX = (0.0, -R)
LEFT = (-HALF, R / 2)
RIGHT = (HALF, R / 2)
CENTRE = (0.0, 0.0)

NODES = [(APEX, NODE), (LEFT, NODE), (RIGHT, NODE), (CENTRE, HUB)]
EDGES = [(APEX, LEFT), (LEFT, RIGHT), (RIGHT, APEX), (APEX, CENTRE), (LEFT, CENTRE), (RIGHT, CENTRE)]

BOX = (-HALF - NODE, -R - NODE, HALF + NODE, R / 2 + NODE)
OPTICAL = (0.0, -4.0)
CLEAR = NODE
VIEW = 96
NAME_SIZE = 38
NAME_GAP = 20

COLOURS = {
    'primary': '#2F5BB7',
    'primaryContainer': '#D9E2FF',
    'onPrimary': '#FFFFFF',
    'badgeEnd': '#284777',
    'darkPrimary': '#B0C6FF',
    'surface': '#F8F9FB',
    'darkSurface': '#111318',
}

BADGE = ('primary', 'badgeEnd')
ON_BADGE = ('onPrimary', 'primaryContainer')
ON_LIGHT = 'primary'
ON_DARK = 'darkPrimary'


def font(size, weight=500):
    from pathlib import Path
    from PIL import ImageFont
    face = ImageFont.truetype(str(Path(__file__).parent / 'fonts' / 'Roboto-Variable.ttf'), size)
    face.set_variation_by_axes([weight, 100])
    return face


def reach(origin=OPTICAL):
    return max(math.dist(p, origin) + r for p, r in NODES)


def rgb(name):
    value = COLOURS.get(name, name)
    return tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))


def place(point, s, centre):
    return centre[0] + (point[0] - OPTICAL[0]) * s, centre[1] + (point[1] - OPTICAL[1]) * s


def draw(ctx, s, centre, nodes, edges=None):
    ctx.set_source_rgb(*rgb(edges or nodes))
    ctx.set_line_width(EDGE * s)
    ctx.set_line_cap(0)
    for a, b in EDGES:
        ctx.move_to(*place(a, s, centre))
        ctx.line_to(*place(b, s, centre))
        ctx.stroke()
    ctx.set_source_rgb(*rgb(nodes))
    for p, r in NODES:
        ctx.arc(*place(p, s, centre), r * s, 0, 2 * math.pi)
        ctx.fill()


def badge(ctx, width, height):
    import cairo
    fill = cairo.LinearGradient(0, 0, width, height)
    fill.add_color_stop_rgb(0, *rgb(BADGE[0]))
    fill.add_color_stop_rgb(1, *rgb(BADGE[1]))
    ctx.rectangle(0, 0, width, height)
    ctx.set_source(fill)
    ctx.fill()


def f(v):
    return ('%.3f' % v).rstrip('0').rstrip('.')


def svg_mark(nodes, edges=None, indent='  '):
    lines = [f'{indent}<g stroke="{COLOURS[edges or nodes]}" stroke-width="{f(EDGE)}" stroke-linecap="butt">']
    for a, b in EDGES:
        lines.append(f'{indent}  <line x1="{f(a[0])}" y1="{f(a[1])}" x2="{f(b[0])}" y2="{f(b[1])}"/>')
    lines.append(f'{indent}</g>')
    lines.append(f'{indent}<g fill="{COLOURS[nodes]}">')
    for p, r in NODES:
        lines.append(f'{indent}  <circle cx="{f(p[0])}" cy="{f(p[1])}" r="{f(r)}"/>')
    lines.append(f'{indent}</g>')
    return '\n'.join(lines)


def svg(title, body, half):
    x, y = OPTICAL[0] - half, OPTICAL[1] - half
    size = 2 * half
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x)} {f(y)} {f(size)} {f(size)}" width="{f(size * 8)}" height="{f(size * 8)}" role="img" aria-labelledby="t">
  <title id="t">{title}</title>
{body}
</svg>
'''


def mark_svg():
    return svg('Fama AI mark', svg_mark(ON_LIGHT), VIEW / 2)


def icon_svg():
    half = 64
    x, y = OPTICAL[0] - half, OPTICAL[1] - half
    body = f'''  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{COLOURS[BADGE[0]]}"/>
      <stop offset="1" stop-color="{COLOURS[BADGE[1]]}"/>
    </linearGradient>
  </defs>
  <rect x="{f(x)}" y="{f(y)}" width="{2 * half}" height="{2 * half}" fill="url(#badge)"/>
{svg_mark(*ON_BADGE)}'''
    return svg('Fama AI app icon', body, half)
