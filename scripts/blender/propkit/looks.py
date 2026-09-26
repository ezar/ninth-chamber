"""Procedural material recipes (shader side) and matching displacement fields.

Colours follow docs/art/README.md. Every recipe returns a ``Look`` whose
channels are baked to textures. Masks come from:
  - ``curv``: per-vertex curvature of the high-poly (convex > 0, concave < 0),
  - optional callbacks a prop passes in (carving height, touch zones, soot).
Non-metal albedos stay inside sRGB 40..235 (art bible "albedo range").
"""

from __future__ import annotations

from typing import Callable, Optional

from .core import Look
from .nodes import Graph, S

Mask = Optional[Callable[[Graph, S], S]]

SANDSTONE = "#b8895a"
LIMESTONE = "#cfc5b1"
SAND = "#c8a77c"
VERDIGRIS = "#5e7b68"
BRONZE_WORN = "#a8773c"
GOLD = "#e8b75a"


# ---------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------


def edge_masks(g: Graph, lo: float = 4.0, hi: float = 25.0, clo: float = -3.0, chi: float = -18.0):
    """(convex, concave) masks from the curvature attribute."""
    c = g.attr("curv")
    convex = c.smooth(lo, hi)
    concave = c.smooth(clo, chi)
    return convex, concave


def stone_height(g: Graph, p: S, grain: float = 1.0, pits: float = 1.0, seed: float = 0.0) -> S:
    """Fine surface relief for stone: sandy grain, bedding laminae and pits (unitless)."""
    fine = g.noise(p, scale=140.0, detail=4.0, rough=0.7, w=seed) * (0.8 * grain)
    mid = g.noise(p, scale=18.0, detail=5.0, rough=0.6, w=seed + 3.1) * 1.2
    lam = g.noise(g.scale_vec(p, 0.7, 0.7, 10.0), scale=1.0, detail=4.0, w=seed + 8.3)
    lam = lam.smooth(0.5, 0.72) * 0.45
    v1 = g.voronoi(p, scale=30.0, feature="F1", w=seed + 1.7)
    v2 = g.voronoi(p, scale=75.0, feature="F1", w=seed + 2.9)
    gate = g.noise(p, scale=5.0, w=seed + 5.5).smooth(0.45, 0.65)
    pit = (v1.smooth(0.2, 0.12) * gate + v2.smooth(0.16, 0.08) * 0.6) * pits
    return fine + mid - lam - pit * 1.6


def stone_disp(
    g: Graph,
    amp: float = 0.005,
    chip: float = 0.025,
    chip_scale: float = 7.0,
    strata: float = 0.0015,
    seed: float = 0.0,
    edge_lo: float = 3.0,
    edge_hi: float = 12.0,
    chip_density: float = 0.5,
) -> S:
    """Displacement (metres) for weathered dressed stone: undulation, laminae, sharp edge chips."""
    p = g.pos()
    c0 = g.attr("curv0")
    edge = c0.smooth(edge_lo, edge_hi)
    und = (g.noise(p, scale=1.8, detail=4.0, rough=0.55, w=seed) - 0.5) * (2 * amp)
    fine = (g.noise(p, scale=9.0, detail=5.0, rough=0.6, w=seed + 2.0) - 0.5) * (1.2 * amp)
    lam = g.noise(g.scale_vec(p, 0.6, 0.6, 9.0), scale=1.0, detail=3.0, w=seed + 7.0).smooth(0.5, 0.72)
    st = lam * (-strata)
    pw = g.warp(p, 0.08, 5.0, seed=seed + 9.0)
    v = g.voronoi(pw, scale=chip_scale, feature="F1", w=seed + 4.0)
    rad = g.noise(p, scale=12.0, w=seed + 6.0) * 0.25 + 0.2
    crater = (rad - v).smooth(0.0, 0.03) * (1.0 - (v / rad) * 0.3)
    sel = g.noise(p, scale=2.5, w=seed + 11.0).smooth(0.62 - chip_density * 0.3, 0.7 - chip_density * 0.3)
    chips = crater * sel * edge * (-chip)
    # Uneven erosion of the arrises: some stretches of edge are worn back much further.
    wear = g.noise(p, scale=3.5, detail=3.0, w=seed + 13.0).smooth(0.4, 0.7)
    chips = chips - edge * wear * (chip * 0.6)
    # Honeycomb weathering (tafoni): clusters of small cavities.
    hv = g.voronoi(p, scale=22.0, feature="F1", w=seed + 15.0)
    hz = g.noise(p, scale=1.6, detail=2.0, w=seed + 17.0).smooth(0.58, 0.72)
    chips = chips - hv.smooth(0.34, 0.2) * hz * (amp * 1.4)
    return und + fine + st + chips


# ---------------------------------------------------------------------------
# Sandstone
# ---------------------------------------------------------------------------


