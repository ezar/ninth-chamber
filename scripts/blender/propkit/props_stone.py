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



# ---------------------------------------------------------------------------
# Shared helpers for stacked masonry
# ---------------------------------------------------------------------------


def _joints(g: Graph, p: S, courses, width: float = 0.009, soft: float = 0.004) -> S:
    """Vertical joints of stacked courses: [(z0, z1, block_length, offset)]."""
    _, _, z = g.separate(p)
    u = motifs.box_u(g, p)
    acc = None
    for z0, z1, L, off in courses:
        ping = (g.math("FRACT", u / L + off) - 0.5).abs()
        dist = (ping * -1.0 + 0.5) * L
        m = dist.smooth(width + soft, width) * z.smooth(z0 - 0.002, z0 + 0.004) * z.smooth(z1 + 0.002, z1 - 0.004)
        acc = m if acc is None else acc + m
    return acc.clamp()


def _square_ring(profile, inner_hw: float | None, name: str, top_cap: bool = False) -> bpy.types.Object:
    """Loft square loops. With ``inner_hw`` the ring is closed into a solid (bake source)."""
    bm = bmesh.new()
    rings = shapes.square_loops(profile)
    if inner_hw is not None:
        z0, z1 = profile[0][1], profile[-1][1]
        rings = rings + shapes.square_loops([(inner_hw, z1), (inner_hw, z0)]) + [rings[0]]
        shapes.loft(bm, rings)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    else:
        # Open lofts of counter-clockwise rings already face outwards (and soffits down).
        shapes.loft(bm, rings, cap_end=top_cap)
    return core.obj_from_bmesh(name, bm)


def _recess(obj, planes, pick, depth: float) -> None:
    """Cut ``planes`` [(co, no)] through the mesh and push the faces chosen by ``pick`` inwards."""
    bm = shapes.to_bm(obj)
    for co, no in planes:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no)
    bm.normal_update()
    sel = [f for f in bm.faces if pick(f)]
    for f in sel:
        n = f.normal.copy()
        r = bmesh.ops.extrude_discrete_faces(bm, faces=[f])
        bmesh.ops.translate(bm, verts=r["faces"][0].verts, vec=-n * depth)
        if f.is_valid:
            bmesh.ops.delete(bm, geom=[f], context="FACES_ONLY")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    bm.normal_update()
    shapes.from_bm(obj, bm)


def _low_bevel(obj, width: float, segs: int = 2, angle: float = 30.0) -> None:
    core.bevel(obj, width, segs, angle)


# ---------------------------------------------------------------------------
# Column base and capital (wrap a 2 x 2 m pillar)
# ---------------------------------------------------------------------------

BASE_PROFILE = [(1.15, 0.0), (1.15, 0.27), (1.09, 0.27), (1.09, 0.41), (0.985, 0.5)]
CAP_PROFILE = [(0.985, 0.0), (1.05, 0.0), (1.05, 0.2), (1.10, 0.2), (1.10, 0.4), (1.15, 0.4), (1.15, 0.6)]


def column_base(ctx: Ctx) -> list:
    low = name_mesh(_square_ring(BASE_PROFILE, None, "column_base"), "column_base")
    _low_bevel(low, 0.035, 2)
    src = _square_ring(BASE_PROFILE, 0.94, "column_base_src")
    core.bevel(src, 0.035, 5, 30)

    def carve(g, p):
        return _joints(g, p, [(0.0, 0.27, 1.15, 0.37), (0.27, 0.5, 0.9, 0.11)]) * 0.9

    def disp(g):
        return looks.stone_disp(g, chip=0.03, seed=3.0, chip_density=0.7) - carve(g, g.pos()) * 0.012

    hi = high(src, "column_base_high", looks.sandstone(carve=carve, seed=3.0), voxel=0.008, disp=disp,
              curv0_blur=4, keep_base=False)
    core.smooth_by_angle(low, 35)
    core.uv_smart(low, 45, 0.004)
    finish(ctx, [BakeSpec("column_base", low, [hi], size=1024, cage=0.04, ray=0.1, normal_jpeg=True)])
    return [low]


