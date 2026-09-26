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


# ---------------------------------------------------------------------------
# Oxidized bronze
# ---------------------------------------------------------------------------


def bronze(touch: Mask = None, soot: Mask = None, carve: Mask = None, seed: float = 0.0,
           edge_lo: float = 8.0, edge_hi: float = 45.0, ao_dist: float = 0.08, wear: float = 1.0) -> Callable[[Graph], Look]:
    """Verdigris over bronze; worn back to bright metal on edges and where hands go.

    Patina hues stay yellow-green to grey-green (no teal).
    """

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, edge_lo, edge_hi, -6.0, -40.0)
        n1 = g.noise(p, scale=5.0, detail=6.0, rough=0.6, w=seed)
        n2 = g.noise(p, scale=22.0, detail=5.0, rough=0.65, w=seed + 1.0)
        crust = g.noise(p, scale=60.0, detail=4.0, rough=0.7, w=seed + 2.0)
        patina = g.ramp(n1, [(0.28, "#3f4f40"), (0.45, "#56705c"), (0.6, VERDIGRIS), (0.75, "#7f9272")])
        patina = g.mix(crust.smooth(0.55, 0.75) * 0.5, patina, "#9aa585")  # pale powdery crust
        cup = n2.smooth(0.58, 0.72) * 0.7
        patina = g.mix(cup, patina, "#5a3d29")  # brown cuprite showing through
        patina = g.mix(concave * 0.7, patina, "#2c2b22")  # dark grime in recesses
        # Bright metal: edges (broken by noise) and touch zones.
        edge_n = g.noise(p, scale=30.0, detail=3.0, w=seed + 3.0)
        worn = (convex * wear * 1.3 - 0.25 + (edge_n - 0.5) * 0.9).clamp()
        if touch is not None:
            t = touch(g, p)
            worn = (worn + t * (edge_n.lin(0.2, 0.8, 0.6, 1.3))).clamp()
        thin = n1.smooth(0.62, 0.8) * 0.35  # thin-patina areas: dull brown metal
        metal_col = g.mix(n2, "#a8773c", "#c89a55")
        base = g.mix(thin, patina, "#6e5234")
        base = g.mix(worn, base, metal_col)
        metal = g.mixf(thin, 0.2, 0.6)
        metal = g.mixf(worn, metal, 1.0)
        rough = g.mixf(worn, crust.lin(0.3, 0.8, 0.62, 0.82), (n2 - 0.5) * 0.1 + 0.33)
        height = crust * 1.0 + n2 * 0.8
        height = g.mixf(worn, height, n2 * 0.25)
        pit = g.voronoi(p, scale=90.0, feature="F1", w=seed + 5.0).smooth(0.18, 0.05)
        height = height - pit * (worn.inv()) * 1.2
        occl = 1.0
        if carve is not None:
            cv = carve(g, p)
            height = height - cv * 5.0
            base = g.mix(cv.smooth(0.3, 0.9) * 0.6, base, "#2f3328")
            occl = cv.smooth(0.3, 1.0) * -0.3 + 1.0
        if soot is not None:
            s = soot(g, p)
            base = g.mix(s, base, g.mix(crust, "#15110e", "#2a221c"))
            metal = g.mixf(s, metal, 0.0)
            rough = g.mixf(s, rough, 0.92)
            height = g.mixf(s * 0.6, height, crust * 1.6)
        ao = g.ao(ao_dist, 8) * occl
        return Look(base=base, rough=rough, metal=metal, ao=ao, height=height, bump=1.0, bump_dist=0.0006)

    return recipe


# ---------------------------------------------------------------------------
# Gold
# ---------------------------------------------------------------------------


