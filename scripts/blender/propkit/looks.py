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
    """Fine surface relief for stone: sandy grain, faint chisel dressing and pits (unitless)."""
    fine = g.noise(p, scale=140.0, detail=4.0, rough=0.7, w=seed) * (0.9 * grain)
    mid = g.noise(p, scale=18.0, detail=5.0, rough=0.6, w=seed + 3.1) * 1.1
    # Claw-chisel dressing: shallow parallel diagonal grooves, worn away in patches.
    x, y, z = g.separate(p)
    ch = g.math("SINE", (x * 0.62 + y * 0.62 + z * 0.48) * (2 * 3.14159 / 0.022)) * 0.5 + 0.5
    ch_mask = g.noise(p, scale=1.5, detail=3.0, w=seed + 9.4).smooth(0.45, 0.62)
    chisel = ch * ch_mask * 0.35
    v1 = g.voronoi(p, scale=30.0, feature="F1", w=seed + 1.7)
    v2 = g.voronoi(p, scale=75.0, feature="F1", w=seed + 2.9)
    gate = g.noise(p, scale=5.0, w=seed + 5.5).smooth(0.4, 0.6)
    pit = (v1.smooth(0.24, 0.12) * gate + v2.smooth(0.2, 0.08) * 0.7) * pits
    return fine + mid - chisel - pit * 1.8


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
    lam = g.noise(g.scale_vec(p, 0.5, 0.5, 5.0), scale=1.0, detail=3.0, w=seed + 7.0).smooth(0.55, 0.75)
    st = lam * (-strata * 0.6)
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
        base = g.ramp(big, [(0.3, "#94694a"), (0.5, tone), (0.7, "#c9a57b")])
        mott = g.noise(p, scale=1.2, detail=5.0, rough=0.65, w=seed + 2.4)
        base = g.mix(mott.smooth(0.56, 0.72) * 0.45, base, "#8b6446")
        base = g.mix(mott.smooth(0.42, 0.28) * 0.4, base, "#d4b88f")
        # Contour scaling: a darker weathered crust has flaked off in patches, showing paler stone.
        spall_n = g.noise(g.warp(p, 0.08, 3.0, seed=seed + 19.0), scale=1.7, detail=6.0, rough=0.62,
                          w=seed + 18.0)
        spall = spall_n.smooth(0.53, 0.56)
        crust = g.mix(0.35, base, "#6f5038", "MULTIPLY")
        fresh_c = g.mix(0.5, base, "#d9bc92")
        base = g.mix(spall, crust, fresh_c)
        # Desaturated, greyer patches and warmer iron-stained blotches.
        base = g.mix(patch.smooth(0.5, 0.68) * 0.55, base, "#a8927a")
        base = g.mix(patch.smooth(0.42, 0.28) * 0.4, base, "#d0b48a")
        iron = g.noise(p, scale=1.3, detail=6.0, rough=0.7, w=seed + 8.0).smooth(0.6, 0.76)
        base = g.mix(iron * 0.4, base, "#98603a")
        # Bedding laminae: irregular horizontal light/dark streaks.
        lam = g.noise(g.scale_vec(p, 0.5, 0.5, 5.0), scale=1.0, detail=3.0, w=seed + 8.3)
        base = g.mix(lam.smooth(0.58, 0.75) * 0.18, base, "#a57a50")
        # Grain: dark and light sand speckles.
        grain = g.noise(p, scale=180.0, detail=2.0, w=seed + 4.0)
        base = g.mix(grain.smooth(0.3, 0.7) * 0.22, "#8a6644", base)
        dk = g.voronoi(p, scale=260.0, feature="F1", w=seed + 6.0).smooth(0.2, 0.03)
        base = g.mix(dk * 0.5, base, "#5a432f")
        lt = g.voronoi(p, scale=200.0, feature="F1", w=seed + 16.0).smooth(0.18, 0.02)
        base = g.mix(lt * 0.45, base, "#e6d4b0")
        # Worn convex edges: paler.
        base = g.mix(convex * 0.5, base, "#d4ba92")
        rough = 0.88 + (grain - 0.5) * 0.1 - convex * 0.06
        fr = None
        if fresh:
            fr = g.attr(fresh).smooth(0.05, 0.6)
            fcol = g.mix(grain.smooth(0.3, 0.7) * 0.3, "#b98655", "#cfa372")
            fcol = g.mix(g.noise(p, scale=4.0, detail=4.0, w=seed + 22.0).smooth(0.4, 0.7) * 0.4, fcol, "#a8774c")
            base = g.mix(fr * 0.8, base, fcol)
            rough = g.mixf(fr, rough, 0.93)
        # Sand settled in joints, hollows, pits and on upward faces.
        sand_n = g.noise(p, scale=22.0, detail=3.0, w=seed + 12.0)
        sand = (concave * 1.3 - 0.1 + (sand_n - 0.5) * 0.7).clamp() * sand_amount
        top = nz.smooth(0.55, 0.95) * g.noise(p, scale=3.0, detail=4.0, w=seed + 14.0).smooth(0.35, 0.75) * 0.55
        sand = (sand + top * sand_amount).clamp()
        if fr is not None:
            sand = sand * fr.lin(0, 1, 1.0, 0.35)
        height = stone_height(g, p, seed=seed) - spall * 1.2
        pits = (-height).smooth(0.3, 1.4)
        base = g.mix(pits * 0.5, base, "#6a4a31")
        occl = 1.0
        if carve is not None:
            cv = carve(g, p)  # 0 surface .. 1 bottom of the carving
            height = height - cv * 6.0
            dust = (cv.smooth(0.25, 0.9) * (sand_n.smooth(0.35, 0.75))).clamp()
            sand = (sand + dust * 0.55).clamp()
            base = g.mix(cv.smooth(0.05, 0.6) * 0.45, base, "#6e5037")
            occl = cv.smooth(0.3, 1.0) * -0.35 + 1.0
        base = g.mix(sand, base, g.mix(sand_n, SAND, "#d8bf96"))
        rough = g.mixf(sand, rough, 0.96)
        if pale:
            base = g.hsv(base, 0.5, 1.0 - 0.35 * pale, 1.0 + 0.3 * pale)
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
            salt = z.smooth(0.2, 0.3) * z.smooth(0.55, 0.36) * wn.smooth(0.58, 0.72) * 0.16
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


