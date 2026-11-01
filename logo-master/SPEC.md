# Fama AI mark - brand and asset specification

Master files: `fama-ai-mark.svg` (the mark, one colour) and
`fama-ai-icon.svg` (the app icon: badge and two-colour mark). Both come
from `geometry.py` through `make_master.py`. `verify.py` proves the rules
in section 4. Construction drawing: `construction.png`. Small-size proof:
`proof.png`.

## 1. Name

| Use | Write |
| --- | ----- |
| App name (launcher, Play listing, in-app text, documents) | `Fama AI` |
| Company | `famashines` (lower case) |
| Back-end service and repositories | `ai-systems` (not for users) |
| Package and URL scheme | `com.famashines.ai` (do not change) |

`Fama AI` has a capital F, a capital A and a capital I, and one space. Do
not write `FamaAI`, `Fama Ai`, `FAMA AI`, `fama.ai` or `ai.famashines`.
Do not translate the name. Urdu and German text use the Latin `Fama AI`.

## 2. Concept

Four nodes and six edges: a tetrahedron seen from the top (the complete
graph K4). Three large nodes are the agents. The small hub on the centre
is the orchestration that joins them. Each node connects to all the
other nodes.

```
            o            apex     (0, -32)  r 8.5
           /|\
          / | \
         /  o  \         hub      (0, 0)    r 6.5
        /  / \  \
       o---------o       left / right (-/+ 16 sqrt3, 16)  r 8.5
```

## 3. Units and constants

1 unit = 1/4 of the edge width. Origin = the centroid of the triangle (the
hub centre). x goes right, y goes down.

| Name | Value | Meaning |
| ---- | ----- | ------- |
| R | 32 | circumradius: hub centre to each outer node centre |
| NODE | 8.5 | radius of the three outer nodes |
| HUB | 6.5 | radius of the hub |
| EDGE | 4 | edge width (butt ends, hidden inside the nodes) |
| side | 32 sqrt3 = 55.426 | triangle side |
| BOX | (-36.213, -40.5) to (36.213, 24.5) | mark box, 72.426 x 65 |
| OPTICAL | (0, -4) | optical centre (section 7) |
| CLEAR | 8.5 | clear space (= NODE) |
| reach | 42.68 | largest distance from the optical centre to the mark outline |

The node centres are not on the integer grid, because the triangle is
equilateral. Use the exact values: `16 sqrt3 = 27.7128...`.

## 4. Rules

- **R1 Triangle.** The three outer nodes are on a circle of radius R
  around the hub, at -90, 150 and 30 degrees. The triangle is equilateral
  and points up.
- **R2 Hub.** The hub is on the centroid of the triangle.
- **R3 Edges.** Six straight edges join every pair of nodes: the three
  sides and three spokes to the hub. All edges are EDGE wide and run from
  node centre to node centre. The nodes cover the edge ends.
- **R4 Size order.** NODE > HUB > EDGE. The smallest gap between two
  nodes is 17 units (apex to hub), which is at least 4 x EDGE.
- **R5 Layers.** The nodes are on top of the edges.
- **R6 Shape.** Circles and straight edges only. No rotation, no
  perspective, no outline-only version, no added or removed nodes.

## 5. Colour

All colours are tokens of `src/theme.ts`. `scripts/build-logo-assets.py`
stops if `geometry.py` and `theme.ts` do not agree. If a token changes,
change `COLOURS` in `geometry.py`, then build the assets again.

| Name in `geometry.py` | Token in `theme.ts` | Hex |
| --------------------- | ------------------- | --- |
| primary | `lightColors.primary` | `#2F5BB7` |
| primaryContainer | `lightColors.primaryContainer` | `#D9E2FF` |
| onPrimary | `lightColors.onPrimary` | `#FFFFFF` |
| badgeEnd | `darkColors.primaryContainer` | `#284777` |
| darkPrimary | `darkColors.primary` | `#B0C6FF` |
| surface | `lightColors.surface` | `#F8F9FB` |
| darkSurface | `darkColors.surface` | `#111318` |

| Background | Nodes | Edges | Contrast (nodes) |
| ---------- | ----- | ----- | ---------------- |
| Badge: linear gradient `#2F5BB7` (top left) to `#284777` (bottom right) | `#FFFFFF` | `#D9E2FF` | 6.4 to 9.3 : 1 (edges 4.9 to 7.2 : 1) |
| Light surface `#F8F9FB` | `#2F5BB7` | same as nodes | 6.0 : 1 |
| Dark surface `#111318` | `#B0C6FF` | same as nodes | 10.9 : 1 |
| Themed icon, notification, any one-colour use | one tint | same as nodes | set by the system |

- Use the two-colour version only on the badge. Everywhere else, the mark
  is one colour.
- All contrasts are more than 3 : 1 (WCAG 1.4.11, graphic objects).
- Do not put a gradient, a shadow or a glow on the mark.

