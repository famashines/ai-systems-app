import math
import sys
from pathlib import Path

import geometry as g

here = Path(__file__).parent
bad = 0


def check(ok, message):
    global bad
    print(('PASS ' if ok else 'FAIL ') + message)
    bad += not ok


sides = [math.dist(a, b) for a, b in g.EDGES[:3]]
check(max(sides) - min(sides) < 1e-9, f'outer triangle is equilateral (side = {sides[0]:.3f} = R sqrt3)')
check(all(abs(math.dist(p, g.CENTRE) - g.R) < 1e-9 for p, _ in g.NODES[:3]), f'the three outer nodes are on the circumcircle R = {g.R}')
centroid = tuple(sum(p[i] for p, _ in g.NODES[:3]) / 3 for i in (0, 1))
check(math.dist(centroid, g.CENTRE) < 1e-9, 'the hub is on the centroid of the triangle')
check(len(g.EDGES) == 6 and {frozenset(e) for e in g.EDGES} == {frozenset((a, b)) for i, (a, _) in enumerate(g.NODES) for (b, _) in g.NODES[i + 1:]},
      'six edges join every pair of the four nodes (complete graph K4, a tetrahedron seen from the top)')
check(g.NODE > g.HUB > g.EDGE, f'size order: node r {g.NODE} > hub r {g.HUB} > edge {g.EDGE}')
check(g.EDGE / 2 < g.HUB, 'butt edge ends are hidden inside the nodes (edge / 2 < hub r)')
gap = min(math.dist(a, b) - ra - rb for i, (a, ra) in enumerate(g.NODES) for (b, rb) in g.NODES[i + 1:])
check(gap >= 4 * g.EDGE, f'smallest gap between two nodes = {gap:.2f} >= 4 x edge')
box = (min(p[0] - r for p, r in g.NODES), min(p[1] - r for p, r in g.NODES), max(p[0] + r for p, r in g.NODES), max(p[1] + r for p, r in g.NODES))
check(all(abs(a - b) < 1e-9 for a, b in zip(box, g.BOX)), f'mark box = ({", ".join(g.f(v) for v in box)})')
area = sum(math.pi * r * r * p[1] for p, r in g.NODES) / sum(math.pi * r * r for p, r in g.NODES)
check(abs(area) < 1e-9, 'area centroid = (0, 0) (three-fold symmetry)')
centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
optical = ((centre[0] + g.CENTRE[0]) / 2, (centre[1] + g.CENTRE[1]) / 2)
check(math.dist(optical, g.OPTICAL) < 1e-9, f'optical centre = midpoint of box centre and area centroid = ({g.f(optical[0])}, {g.f(optical[1])})')
check(g.reach() <= g.VIEW / 2 - 4, f'reach from the optical centre = {g.reach():.2f} fits the master view box half size {g.VIEW // 2} with a margin of 4')
for name, text in (('fama-ai-mark.svg', g.mark_svg()), ('fama-ai-icon.svg', g.icon_svg())):
    path = here / name
    check(path.exists() and path.read_text() == text, f'{name} is up to date with geometry.py')
print('\nRESULT:', 'ALL CHECKS PASSED' if not bad else f'{bad} CHECK(S) FAILED')
sys.exit(bad)
