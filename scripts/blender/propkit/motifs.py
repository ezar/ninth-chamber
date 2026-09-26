"""Carved motifs as procedural height masks (0 = surface, 1 = carved floor).

All functions take shader/geometry-node sockets for local 2D coordinates in
metres and return a 0..1 carving mask with softened walls, so the bump node
produces bevelled-looking grooves and the same mask can drive dust fill.
"""

from __future__ import annotations

import math

from .nodes import Graph, S


def band(g: Graph, d: S, width: float, soft: float) -> S:
    """1 inside |d| < width, fading to 0 over ``soft``."""
    return d.abs().smooth(width + soft, width)


def box_u(g: Graph, p: S) -> S:
    """Perimeter coordinate around a vertical box centred on the Z axis (metres)."""
    x, y, _ = g.separate(p)
    on_x = g.math("GREATER_THAN", x.abs(), y.abs())
    sx = g.math("SIGN", x)
    sy = g.math("SIGN", y)
    ux = y * sx  # faces +-X run along Y
    uy = x * sy * -1.0 + 4.0  # faces +-Y run along X, offset so faces don't share glyphs
    return g.mixf(on_x, uy, ux)


def seal(g: Graph, lx: S, ly: S, r: float = 0.5, groove: float = 0.012, soft: float = 0.006,
         ninth: str = "outline") -> S:
    """Nine-segment circular seal: eight carved segments, the ninth only outlined.

    The ninth segment is centred at the top (+ly). ``ninth`` = "outline" carves
    its outline groove (for an inlay), "none" leaves it flat.
    """
    rr = g.vmath("LENGTH", g.combine(lx, ly, 0.0))
    ang = g.math("ARCTAN2", ly, lx)  # -pi..pi, 0 = +lx
    # Segment coordinate: 0..9 with segment 0 centred at the top.
    t = g.math("FLOORED_MODULO", (ang - (math.pi / 2 - math.pi / 9)) * (9 / (2 * math.pi)), 9.0)
    idx = g.math("FLOOR", t)
    f = t - idx  # 0..1 within the segment
    r0, r1 = 0.36 * r, 0.86 * r
    seg_w = (r1 - r0) / 2
    radial = band(g, rr - (r0 + r1) / 2, seg_w, soft)
    # Constant-width gaps between segments: angular distance * radius.
    arc = (f - 0.5).abs() * (2 * math.pi / 9) * rr  # metres from segment centre line
    half_arc = (0.5 * (2 * math.pi / 9)) * rr - 0.018 * r / 0.5
    in_arc = (half_arc - arc).smooth(0.0, soft)
    solid = radial * in_arc
    is_ninth = g.math("LESS_THAN", idx, 0.5)
    # Outline of a segment: solid minus its inset.
    radial_in = band(g, rr - (r0 + r1) / 2, seg_w - groove, soft)
    in_arc_in = (half_arc - arc - groove).smooth(0.0, soft)
    outline = (solid - radial_in * in_arc_in).clamp()
    ninth_mask = outline if ninth == "outline" else g.const(0.0)
    segs = g.mixf(is_ninth, solid, ninth_mask)
    # Rings: an outer rim groove and a small central boss outline.
    rim = band(g, rr - 0.97 * r, groove * 0.9, soft)
    boss = band(g, rr - 0.2 * r, groove * 0.7, soft)
    dot = (0.06 * r - rr).smooth(0.0, soft)
    return (segs + rim + boss + dot).clamp()


def glyph_band(g: Graph, u: S, v: S, cell: float = 0.24, seed: float = 0.0) -> S:
    """A frieze of simple Qarrum glyphs between two rules.

    ``u`` runs along the band (metres), ``v`` goes 0..1 across it.
    """
    soft = 0.05
    cu = u / cell
    ci = g.math("FLOOR", cu)
    lx = (cu - ci) - 0.5  # -0.5..0.5 across the cell
    ly = v - 0.5  # -0.5..0.5 up the band
    wn = g.node("ShaderNodeTexWhiteNoise", noise_dimensions="2D")
    g.feed(wn.inputs["Vector"], g.combine(ci, seed, 0.0))
    h = S(g, wn.outputs["Value"])
    lw = 0.055
    rules = band(g, ly - 0.44, 0.03, soft * 0.5) + band(g, ly + 0.44, 0.03, soft * 0.5)
    inner = (0.36 - ly.abs()).smooth(0.0, 0.02)
    # Glyph 0: small nine-part rosette (ring + dot).
    rr = g.vmath("LENGTH", g.combine(lx, ly * 1.0, 0.0))
    gl0 = band(g, rr - 0.24, lw, soft * 0.5) + (0.07 - rr).smooth(0.0, 0.03)
    # Glyph 1: staff with a crossbar near the top.
    gl1 = band(g, lx, lw, soft * 0.5) * (0.32 - ly.abs()).smooth(0.0, 0.03) + band(g, ly - 0.16, lw, soft * 0.5) * (
        0.2 - lx.abs()).smooth(0.0, 0.03)
    # Glyph 2: stacked chevrons.
    chev = ly - lx.abs() * 0.9
    gl2 = (band(g, chev - 0.05, lw, soft * 0.5) + band(g, chev + 0.2, lw, soft * 0.5)) * (0.3 - lx.abs()).smooth(0.0,
                                                                                                           0.03)
    # Glyph 3: corbelled steps (a stair profile).
    step = g.math("FLOOR", (lx + 0.3) * 5.0) * 0.12 - 0.3
    gl3 = band(g, ly - step, lw, soft * 0.5) * (0.3 - lx.abs()).smooth(0.0, 0.03)
    # Glyph 4: two horizontal bars and a dot (a "course").
    gl4 = (band(g, ly - 0.14, lw, soft * 0.5) + band(g, ly + 0.14, lw, soft * 0.5)) * (0.28 - lx.abs()).smooth(
        0.0, 0.03)
    sel0 = g.math("LESS_THAN", h, 0.24)
    sel1 = g.math("LESS_THAN", h, 0.44)
    sel2 = g.math("LESS_THAN", h, 0.64)
    sel3 = g.math("LESS_THAN", h, 0.82)
    glyph = g.mixf(sel3, gl4, gl3)
    glyph = g.mixf(sel2, glyph, gl2)
    glyph = g.mixf(sel1, glyph, gl1)
    glyph = g.mixf(sel0, glyph, gl0)
    return (rules + glyph.clamp() * inner).clamp()