def bronze(touch: Mask = None, soot: Mask = None, carve: Mask = None, seed: float = 0.0, edge_lo: float = 8.0,
           edge_hi: float = 45.0, ao_dist: float = 0.08, wear: float = 1.0) -> Callable[[Graph], Look]:
    """Verdigris over bronze; worn back to bright metal on edges and where hands go.

    Patina hues stay yellow-green to grey-green (no teal).
    """

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, edge_lo, edge_hi, -6.0, -40.0)
        n1 = g.noise(p, scale=5.0, detail=6.0, rough=0.6, w=seed)
        n2 = g.noise(p, scale=22.0, detail=5.0, rough=0.65, w=seed + 1.0)
        crust = g.noise(p, scale=60.0, detail=4.0, rough=0.7, w=seed + 2.0)
        patina = g.ramp(n1, [(0.25, "#2f3326"), (0.42, "#48573f"), (0.58, VERDIGRIS), (0.74, "#6b774f")])
        patina = g.mix(crust.smooth(0.62, 0.8) * 0.3, patina, "#838a66")  # pale powdery crust
        cup = n2.smooth(0.52, 0.68) * 0.75
        patina = g.mix(cup, patina, "#553a26")  # brown cuprite showing through
        blk = g.noise(p, scale=9.0, detail=4.0, w=seed + 7.0).smooth(0.6, 0.74) * 0.6
        patina = g.mix(blk, patina, "#27261e")  # black oxide
        patina = g.mix(concave * 0.75, patina, "#24231c")  # dark grime in recesses
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
        rough = 0.26 + (n1 - 0.5) * 0.1 + sc * 0.16 - convex * 0.1
        dust = (concave * 1.3 - 0.05).clamp()
        tarnish = g.noise(p, scale=7.0, detail=4.0, w=seed + 3.0).smooth(0.58, 0.75) * 0.3
        base = g.mix(tarnish, base, "#b8873c")
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
    """Charcoal lumps under ash; glow gathers in hot spots and the cracks around them (emissive map)."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 20.0, 90.0, -15.0, -90.0)
        pw = g.warp(p, 0.025, 7.0, seed=seed + 5.0)
        f1 = g.voronoi(pw, scale=12.0, feature="F1", w=seed)
        f2 = g.voronoi(pw, scale=12.0, feature="F2", w=seed)
        crack = (f2 - f1).smooth(0.1, 0.0)
        n = g.noise(p, scale=10.0, detail=5.0, w=seed + 1.0)
        hotspot = g.noise(p, scale=2.6, detail=3.0, w=seed + 3.0).smooth(0.4, 0.75)
        ash = (g.noise(p, scale=4.0, detail=5.0, w=seed + 2.0).smooth(0.56, 0.68) * convex.lin(0, 1, 0.5, 1.0)
               + convex * 0.15).clamp() * hotspot.lin(0, 1, 1.0, 0.3)
        base = g.mix(n, "#120e0c", "#2a211b")
        base = g.mix(ash * 0.9, base, g.mix(n, "#6d655c", "#a39a8e"))
        hot = (crack * (hotspot * 0.8 + 0.2) + concave * 0.4 * hotspot + hotspot.smooth(0.7, 1.0) * 0.4).clamp()
        hot = hot * ash.lin(0, 1, 1.0, 0.1)
        emit = g.ramp(hot, [(0.0, "#000000"), (0.3, "#300b02"), (0.6, "#b8481a"), (0.85, "#ff8c34"),
                            (1.0, "#ffbe5c")])
        base = g.mix(hot.smooth(0.45, 0.9), base, "#6e240a")
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
        base = g.ramp(flow, [(0.25, "#8a3a0c"), (0.55, "#c86e1c"), (0.85, "#f2a93b")])
        base = g.mix(cloud.smooth(0.6, 0.8) * 0.35, base, "#f0b050")
        speck = g.voronoi(p, scale=140.0, feature="F1", w=seed + 2.0).smooth(0.1, 0.02)
        gate = g.noise(p, scale=8.0, w=seed + 3.0).smooth(0.5, 0.65)
        base = g.mix(speck * gate * 0.8, base, "#3a1a08")
        bub = g.voronoi(p, scale=80.0, feature="F1", w=seed + 4.0).smooth(0.08, 0.03)
        base = g.mix(bub * 0.5, base, "#ffd98a")
        glow = (flow.lin(0.2, 0.9, 0.35, 1.0) - speck * gate * 0.6).clamp()
        emit = g.mix(glow, "#2e0f02", "#a8561a")  # baked at about half strength; the game scales it
        rough = 0.06 + cloud * 0.05
        return Look(base=base, rough=rough, metal=0.0, ao=1.0, height=None, emit=emit)

    return recipe


# ---------------------------------------------------------------------------
# Idol materials
# ---------------------------------------------------------------------------


def jade(carve: Mask = None, seed: float = 0.0) -> Callable[[Graph], Look]:
    """Polished nephrite: mottled warm greens, pale cloudy veins, dust in recesses."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 30.0, 150.0, -20.0, -120.0)
        n1 = g.noise(p, scale=9.0, detail=6.0, rough=0.6, distortion=1.5, w=seed)
        vein = g.noise(g.scale_vec(p, 14.0, 30.0, 10.0), scale=1.0, detail=5.0, distortion=2.0, w=seed + 1.0)
        base = g.ramp(n1, [(0.25, "#1d2e1e"), (0.45, "#3a5a38"), (0.62, "#56784a"), (0.8, "#7f9866")])
        cloud = g.noise(p, scale=4.0, detail=6.0, rough=0.65, distortion=1.0, w=seed + 8.0)
        base = g.mix(cloud.smooth(0.5, 0.72) * 0.5, base, "#98a487")  # grey-white cloudy patches
        dark = g.noise(p, scale=2.5, detail=4.0, w=seed + 10.0).smooth(0.55, 0.72)
        base = g.mix(dark * 0.55, base, "#1f3322")
        base = g.mix(vein.smooth(0.58, 0.66) * 0.35, base, "#a9b98f")
        spots = g.voronoi(p, scale=60.0, feature="F1", w=seed + 2.0).smooth(0.14, 0.04)
        base = g.mix(spots * g.noise(p, scale=6.0, w=seed + 3.0).smooth(0.5, 0.6) * 0.7, base, "#17261a")
        base = g.mix(convex * 0.25, base, "#9dbb7d")
        rough = 0.22 + (n1 - 0.5) * 0.1 + g.noise(p, scale=40.0, w=seed + 9.0).smooth(0.5, 0.8) * 0.12
        dust = (concave * 1.3 - 0.15).clamp()
        occl = 1.0
        height = g.noise(p, scale=200.0, detail=2.0, w=seed + 4.0) * 0.05
        if carve is not None:
            cv = carve(g, p)
            dust = (dust + cv.smooth(0.3, 0.9) * 0.7).clamp()
            height = height - cv * 3.0
            occl = cv.smooth(0.3, 1.0) * -0.3 + 1.0
        base = g.mix(dust * 0.75, base, "#8c8466")
        rough = g.mixf(dust, rough, 0.6)
        return Look(base=base, rough=rough, metal=0.0, ao=g.ao(0.03, 8) * occl, height=height, bump_dist=0.0004)

    return recipe