def sandstone(
    tone: str = SANDSTONE,
    pale: float = 0.0,
    carve: Mask = None,
    touch: Mask = None,
    soot: Mask = None,
    damp: bool = True,
    seed: float = 0.0,
    ao_dist: float = 0.25,
    sand_amount: float = 1.0,
    edge_lo: float = 4.0,
    edge_hi: float = 25.0,
    fresh: str | None = None,
) -> Callable[[Graph], Look]:
    """Weathered sandstone. ``pale`` lifts it towards limestone (pushable blocks).

    ``fresh`` names a 0..1 point attribute marking recent fracture surfaces
    (rubble): brighter, less patinated, rougher.
    """

    def recipe(g: Graph) -> Look:
        p = g.pos()
        x, y, z = g.separate(p)
        nz = g.separate(g.normal())[2]
        convex, concave = edge_masks(g, edge_lo, edge_hi)
        big = g.noise(p, scale=0.55, detail=3.0, w=seed)
        patch = g.noise(p, scale=2.2, detail=4.0, rough=0.6, w=seed + 1.3)
        base = g.ramp(big, [(0.32, "#9d744d"), (0.5, tone), (0.68, "#c6a077")])
        base = g.mix(pale, base, "#cfb896")
        # Desaturated, greyer patches and warmer iron-stained blotches.
        base = g.mix(patch.smooth(0.5, 0.68) * 0.55, base, "#a8927a")
        base = g.mix(patch.smooth(0.42, 0.28) * 0.4, base, "#d0b48a")
        iron = g.noise(p, scale=1.3, detail=6.0, rough=0.7, w=seed + 8.0).smooth(0.6, 0.76)
        base = g.mix(iron * 0.4, base, "#98603a")
        # Bedding laminae: irregular horizontal light/dark streaks.
        lam = g.noise(g.scale_vec(p, 0.7, 0.7, 16.0), scale=1.0, detail=4.0, w=seed + 8.3)
        base = g.mix(lam.smooth(0.55, 0.75) * 0.3, base, "#a57a50")
        base = g.mix(lam.smooth(0.42, 0.25) * 0.25, base, "#caa67c")
        # Grain: dark and light sand speckles.
        grain = g.noise(p, scale=180.0, detail=2.0, w=seed + 4.0)
        base = g.mix(grain.smooth(0.35, 0.65) * 0.14, "#8a6644", base)
        dk = g.voronoi(p, scale=260.0, feature="F1", w=seed + 6.0).smooth(0.14, 0.02)
        base = g.mix(dk * 0.4, base, "#5a432f")
        lt = g.voronoi(p, scale=200.0, feature="F1", w=seed + 16.0).smooth(0.12, 0.02)
        base = g.mix(lt * 0.35, base, "#e0cba6")
        # Worn convex edges: paler.
        base = g.mix(convex * 0.5, base, "#d4ba92")
        rough = 0.88 + (grain - 0.5) * 0.1 - convex * 0.06
        if fresh:
            fr = g.attr(fresh).smooth(0.05, 0.6)
            fcol = g.mix(grain.smooth(0.3, 0.7) * 0.3, "#c08d5c", "#d3a877")
            base = g.mix(fr * 0.75, base, fcol)
            rough = g.mixf(fr, rough, 0.93)
        # Sand settled in joints, hollows, pits and on upward faces.
        sand_n = g.noise(p, scale=22.0, detail=3.0, w=seed + 12.0)
        sand = (concave * 1.3 - 0.1 + (sand_n - 0.5) * 0.7).clamp() * sand_amount
        top = nz.smooth(0.55, 0.95) * g.noise(p, scale=3.0, detail=4.0, w=seed + 14.0).smooth(0.35, 0.75) * 0.55
        sand = (sand + top * sand_amount).clamp()
        height = stone_height(g, p, seed=seed)
        pits = (-height).smooth(0.2, 1.2)
        base = g.mix(pits * 0.35, base, "#7c5a3c")
        occl = 1.0
        if carve is not None:
            cv = carve(g, p)  # 0 surface .. 1 bottom of the carving
            height = height - cv * 6.0
            dust = (cv.smooth(0.25, 0.9) * (sand_n.smooth(0.2, 0.6))).clamp()
            sand = (sand + dust * 0.9).clamp()
            base = g.mix(cv.smooth(0.05, 0.6) * 0.3, base, "#8a6645")
            occl = cv.smooth(0.3, 1.0) * -0.35 + 1.0
        base = g.mix(sand, base, g.mix(sand_n, SAND, "#d8bf96"))
        rough = g.mixf(sand, rough, 0.96)
        if touch is not None:
            t = touch(g, p)
            base = g.mix(t * 0.3, base, "#c9a476")
            rough = g.mixf(t, rough, 0.6)
            height = height * t.lin(0, 1, 1.0, 0.35)
        if damp:
            band_d = z.smooth(0.03, 0.1) * z.smooth(0.34, 0.2)
            wn = g.noise(g.scale_vec(p, 1.0, 1.0, 0.4), scale=3.0, detail=4.0, w=seed + 13.0)
            wet = band_d * wn.smooth(0.3, 0.6) * 0.4
            base = g.mix(wet, base, g.mix(0.5, base, "#5a3f2a", "MULTIPLY"))
            # Salt bloom just above the damp band.
            salt = z.smooth(0.2, 0.3) * z.smooth(0.55, 0.36) * wn.smooth(0.55, 0.7) * 0.35
            base = g.mix(salt, base, "#e3d6bf")
            grime = z.smooth(0.12, 0.0) * 0.45
            base = g.mix(grime, base, g.mix(0.6, base, "#4a3526", "MULTIPLY"))
        if soot is not None:
            s = soot(g, p)
            base = g.mix(s, base, "#221a14")
            rough = g.mixf(s, rough, 0.95)
        ao = g.ao(ao_dist, 8) * occl
        return Look(base=base, rough=rough, metal=0.0, ao=ao, height=height, bump=1.0, bump_dist=0.0012)

    return recipe
