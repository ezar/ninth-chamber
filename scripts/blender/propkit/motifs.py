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


# Nine-segment seal proportions (fractions of the seal radius ``r``).
SEAL_R0, SEAL_R1 = 0.34, 0.86  # inner / outer radius of the segment ring
SEAL_GAP = 0.05  # half gap between segments
SEAL_RC = 0.085  # corner radius of each segment (rounded tablets)


def seal_sd_np(x, y, r: float):
    """Signed distance (metres, < 0 inside) to the ninth (top) segment, numpy version."""
    import numpy as np

    rr = np.hypot(x, y)
    da = np.mod(np.arctan2(y, x) - math.pi / 2 + math.pi, 2 * math.pi) - math.pi  # angle from the top
    mid, w = (SEAL_R0 + SEAL_R1) / 2 * r, (SEAL_R1 - SEAL_R0) / 2 * r
    arc = np.abs(da) * rr
    h = (math.pi / 9) * rr - SEAL_GAP * r
    qa = arc - (h - SEAL_RC * r)
    qr = np.abs(rr - mid) - (w - SEAL_RC * r)
    return np.hypot(np.maximum(qa, 0), np.maximum(qr, 0)) + np.minimum(np.maximum(qa, qr), 0) - SEAL_RC * r


def seal(g: Graph, lx: S, ly: S, r: float = 0.5, groove: float = 0.012, soft: float = 0.006,
         ninth: str = "outline") -> S:
    """Nine-segment circular seal: eight carved tablets, the ninth (top) only outlined.

    ``ninth`` = "outline" carves the outline groove that holds an inlay, "none" leaves it flat.
    """
    rr = g.vmath("LENGTH", g.combine(lx, ly, 0.0))
    ang = g.math("ARCTAN2", ly, lx)
    t = g.math("FLOORED_MODULO", (ang - (math.pi / 2 - math.pi / 9)) * (9 / (2 * math.pi)), 9.0)
    idx = g.math("FLOOR", t)
    f = t - idx
    mid, w = (SEAL_R0 + SEAL_R1) / 2 * r, (SEAL_R1 - SEAL_R0) / 2 * r
    arc = (f - 0.5).abs() * (2 * math.pi / 9) * rr
    h = rr * (math.pi / 9) - SEAL_GAP * r
    qa = arc - (h - SEAL_RC * r)
    qr = (rr - mid).abs() - (w - SEAL_RC * r)
    outside = g.vmath("LENGTH", g.combine(qa.max(0.0), qr.max(0.0), 0.0))
    d = outside + qa.max(qr).min(0.0) - SEAL_RC * r
    solid = (d * -1.0).smooth(-soft * 0.3, soft)
    outline = band(g, d + groove / 2, groove / 2, soft * 0.6)
    is_ninth = g.math("LESS_THAN", idx, 0.5)
    ninth_mask = outline if ninth == "outline" else g.const(0.0)
    segs = g.mixf(is_ninth, solid, ninth_mask)
    rim = band(g, rr - 0.96 * r, groove * 0.8, soft)
    navel = (0.045 * r - rr).smooth(0.0, soft)
    return (segs + rim + navel * 0.8).clamp()


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
    # Glyph 1: sceptre (staff crowned by a small ring).
    orb = g.vmath("LENGTH", g.combine(lx, ly - 0.2, 0.0))
    gl1 = band(g, lx, lw, soft * 0.5) * ly.smooth(-0.36, -0.32) * ly.smooth(0.1, 0.06) + band(
        g, orb - 0.1, lw * 0.9, soft * 0.5)
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