def column_capital(ctx: Ctx) -> list:
    low = name_mesh(_square_ring(CAP_PROFILE, None, "column_capital"), "column_capital")
    _low_bevel(low, 0.03, 2)
    src = _square_ring(CAP_PROFILE, 0.94, "column_capital_src")
    core.bevel(src, 0.03, 5, 30)

    def carve(g, p):
        _, _, z = g.separate(p)
        j = _joints(g, p, [(0.0, 0.2, 0.75, 0.2), (0.2, 0.4, 0.95, 0.55), (0.4, 0.6, 1.15, 0.05)])
        # A shallow incised rule along the top course.
        rule = motifs.band(g, z - 0.5, 0.008, 0.004)
        return (j + rule * 0.6).clamp()

    def soot(g, p):
        _, _, z = g.separate(p)
        n = g.noise(p, scale=2.0, detail=4.0, w=21.0)
        return (z.smooth(0.1, 0.6) * 0.35 + (n - 0.5) * 0.3).clamp()

    def disp(g):
        return looks.stone_disp(g, chip=0.03, seed=5.0, chip_density=0.7) - carve(g, g.pos()) * 0.012

    hi = high(src, "column_capital_high", looks.sandstone(carve=carve, soot=soot, damp=False, seed=5.0),
              voxel=0.008, disp=disp, curv0_blur=4, keep_base=False)
    core.smooth_by_angle(low, 35)
    core.uv_smart(low, 45, 0.004)
    finish(ctx, [BakeSpec("column_capital", low, [hi], size=1024, cage=0.04, ray=0.1, normal_jpeg=True)])
    return [low]


# ---------------------------------------------------------------------------
# Door with the nine-segment seal
# ---------------------------------------------------------------------------

DOOR_W0, DOOR_W1, DOOR_H, DOOR_T = 2.0, 1.84, 5.0, 0.45
SEAL_Z, SEAL_R = 2.6, 0.55