def grey_stone(carve: Mask = None, seed: float = 0.0) -> Callable[[Graph], Look]:
    """Weathered grey stone: pitted, paler on raised areas, dark grime in recesses."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 30.0, 150.0, -20.0, -120.0)
        n1 = g.noise(p, scale=12.0, detail=6.0, rough=0.6, w=seed)
        n2 = g.noise(p, scale=45.0, detail=4.0, w=seed + 1.0)
        base = g.ramp(n1, [(0.3, "#48453f"), (0.5, "#625e57"), (0.7, "#7d786e")])
        base = g.mix(n2.smooth(0.3, 0.7) * 0.3, "#55514b", base)
        blot = g.noise(p, scale=5.0, detail=5.0, w=seed + 8.0).smooth(0.55, 0.7)
        base = g.mix(blot * 0.5, base, "#3a3834")
        speck = g.voronoi(p, scale=220.0, feature="F1", w=seed + 2.0).smooth(0.14, 0.03)
        base = g.mix(speck * 0.5, base, "#3a3733")
        wht = g.voronoi(p, scale=180.0, feature="F1", w=seed + 7.0).smooth(0.1, 0.02)
        base = g.mix(wht * 0.4, base, "#c9c3b5")
        base = g.mix(convex * 0.35, base, "#938d81")
        iron = g.noise(p, scale=7.0, detail=4.0, w=seed + 5.0).smooth(0.64, 0.76) * 0.35
        base = g.mix(iron, base, "#7a5c40")
        grime = (concave * 1.2 - 0.1).clamp()
        pits = g.voronoi(p, scale=90.0, feature="F1", w=seed + 3.0).smooth(0.26, 0.08)
        grain = g.noise(p, scale=400.0, detail=2.0, w=seed + 6.0)
        height = n2 * 0.8 - pits * 1.2 + n1 * 0.4 + grain * 0.3
        occl = 1.0
        if carve is not None:
            cv = carve(g, p)
            grime = (grime + cv.smooth(0.3, 0.9) * 0.7).clamp()
            height = height - cv * 3.0
            occl = cv.smooth(0.3, 1.0) * -0.3 + 1.0
        base = g.mix(grime * 0.7, base, "#3e3a34")
        base = g.mix(pits * 0.6, base, "#2f2c28")
        rough = 0.9 + (n2 - 0.5) * 0.08 - convex * 0.12
        return Look(base=base, rough=rough, metal=0.0, ao=g.ao(0.03, 8) * occl, height=height, bump_dist=0.0007)

    return recipe


# ---------------------------------------------------------------------------
# Clay, leather, canvas, brass, sand
# ---------------------------------------------------------------------------


def clay(seed: float = 0.0, band: Mask = None) -> Callable[[Graph], Look]:
    """Fired terracotta amphora: pale slip outside, darker inside, fresh breaks, dirt."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 60.0, 250.0, -30.0, -160.0)
        inner = g.attr("inner").smooth(0.3, 0.7)
        brk = g.attr("brk").smooth(0.2, 0.8)
        n1 = g.noise(p, scale=8.0, detail=5.0, w=seed)
        n2 = g.noise(p, scale=60.0, detail=3.0, w=seed + 1.0)
        body = g.ramp(n1, [(0.3, "#7e4128"), (0.55, "#9a5433"), (0.75, "#ad643d")])
        slip = g.ramp(n1, [(0.3, "#a47350"), (0.55, "#b88a63"), (0.75, "#c49a73")])
        worn = g.noise(p, scale=9.0, detail=4.0, w=seed + 2.0).smooth(0.42, 0.6)
        outside = g.mix((worn + convex * 0.6).clamp() * 0.9, slip, body)
        if band is not None:
            outside = g.mix(band(g, p) * (worn.inv() * 0.7 + 0.3), outside, "#3b2418")
        base = g.mix(inner, outside, g.mix(n2, "#6e3a22", "#7f4a2e"))
        fresh = g.mix(n2, "#b8683c", "#c97d4f")
        base = g.mix(brk, base, fresh)
        grit = g.voronoi(p, scale=320.0, feature="F1", w=seed + 3.0).smooth(0.12, 0.02)
        base = g.mix(grit * 0.5, base, "#e2d2b8")
        dirt = (concave * 1.2 - 0.1).clamp()
        _, _, z = g.separate(p)
        low = z.smooth(0.08, 0.0) * 0.6
        base = g.mix((dirt + low).clamp() * 0.6, base, g.mix(n2, SAND, "#8a7358"))
        rough = 0.86 + (n2 - 0.5) * 0.1 - convex * 0.05
        height = n2 * 0.4 + n1 * 0.3 + g.noise(g.scale_vec(p, 3.0, 3.0, 120.0), scale=1.0, w=seed + 4.0) * 0.25
        height = g.mixf(brk, height, g.noise(p, scale=300.0, detail=2.0, w=seed + 5.0) * 0.8)
        return Look(base=base, rough=rough, metal=0.0, ao=g.ao(0.05, 8), height=height, bump_dist=0.0004)

    return recipe