## 6. Wordmark and lockup

- Type: **Roboto Medium** (weight 500, width 100), the Android system
  font, which the app also uses. The file is `fonts/Roboto-Variable.ttf`
  (SIL Open Font License 1.1, `fonts/OFL.txt`).
- Lockup: the mark on the left, `Fama AI` on the right. Font size 38
  units, space between the mark box and the text 20 units. The text is
  centred on the vertical centre of the lockup. The mark optical centre is
  on the same line.
- The text has the colour of the nodes.

## 7. Placement, clear space and minimum size

- Put the **optical centre (0, -4)** on the centre of the canvas, not the
  box centre (0, -8) or the hub (0, 0). The optical centre is the midpoint
  of the box centre and the area centroid. The three-fold symmetry puts
  the area centroid on the hub.
- Safe circles: use `reach = 42.68`. The mark fits in a circle of radius
  `reach x s` around the optical centre (s = pixels for each unit).
- Clear space: CLEAR = 8.5 units on all sides of the mark box. No text or
  other graphic goes into it.
- Minimum size: the edge must be 1 px or more, so s >= 0.25. This is a
  mark box of about 18 px width (a 24 px square with clear space).
  `proof.png` shows that the mark is not clear at 16 px.

## 8. Asset derivation

`python3 scripts/build-logo-assets.py` writes these files and checks
them. s = pixels for each unit. The mark optical centre is on the canvas
centre (the feature graphic uses the lockup, section 6).

| File | Canvas | s | Colours | Check |
| ---- | ------ | - | ------- | ----- |
| `assets/images/icon.png` | 1024 x 1024 RGB | 8 | badge, two-colour mark | badge corners |
| `assets/images/adaptive-icon-background.png` | 1024 x 1024 RGB | - | badge | badge corners |
| `assets/images/adaptive-icon-foreground.png` | 1024 x 1024 RGBA | 7 | two-colour mark | reach 298.8 px <= safe circle 312.9 px (66/108 x 512) |
| `assets/images/adaptive-icon-monochrome.png` | 1024 x 1024 RGBA | 7 | `#FFFFFF` (Android themed icon tints it) | same safe circle |
| `assets/images/splash-icon-light.png` | 1152 x 1152 RGBA | 7 | `#2F5BB7` | reach 298.8 px <= 384 px (192 dp circle at 4 px for each dp) |
| `assets/images/splash-icon-dark.png` | 1152 x 1152 RGBA | 7 | `#B0C6FF` | same |
| `play-store-assets/app-icon-512.png` | 512 x 512 RGBA (32-bit, opaque) | 4 | badge, two-colour mark | badge corners, < 1 MB |
| `play-store-assets/feature-graphic.png` | 1024 x 500 RGB (24-bit) | 3.4 | badge, two-colour lockup | badge corners, < 1 MB |

The script also checks `app.json`: the name `Fama AI`, `primaryColor`
and the adaptive icon `backgroundColor` = primary, the splash
backgrounds = surface and darkSurface, and `imageWidth` 288.

- Play Store icon: full square, no rounded corners and no shadow. Google
  Play adds the mask.
- Phone and tablet screenshots are not made from the mark. Make them with
  goldie from the running app, and use the badge gradient and Roboto
  Medium for their headlines.
- A new asset size: add a row to this table and a `render(...)` line to
  the script. Do not draw the mark again by hand.

## 9. Rebuild and verify

```
cd logo-master
python3 make_master.py    # writes the two SVGs, construction.png and proof.png
python3 verify.py         # checks the geometry rules and that the SVGs are up to date
cd ..
python3 scripts/build-logo-assets.py           # writes and checks the app and store assets
python3 scripts/build-logo-assets.py --check   # checks only
```

Requires Python 3 with pycairo and Pillow. A changed icon or splash needs
a new native build (`npm run aab`).

## 10. Verification output

```
PASS outer triangle is equilateral (side = 55.426 = R sqrt3)
PASS the three outer nodes are on the circumcircle R = 32
PASS the hub is on the centroid of the triangle
PASS six edges join every pair of the four nodes (complete graph K4, a tetrahedron seen from the top)
PASS size order: node r 8.5 > hub r 6.5 > edge 4
PASS butt edge ends are hidden inside the nodes (edge / 2 < hub r)
PASS smallest gap between two nodes = 17.00 >= 4 x edge
PASS mark box = (-36.213, -40.5, 36.213, 24.5)
PASS area centroid = (0, 0) (three-fold symmetry)
PASS optical centre = midpoint of box centre and area centroid = (0, -4)
PASS reach from the optical centre = 42.68 fits the master view box half size 48
PASS fama-ai-mark.svg is up to date with geometry.py
PASS fama-ai-icon.svg is up to date with geometry.py

RESULT: ALL CHECKS PASSED
```