def _door_solid(name: str) -> bpy.types.Object:
    bm = bmesh.new()
    t = DOOR_T / 2
    rings = []
    for z, hw in ((0.0, DOOR_W0 / 2), (DOOR_H, DOOR_W1 / 2)):
        rings.append([Vector((hw, -t, z)), Vector((hw, t, z)), Vector((-hw, t, z)), Vector((-hw, -t, z))])
    shapes.loft(bm, rings, cap_start=True, cap_end=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return core.obj_from_bmesh(name, bm)


def _door_carve(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    seal = motifs.seal(g, x, z - SEAL_Z, SEAL_R, groove=0.013, soft=0.005)
    # Incised border following the trapezoid, 0.14 m in from the edges.
    hw = z * (-(DOOR_W0 - DOOR_W1) / (2 * DOOR_H)) + DOOR_W0 / 2
    inset = 0.14
    side = motifs.band(g, x.abs() - (hw - inset), 0.011, 0.005)
    in_z = z.smooth(inset - 0.012, inset + 0.004) * z.smooth(DOOR_H - inset + 0.012, DOOR_H - inset - 0.004)
    in_x = (hw - inset + 0.012 - x.abs()).smooth(0.0, 0.004)
    tops = (motifs.band(g, z - inset, 0.011, 0.005) + motifs.band(g, z - (DOOR_H - inset), 0.011, 0.005)) * in_x
    border = (side * in_z + tops).clamp()
    # Two short rules framing the seal.
    rules = (motifs.band(g, z - (SEAL_Z + SEAL_R + 0.16), 0.008, 0.004)
             + motifs.band(g, z - (SEAL_Z - SEAL_R - 0.16), 0.008, 0.004)) * (0.6 - x.abs()).smooth(0.0, 0.01)
    wear = g.noise(p, scale=2.0, detail=3.0, w=31.0).smooth(0.2, 0.6)
    return (seal * (wear * 0.3 + 0.7) + (border + rules) * (wear * 0.5 + 0.5)).clamp()


def _door_touch(g: Graph, p: S) -> S:
    x, _, z = g.separate(p)
    d = g.vmath("LENGTH", g.combine(x, z - (SEAL_Z + SEAL_R * 0.6), 0.0))
    return d.smooth(0.42, 0.12) * g.noise(p, scale=6.0, w=33.0).smooth(0.3, 0.6)


def _seal_amber(name: str) -> bpy.types.Object:
    """Raised amber inlay tracing the ninth (top) segment's outline, on both faces."""
    r = SEAL_R
    r0, r1 = 0.36 * r, 0.86 * r
    gap = 0.011 * r / 0.5
    inset = 0.0065
    pts = []

    def half_angle(rr):
        return math.pi / 9 - (gap + inset) / rr

    # Outer arc (left to right), inner arc (right to left), in the segment's local polar frame.
    ra, rb = r1 - inset, r0 + inset
    na, nb = 22, 10
    for i in range(na + 1):
        a = math.pi / 2 + half_angle(ra) - (2 * half_angle(ra)) * i / na
        pts.append((ra * math.cos(a), ra * math.sin(a)))
    for i in range(nb + 1):
        a = math.pi / 2 - half_angle(rb) + (2 * half_angle(rb)) * i / nb
        pts.append((rb * math.cos(a), rb * math.sin(a)))
    pts.reverse()  # counter-clockwise, so (ty, -tx) is the outward normal
    n = len(pts)
    loops = {"out": [], "top_out": [], "top_in": [], "in": []}
    for i in range(n):
        p0 = Vector(pts[i - 1])
        p1 = Vector(pts[i])
        p2 = Vector(pts[(i + 1) % n])
        t0 = (p1 - p0).normalized()
        t1 = (p2 - p1).normalized()
        n0 = Vector((t0.y, -t0.x))
        n1 = Vector((t1.y, -t1.x))
        nm = (n0 + n1).normalized()
        miter = 1.0 / max(nm.dot(n1), 0.35)
        for key, off in (("out", 0.0055), ("top_out", 0.0035), ("top_in", -0.0035), ("in", -0.0055)):
            q = p1 + nm * off * miter
            loops[key].append(q)
    bm = bmesh.new()
    for side in (1, -1):
        y0 = side * (DOOR_T / 2 - 0.002)
        y1 = side * (DOOR_T / 2 + 0.0045)
        rings = []
        for key, yy in (("out", y0), ("top_out", y1), ("top_in", y1), ("in", y0)):
            rings.append([Vector((q.x * side, yy, SEAL_Z + q.y)) for q in loops[key]])
        faces = shapes.loft(bm, rings, closed=True)
        for f in faces:
            f.normal_update()
            if f.normal.y * side < 0:
                f.normal_flip()
    return core.obj_from_bmesh(name, bm)


def door(ctx: Ctx) -> list:
    low = name_mesh(_door_solid("door"), "door")
    _low_bevel(low, 0.05, 2)
    _delete_faces(low, lambda f: f.normal.z < -0.9 and f.calc_center_median().z < 1e-3)
    src = _door_solid("door_src")
    core.bevel(src, 0.05, 6, 30)

    def disp(g):
        return looks.stone_disp(g, chip=0.04, seed=7.0, chip_density=0.75) - _door_carve(g, g.pos()) * 0.004

    hi = high(src, "door_high", looks.sandstone(carve=_door_carve, touch=_door_touch, seed=7.0), voxel=0.01,
              disp=disp, curv0_blur=4, keep_base=False)
    core.smooth_by_angle(low, 35)
    core.uv_smart(low, 45, 0.003)
    amber = name_mesh(_seal_amber("seal_amber"), "seal_amber")
    core.smooth_by_angle(amber, 50)
    core.uv_smart(amber, 60, 0.01)
    amber.data.materials.append(amber_inlay_material())
    finish(ctx, [BakeSpec("door", low, [hi], size=1024, cage=0.05, ray=0.12, normal_jpeg=True)])
    return [low, amber]


def amber_inlay_material() -> bpy.types.Material:
    """Plain amber (no textures): the game drives its emissive intensity."""
    from .nodes import hex_rgb

    m = bpy.data.materials.new("seal_amber")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    c = hex_rgb("#f2a93b")
    b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
    b.inputs["Roughness"].default_value = 0.32
    b.inputs["Metallic"].default_value = 0.0
    e = hex_rgb("#f2a93b")
    b.inputs["Emission Color"].default_value = (e[0], e[1], e[2], 1)
    b.inputs["Emission Strength"].default_value = 0.5
    return m


# ---------------------------------------------------------------------------
# Altar (top exactly 1.0 m, sits on a 1 m grid step)
# ---------------------------------------------------------------------------

ALTAR_PROFILE = [(1.0, 0.0), (1.0, 0.14), (0.95, 0.14), (0.95, 0.22), (0.9, 0.22), (0.9, 0.8), (0.95, 0.8),
                 (0.95, 0.87), (1.0, 0.87), (1.0, 1.0)]
FRIEZE = (0.3, 0.72, 0.7)  # z0, z1, half length of the recessed panel


def _altar_solid(name: str, closed: bool) -> bpy.types.Object:
    bm = bmesh.new()
    rings = shapes.square_loops(ALTAR_PROFILE)
    shapes.loft(bm, rings, cap_start=closed, cap_end=True)
    obj = core.obj_from_bmesh(name, bm)
    z0, z1, hl = FRIEZE
    planes = [((0, 0, z0), (0, 0, 1)), ((0, 0, z1), (0, 0, 1)), ((hl, 0, 0), (1, 0, 0)), ((-hl, 0, 0), (1, 0, 0)),
              ((0, hl, 0), (0, 1, 0)), ((0, -hl, 0), (0, 1, 0))]

    def pick(f):
        c = f.calc_center_median()
        n = f.normal
        if abs(n.z) > 0.5 or not (z0 < c.z < z1):
            return False
        along = c.y if abs(n.x) > 0.9 else c.x
        return abs(along) < hl and max(abs(c.x), abs(c.y)) > 0.89

    _recess(obj, planes, pick, 0.025)
    return obj


def _altar_carve(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    z0, z1, hl = FRIEZE
    u = motifs.box_u(g, p)
    v = (z - z0 - 0.04) / (z1 - z0 - 0.08)
    inb = v.smooth(-0.02, 0.02) * v.smooth(1.02, 0.98)
    fr = motifs.glyph_band(g, u + 0.2, v, cell=0.28, seed=9.0) * inb
    # Nine-segment seal carved faintly into the top, where the relic rests.
    top = z.smooth(0.985, 0.995)
    seal = motifs.seal(g, x, y, 0.34, groove=0.01, soft=0.005, ninth="outline") * top
    wear = g.noise(p, scale=2.2, detail=3.0, w=41.0).smooth(0.2, 0.65)
    return (fr * (wear * 0.4 + 0.6) + seal * (wear * 0.5 + 0.3)).clamp()


def _altar_touch(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    top = z.smooth(0.9, 0.99)
    front = (y + 0.0).smooth(0.4, 0.95)  # front edge (game front = Blender +Y)
    return top * front * g.noise(p, scale=4.0, w=43.0).smooth(0.3, 0.6)


def altar(ctx: Ctx) -> list:
    low = name_mesh(_altar_solid("altar", closed=False), "altar")
    _low_bevel(low, 0.03, 2)
    src = _altar_solid("altar_src", closed=True)
    core.bevel(src, 0.03, 5, 30)

    def disp(g):
        return looks.stone_disp(g, chip=0.03, seed=11.0, chip_density=0.7) - _altar_carve(g, g.pos()) * 0.004

    hi = high(src, "altar_high", looks.sandstone(carve=_altar_carve, touch=_altar_touch, seed=11.0), voxel=0.008,
              disp=disp, curv0_blur=4, keep_base=False)
    core.smooth_by_angle(low, 35)
    core.uv_smart(low, 45, 0.003)
    finish(ctx, [BakeSpec("altar", low, [hi], size=1024, cage=0.04, ray=0.1, normal_jpeg=True)])
    return [low]


# ---------------------------------------------------------------------------
# Rubble: fallen chunks of dressed sandstone
# ---------------------------------------------------------------------------


def _chunk(rng: random.Random, size, cuts: int, name: str):
    """A dressed block broken by random planes. Returns (object, fracture planes)."""
    sx, sy, sz = size
    bm = bmesh.new()
    shapes.box(bm, (-sx / 2, -sy / 2, 0), (sx / 2, sy / 2, sz))
    planes = []
    for _ in range(cuts):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.2, 1))).normalized()
        c = Vector((d.x * sx * rng.uniform(0.18, 0.38), d.y * sy * rng.uniform(0.18, 0.38),
                    sz * 0.5 + d.z * sz * rng.uniform(0.15, 0.35)))
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        r = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=c, plane_no=d, clear_outer=True)
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
        planes.append((c.copy(), d.copy()))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return core.obj_from_bmesh(name, bm), planes