def leather(emblem: Mask = None, stitches: Mask = None, seed: float = 0.0) -> Callable[[Graph], Look]:
    """Worn saddle leather; lighter, polished wear on edges; green-thread emblem."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 25.0, 110.0, -20.0, -120.0)
        n1 = g.noise(p, scale=10.0, detail=5.0, w=seed)
        pebble = g.voronoi(p, scale=380.0, feature="F1", w=seed + 1.0)
        crease = g.noise(p, scale=28.0, detail=5.0, distortion=3.5, w=seed + 2.0, kind="RIDGED_MULTIFRACTAL")
        crease = crease * 0.5
        base = g.ramp(n1, [(0.3, "#3f2716"), (0.5, "#56361f"), (0.72, "#6d4829")])
        wear = (convex * 1.2 + g.noise(p, scale=18.0, w=seed + 3.0).smooth(0.6, 0.75) * 0.5 - 0.2).clamp()
        base = g.mix(wear * 0.7, base, "#8d6541")
        base = g.mix(crease.smooth(0.55, 0.8) * 0.35, base, "#2e1c10")
        base = g.mix((concave * 1.2).clamp() * 0.5, base, "#6f6049")  # dust in folds
        rough = 0.68 - wear * 0.2 + (n1 - 0.5) * 0.1
        height = pebble.smooth(0.0, 0.5) * 0.4 - crease.smooth(0.5, 0.85) * 0.7
        if stitches is not None:
            st = stitches(g, p)
            base = g.mix(st, base, "#b8a582")
            height = height + st * 1.2
            rough = g.mixf(st, rough, 0.85)
        if emblem is not None:
            em, emh, rim = emblem(g, p)
            thread = g.mix(g.noise(p, scale=400.0, w=seed + 6.0), "#58733a", "#8aa25e")
            thread = g.mix(emh.smooth(0.2, 0.9) * 0.4, "#4a6230", thread)
            thread = g.mix(rim, thread, "#39502a")
            base = g.mix(em, base, thread)
            rough = g.mixf(em, rough, 0.8)
            height = height + emh * 1.5
        return Look(base=base, rough=rough, metal=0.0, ao=g.ao(0.03, 8), height=height, bump_dist=0.0006)

    return recipe


def canvas(seed: float = 0.0) -> Callable[[Graph], Look]:
    """Sand-olive waxed canvas with a visible weave."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 25.0, 110.0, -20.0, -120.0)
        x, y, z = g.separate(p)
        w1 = g.math("SINE", (y + z) * 1400.0)
        w2 = g.math("SINE", (y - z) * 1400.0)
        weave = (w1 * w2) * 0.5 + 0.5
        n1 = g.noise(p, scale=10.0, detail=4.0, w=seed)
        base = g.mix(n1, "#57502f", "#6f6644")
        base = g.mix(weave * 0.2, base, "#7d7350")
        base = g.mix((concave * 1.2).clamp() * 0.5, base, "#4c4530")
        base = g.mix(convex * 0.3, base, "#8a7f5c")
        return Look(base=base, rough=0.9, metal=0.0, ao=g.ao(0.03, 8), height=weave * 0.4 + n1 * 0.2,
                    bump_dist=0.0004)

    return recipe