def gold(carve: Mask = None, seed: float = 0.0, ao_dist: float = 0.03, edge_lo: float = 10.0,
         edge_hi: float = 60.0, bump_dist: float = 0.0003) -> Callable[[Graph], Look]:
    """Worn gold: burnished raised areas, matte dusty recesses, micro-scratches."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, edge_lo, edge_hi, -8.0, -60.0)
        n1 = g.noise(p, scale=12.0, detail=4.0, w=seed)
        base = g.mix(n1, "#d9a445", "#efc46c")
        base = g.mix(convex * 0.5, base, "#f6d68a")
        scratch = g.noise(g.scale_vec(p, 400.0, 30.0, 30.0), scale=1.0, detail=2.0, w=seed + 1.0)
        scratch2 = g.noise(g.scale_vec(p, 30.0, 30.0, 400.0), scale=1.0, detail=2.0, w=seed + 2.0)
        sc = (scratch.smooth(0.7, 0.8) + scratch2.smooth(0.72, 0.82)).clamp()
        rough = 0.25 + (n1 - 0.5) * 0.08 + sc * 0.12 - convex * 0.08
        dust = (concave * 1.2 - 0.1).clamp()
        occl = 1.0
        height = n1 * 0.3 - sc * 0.4
        if carve is not None:
            cv = carve(g, p)
            dust = (dust + cv.smooth(0.3, 0.9) * 0.8).clamp()
            height = height - cv * 4.0
            occl = cv.smooth(0.3, 1.0) * -0.35 + 1.0
        base = g.mix(dust * 0.85, base, "#6d5130")
        rough = g.mixf(dust, rough, 0.62)
        metal = g.mixf(dust, 1.0, 0.45)
        ao = g.ao(ao_dist, 8) * occl
        return Look(base=base, rough=rough, metal=metal, ao=ao, height=height, bump=1.0, bump_dist=bump_dist)

    return recipe


# ---------------------------------------------------------------------------
# Coals and amber
# ---------------------------------------------------------------------------


def coals(seed: float = 0.0) -> Callable[[Graph], Look]:
    """Charcoal lumps with ash; glowing cracks baked into an emissive map."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 20.0, 90.0, -15.0, -90.0)
        f1 = g.voronoi(p, scale=16.0, feature="F1", w=seed)
        f2 = g.voronoi(p, scale=16.0, feature="F2", w=seed)
        crack = (f2 - f1).smooth(0.14, 0.0)
        n = g.noise(p, scale=10.0, detail=5.0, w=seed + 1.0)
        ash = (g.noise(p, scale=5.0, detail=4.0, w=seed + 2.0).smooth(0.5, 0.7) * convex.lin(0, 1, 0.5, 1.0)
               + convex * 0.5).clamp()
        base = g.mix(n, "#16110e", "#2e241d")
        base = g.mix(ash * 0.85, base, g.mix(n, "#6d655c", "#9c9387"))
        hot = (crack * 0.8 + concave * 0.8 + g.noise(p, scale=3.0, w=seed + 3.0).smooth(0.45, 0.7) * 0.4).clamp()
        hot = hot * ash.lin(0, 1, 1.0, 0.25)
        emit = g.ramp(hot, [(0.0, "#000000"), (0.35, "#5a1804"), (0.65, "#e0772e"), (0.9, "#ffb347")])
        base = g.mix(hot.smooth(0.4, 0.9), base, "#7a2a0c")
        height = n * 1.0 - crack * 1.5
        ao = g.ao(0.06, 8)
        return Look(base=base, rough=0.92, metal=0.0, ao=ao, height=height, bump=1.0, bump_dist=0.002, emit=emit)

    return recipe


def amber_gem(seed: float = 0.0) -> Callable[[Graph], Look]:
    """Polished amber with inclusions; emissive map carries a warm inner glow."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        flow = g.noise(g.scale_vec(p, 20.0, 20.0, 60.0), scale=1.0, detail=4.0, distortion=1.5, w=seed)
        cloud = g.noise(p, scale=30.0, detail=5.0, w=seed + 1.0)
        base = g.ramp(flow, [(0.3, "#b8561a"), (0.55, "#e08e2c"), (0.8, "#f2a93b")])
        base = g.mix(cloud.smooth(0.6, 0.8) * 0.4, base, "#f7c060")
        speck = g.voronoi(p, scale=140.0, feature="F1", w=seed + 2.0).smooth(0.1, 0.02)
        gate = g.noise(p, scale=8.0, w=seed + 3.0).smooth(0.5, 0.65)
        base = g.mix(speck * gate * 0.8, base, "#3a1a08")
        bub = g.voronoi(p, scale=80.0, feature="F1", w=seed + 4.0).smooth(0.08, 0.03)
        base = g.mix(bub * 0.5, base, "#ffd98a")
        glow = (flow.lin(0.2, 0.9, 0.55, 1.0) - speck * gate * 0.6).clamp()
        emit = g.mix(glow, "#6b2a06", "#f2a93b")
        rough = 0.08 + cloud * 0.05
        return Look(base=base, rough=rough, metal=0.0, ao=1.0, height=None, emit=emit)

    return recipe