def _frac_attr(obj, planes, band: float = 0.02) -> None:
    import numpy as np

    co = core.mesh_coords(obj)
    w = np.zeros(len(co))
    for c, n in planes:
        d = np.abs((co - np.array(c)) @ np.array(n))
        w = np.maximum(w, np.clip(1.0 - d / band, 0, 1))
    core.write_attr(obj, "frac", w)


def _place(objs, loc, yaw: float, tilt=(0.0, 0.0)) -> None:
    """Rotate, then rest the first object (the detailed one) on the floor; others follow."""
    from mathutils import Euler, Matrix

    m = Euler((math.radians(tilt[0]), math.radians(tilt[1]), math.radians(yaw))).to_matrix().to_4x4()
    for o in objs:
        o.data.transform(m)
    zmin = min(core.mesh_coords(o)[:, 2].min() for o in objs)
    for o in objs:
        o.data.transform(Matrix.Translation((loc[0], loc[1], -zmin)))


def _rubble(ctx: Ctx, name: str, seed: int, chunks) -> list:
    rng = random.Random(seed)
    lows, highs = [], []
    for i, (size, cuts, loc, yaw, tilt) in enumerate(chunks):
        src, planes = _chunk(rng, size, cuts, f"{name}_src{i}")
        core.bevel(src, 0.025, 3, 30)
        core.remesh(src, 0.006 if max(size) < 0.4 else 0.009)
        _frac_attr(src, planes)
        s = float(seed * 10 + i)

        amp = 0.045 * max(size)

        def disp(g, s=s, amp=amp):
            p = g.pos()
            fr = g.attr("frac").smooth(0.0, 0.5)
            dressed = looks.stone_disp(g, amp=0.004, chip=0.02, seed=s, chip_density=0.8, chip_scale=10.0)
            # Conchoidal fracture: stepped facets (random height per Voronoi cell) over rough noise.
            pw = g.warp(p, 0.04, 6.0, seed=s + 2.5)
            cell = g.voronoi(pw, scale=9.0 / max(size[0], 0.3), feature="F1", out="Color", w=s + 3.5)
            facet = (g.separate(cell)[0] - 0.5) * (amp * 0.5)
            rough = (g.noise(p, scale=6.0, detail=6.0, rough=0.6, w=s + 0.5, kind="RIDGED_MULTIFRACTAL") * (amp * 0.12)
                     + (g.noise(p, scale=2.5, detail=4.0, rough=0.55, w=s + 1.5) - 0.5) * (amp * 1.4)
                     + facet)
            return g.mixf(fr, dressed, rough)

        core.curvature(src, "curv0", 3)
        core.displace(src, disp)
        low = core.copy_obj(src, f"{name}_low{i}")
        core.decimate_to(low, chunks_budget(size))
        _place([src, low], loc, yaw, tilt)
        lows.append(low)
        highs.append(src)
    hi = core.join(highs, f"{name}_high")
    hi = high(hi, f"{name}_high", looks.sandstone(seed=float(seed), fresh="frac", damp=False, sand_amount=1.2),
              keep_base=False, curv_blur=3)
    low = name_mesh(core.join(lows, name), name)
    core.smooth_by_angle(low, 55)
    core.uv_smart(low, 50, 0.004, shape="CONCAVE")
    finish(ctx, [BakeSpec(name, low, [hi], size=1024, cage=0.02, ray=0.05, normal_jpeg=True)])
    return [low]