def brass(seed: float = 0.0) -> Callable[[Graph], Look]:
    """Small worn brass fittings: dull brown tarnish, bright on edges."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        convex, concave = edge_masks(g, 150.0, 500.0, -80.0, -400.0)
        n1 = g.noise(p, scale=80.0, detail=4.0, w=seed)
        tarn = g.mix(n1, "#5e4a2a", "#7a6034")
        bright = g.mix(n1, "#b8914a", "#d4ad62")
        worn = (convex * 1.2 + (n1 - 0.5) * 0.6).clamp()
        base = g.mix(worn, tarn, bright)
        base = g.mix((concave * 1.3).clamp() * 0.7, base, "#2c2418")
        rough = g.mixf(worn, 0.6, 0.3)
        return Look(base=base, rough=rough, metal=g.mixf(worn, 0.7, 1.0), ao=g.ao(0.02, 8), height=n1 * 0.2,
                    bump_dist=0.0002)

    return recipe


def sand(periodic: Callable[[Graph, S, float], tuple] | None = None, seed: float = 0.0) -> Callable[[Graph], Look]:
    """Wind-rippled sand. ``periodic(g, p, scale)`` returns (vector, w) for tileable noise."""

    def recipe(g: Graph) -> Look:
        p = g.pos()
        x, y, z = g.separate(p)

        def nz(scale, detail=3.0, w=0.0, distortion=0.0):
            if periodic is None:
                return g.noise(p, scale=scale, detail=detail, w=w + seed, distortion=distortion)
            v, ww = periodic(g, p, scale)
            return g.noise(v, scale=1.0, detail=detail, w=ww + w + seed, distortion=distortion)

        n1 = nz(1.2, 4.0, 1.0)
        n2 = nz(6.0, 4.0, 2.0)
        fine = nz(120.0, 2.0, 3.0)
        # Ripples run along the wall (crests parallel to X), wavelength ~7 cm, distorted.
        rip_phase = y * 90.0 + (n2 - 0.5) * 9.0 + (n1 - 0.5) * 6.0
        rip = g.math("SINE", rip_phase) * 0.5 + 0.5
        rip = rip ** 1.6
        slope = z.smooth(0.0, 0.3)
        rip_amt = slope.lin(0, 1, 1.0, 0.35)
        base = g.ramp(n1, [(0.3, "#b8966a"), (0.5, "#c8a77c"), (0.7, "#d3b58c")])
        base = g.mix(rip * 0.25 * rip_amt, base, "#dcc29b")
        base = g.mix(rip.inv() * 0.15 * rip_amt, base, "#a98a60")
        base = g.mix(fine.smooth(0.3, 0.7) * 0.15, "#a88a64", base)
        dk = g.voronoi(p, scale=500.0, feature="F1", w=seed + 4.0).smooth(0.12, 0.02)
        base = g.mix(dk * 0.35, base, "#5a4633")
        edge = z.smooth(0.02, 0.0) * 0.25
        base = g.mix(edge, base, "#9c7f5a")
        height = rip * rip_amt * 1.0 + fine * 0.3 + (n2 - 0.5) * 0.8
        rough = 0.95 - fine * 0.03
        return Look(base=base, rough=rough, metal=0.0, ao=g.ao(0.1, 8), height=height, bump_dist=0.0025)

    return recipe
