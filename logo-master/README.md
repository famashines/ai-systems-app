# Fama AI logo package

- `fama-ai-mark.svg` - the mark, one colour (source for every one-colour use)
- `fama-ai-icon.svg` - the app icon: badge gradient and two-colour mark
- `SPEC.md` - name, geometry, rules, colours, wordmark, clear space, minimum size, asset table
- `construction.png` - construction drawing on the unit grid
- `proof.png` - small-size proof (16-192 px; icon, light, dark, one colour)
- `geometry.py`, `make_master.py`, `verify.py` - the source of truth, the generator and the checks
- `fonts/` - Roboto (SIL Open Font License 1.1) for the wordmark

Build assets from these masters with SPEC.md section 8. Do not draw the mark again.
`python3 scripts/build-logo-assets.py` (from the repository root, needs pycairo and Pillow) writes the app icons,
splash icons, the Play icon and the feature graphic. A changed icon or splash needs a native release.
