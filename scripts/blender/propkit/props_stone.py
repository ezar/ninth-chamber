"""Sandstone props: block, column base and capital, door, altar, rubble."""

from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Vector

from . import core, looks, motifs, shapes
from .core import BakeSpec
from .kit import Ctx, finish, high, name_mesh
from .nodes import Graph, S


def _set_bevel_weights(obj, fn) -> None:
    """Edge bevel weights from ``fn(edge) -> weight`` (for WEIGHT-limited bevels)."""
    bm = shapes.to_bm(obj)
    lay = bm.edges.layers.float.get("bevel_weight_edge") or bm.edges.layers.float.new("bevel_weight_edge")
    for e in bm.edges:
        e[lay] = fn(e)
    shapes.from_bm(obj, bm)


def _delete_faces(obj, pred) -> None:
    bm = shapes.to_bm(obj)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if pred(f)], context="FACES")
    shapes.from_bm(obj, bm)


# ---------------------------------------------------------------------------
# Pushable block
# ---------------------------------------------------------------------------

NOTCH_Z, NOTCH_H, NOTCH_W, NOTCH_D = 1.2, 0.15, 0.6, 0.07


def _block_base() -> bpy.types.Object:
    bm = bmesh.new()
    shapes.box(bm, (-1, -1, 0), (1, 1, 2))
    side = [f for f in bm.faces if abs(f.normal.z) < 0.5]
    for z in (NOTCH_Z - NOTCH_H / 2, NOTCH_Z + NOTCH_H / 2):
        geom = list(bm.faces) + list(bm.edges) + list(bm.verts)
        bmesh.ops.bisect_plane(bm, geom=[g for g in geom if not isinstance(g, bmesh.types.BMFace)
                                         or abs(g.normal.z) < 0.5], dist=1e-6, plane_co=(0, 0, z),
                               plane_no=(0, 0, 1))
    for axis in (0, 1):
        for s in (-1, 1):
            co = [0, 0, 0]
            co[axis] = s * NOTCH_W / 2
            no = [0, 0, 0]
            no[axis] = 1
            faces = [f for f in bm.faces if abs(f.normal[1 - axis]) > 0.9]
            edges = {e for f in faces for e in f.edges}
            verts = {v for f in faces for v in f.verts}
            bmesh.ops.bisect_plane(bm, geom=faces + list(edges) + list(verts), dist=1e-6, plane_co=co,
                                   plane_no=no)
    notch = []
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        if abs(n.z) > 0.5 or abs(c.z - NOTCH_Z) > NOTCH_H / 2:
            continue
        along = c.y if abs(n.x) > 0.9 else c.x
        if abs(along) < NOTCH_W / 2:
            notch.append(f)
    for f in notch:
        n = f.normal.copy()
        r = bmesh.ops.extrude_discrete_faces(bm, faces=[f])
        nf = r["faces"][0]
        bmesh.ops.translate(bm, verts=nf.verts, vec=-n * NOTCH_D)
        bmesh.ops.delete(bm, geom=[f], context="FACES_ONLY") if f.is_valid else None
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    bm.normal_update()
    obj = core.obj_from_bmesh("block_base", bm)

    def w(e):
        a, b = e.verts[0].co, e.verts[1].co
        def outer(v):
            return sum([abs(abs(v.x) - 1) < 1e-4, abs(abs(v.y) - 1) < 1e-4,
                        abs(v.z) < 1e-4 or abs(v.z - 2) < 1e-4]) >= 2
        if outer(a) and outer(b):
            return 1.0
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(30):
            return 0.3
        return 0.0

    _set_bevel_weights(obj, w)
    return obj


def _block_carve(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    u = motifs.box_u(g, p)
    v = (z - 1.52) / 0.22
    inband = v.smooth(-0.02, 0.02) * v.smooth(1.02, 0.98)
    glyph = motifs.glyph_band(g, u + 0.12, v, cell=0.25, seed=2.0) * inband
    wear = g.noise(p, scale=1.6, detail=3.0, w=3.0).smooth(0.25, 0.7)
    flake = g.noise(p, scale=9.0, detail=3.0, w=4.0).smooth(0.55, 0.62)
    glyph = glyph * (wear * 0.6 + 0.2) * flake.lin(0, 1, 1.0, 0.25)
    streak = g.noise(g.scale_vec(p, 2.5, 2.5, 70.0), scale=1.0, detail=3.0, w=5.0)
    grooves = streak.smooth(0.6, 0.74) * z.smooth(0.42, 0.06)
    return (glyph + grooves * 0.8).clamp()


def _block_touch(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    u = motifs.box_u(g, p)
    near = (z - NOTCH_Z).abs().smooth(0.2, 0.08)
    along = g.math("FLOORED_MODULO", u + 1.0, 2.0) - 1.0
    return near * along.abs().smooth(0.42, 0.3)


def block(ctx: Ctx) -> list:
    base = _block_base()
    low = name_mesh(core.copy_obj(base, "block"), "block")
    m = low.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments, m.limit_method, m.profile = 0.06, 2, "WEIGHT", 0.5
    core.apply_modifiers(low)
    _delete_faces(low, lambda f: f.normal.z < -0.9 and f.calc_center_median().z < 1e-3)
    m = base.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments, m.limit_method, m.profile = 0.06, 6, "WEIGHT", 0.5
    core.apply_modifiers(base)
    hi = high(base, "block_high", looks.sandstone(pale=0.42, carve=_block_carve, touch=_block_touch, seed=1.0),
              voxel=0.008, disp=lambda g: looks.stone_disp(g, chip=0.035, seed=1.0, chip_density=0.8), curv0_blur=4,
              keep_base=False)
    core.smooth_by_angle(low, 35)
    core.uv_smart(low, 45, 0.004)
    finish(ctx, [BakeSpec("block", low, [hi], size=1024, cage=0.04, ray=0.1, normal_jpeg=True)])
    return [low]


# Placeholders filled in below.
def column_base(ctx: Ctx) -> list:
    raise NotImplementedError


def column_capital(ctx: Ctx) -> list:
    raise NotImplementedError


def door(ctx: Ctx) -> list:
    raise NotImplementedError


def altar(ctx: Ctx) -> list:
    raise NotImplementedError


def rubble_a(ctx: Ctx) -> list:
    raise NotImplementedError


def rubble_b(ctx: Ctx) -> list:
    raise NotImplementedError


def rubble_c(ctx: Ctx) -> list:
    raise NotImplementedError