def chunks_budget(size) -> int:
    m = max(size)
    return 520 if m > 0.6 else (320 if m > 0.35 else 190)


def rubble_a(ctx: Ctx) -> list:
    return _rubble(ctx, "rubble_a", 101, [
        ((0.8, 0.55, 0.46), 4, (0.0, 0.0), 12.0, (0.0, 0.0)),
        ((0.26, 0.22, 0.18), 3, (0.62, -0.28), 40.0, (8.0, -6.0)),
        ((0.22, 0.2, 0.15), 3, (-0.55, 0.36), -25.0, (-5.0, 10.0)),
    ])


def rubble_b(ctx: Ctx) -> list:
    return _rubble(ctx, "rubble_b", 202, [
        ((0.5, 0.4, 0.3), 4, (0.0, 0.0), -8.0, (4.0, 0.0)),
        ((0.42, 0.3, 0.26), 4, (0.46, 0.2), 55.0, (-10.0, 6.0)),
        ((0.3, 0.26, 0.2), 3, (-0.36, -0.26), 20.0, (12.0, -8.0)),
    ])


def rubble_c(ctx: Ctx) -> list:
    return _rubble(ctx, "rubble_c", 303, [
        ((0.3, 0.24, 0.18), 3, (0.0, 0.0), 5.0, (6.0, 0.0)),
        ((0.24, 0.2, 0.16), 3, (0.34, 0.12), 60.0, (-12.0, 8.0)),
        ((0.22, 0.2, 0.14), 3, (-0.3, 0.2), -30.0, (10.0, 14.0)),
        ((0.2, 0.18, 0.14), 3, (0.1, -0.32), 80.0, (-8.0, -10.0)),
        ((0.2, 0.16, 0.12), 3, (-0.22, -0.24), 15.0, (14.0, 6.0)),
    ])
