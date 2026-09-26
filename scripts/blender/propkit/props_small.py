"""Small props and dressing: idols, medkit, broken amphora, sand drift."""

from __future__ import annotations

import math
import random

import bpy  # noqa: F401  (must precede bmesh when bpy runs as a module)
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

from . import core, looks, motifs, shapes
from .core import BakeSpec
from .kit import Ctx, finish, high, name_mesh
from .nodes import Graph, S

# ---------------------------------------------------------------------------
# Votive idols (30 cm): abstract seated figure, elongated head, folded arms
# ---------------------------------------------------------------------------

IDOL_H = 0.30
_MB_K = 0.573  # isolated metaball surface radius / element radius (threshold 0.6, stiffness 2)


def _ellipsoid(mb, c, semi, rot=None, r=0.03):
    e = mb.elements.new(type="ELLIPSOID")
    e.co = c
    e.radius = r
    e.stiffness = 2.0
    e.size_x, e.size_y, e.size_z = (s / (_MB_K * r) for s in semi)
    if rot is not None:
        e.rotation = rot
    return e


def _capsule(mb, a, b, radius):
    a, b = Vector(a), Vector(b)
    e = mb.elements.new(type="CAPSULE")
    e.co = (a + b) / 2
    e.radius = radius / _MB_K
    e.stiffness = 2.0
    e.size_x = (b - a).length / 2
    e.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
    return e


def _idol_geometry() -> bpy.types.Object:
    mb = bpy.data.metaballs.new("idol_mb")
    mb.resolution = 0.0022
    mb.render_resolution = 0.0022
    mb.threshold = 0.6
    ob = core.link(bpy.data.objects.new("idol_mb", mb))
    tilt = Euler((math.radians(-14), 0, 0)).to_quaternion()
    _ellipsoid(mb, (0, 0.006, 0.066), (0.05, 0.044, 0.026))  # lap / hips
    _capsule(mb, (-0.034, 0.034, 0.056), (0.034, 0.034, 0.056), 0.018)  # crossed legs
    _ellipsoid(mb, (0, -0.002, 0.122), (0.036, 0.026, 0.052))  # torso
    _ellipsoid(mb, (0, -0.004, 0.164), (0.047, 0.024, 0.014))  # shoulders
    for s in (-1, 1):
        _capsule(mb, (s * 0.045, -0.002, 0.162), (s * 0.04, 0.02, 0.132), 0.0095)  # upper arms
    _capsule(mb, (-0.036, 0.024, 0.134), (0.036, 0.027, 0.128), 0.0095)  # folded forearms
    _capsule(mb, (0, -0.004, 0.17), (0, 0.0, 0.2), 0.011)  # neck
    _ellipsoid(mb, (0, 0.002, 0.236), (0.024, 0.027, 0.045), rot=tilt)  # face / head
    _ellipsoid(mb, (0, -0.014, 0.262), (0.02, 0.024, 0.036), rot=tilt)  # elongated back of skull
    _ellipsoid(mb, (0, 0.027, 0.236), (0.0045, 0.006, 0.012))  # nose ridge
    _ellipsoid(mb, (0, 0.022, 0.25), (0.019, 0.007, 0.0045))  # brow
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    fig = core.link(bpy.data.objects.new("idol_fig", me))
    bm = bmesh.new()
    plinth = [(0.0, 0.0), (0.074, 0.0), (0.078, 0.004), (0.078, 0.03), (0.074, 0.036), (0.066, 0.042), (0.0, 0.042)]
    shapes.lathe(bm, plinth, 72)
    pl = core.obj_from_bmesh("idol_plinth", bm)
    obj = core.join([fig, pl], "idol_src")
    core.remesh(obj, 0.0011)
    m = obj.modifiers.new("Smooth", "CORRECTIVE_SMOOTH")
    m.iterations = 4
    m.smooth_type = "SIMPLE"
    m.use_only_smooth = True
    core.apply_modifiers(obj)
    # Exact height 0.30 m, bottom at z = 0.
    co = core.mesh_coords(obj)
    s = IDOL_H / (co[:, 2].max() - co[:, 2].min())
    obj.data.transform(Matrix.Translation((0, 0, -co[:, 2].min())))
    obj.data.transform(Matrix.Scale(s, 4))
    core.set_origin_bottom(obj)
    return obj


def _idol_carve(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    s = IDOL_H / 0.3
    front = y.smooth(0.012 * s, 0.02 * s)
    eyes = None
    for sx in (-1, 1):
        d = g.vmath("LENGTH", g.combine((x - sx * 0.0105 * s) / 0.0068, (z - 0.2425 * s) / 0.0024, 0.0))
        e = d.smooth(1.0, 0.7)
        eyes = e if eyes is None else eyes + e
    mouth = motifs.band(g, z - 0.2245 * s, 0.0008, 0.0006) * (0.0065 * s - x.abs()).smooth(0.0, 0.001)
    fingers = None
    for fx in (0.006, 0.013, 0.02, 0.027):
        f = motifs.band(g, x - fx * s, 0.0007, 0.0005) * (z - 0.131 * s).abs().smooth(0.011 * s, 0.007 * s)
        fingers = f if fingers is None else fingers + f
    fingers = fingers * y.smooth(0.028 * s, 0.033 * s)
    neck = motifs.band(g, z - 0.19 * s, 0.0009, 0.0006) * y.smooth(-0.002, 0.004)
    # Nine notches around the plinth.
    ang = g.math("ARCTAN2", y, x)
    f9 = g.math("FRACT", ang * (9 / (2 * math.pi)) + 0.25) - 0.5
    r = g.vmath("LENGTH", g.combine(x, y, 0.0))
    notch = motifs.band(g, f9, 0.035, 0.02) * z.smooth(0.008, 0.012) * z.smooth(0.03, 0.026) * r.smooth(0.074, 0.077)
    rule = motifs.band(g, z - 0.036, 0.0008, 0.0006) * r.smooth(0.07, 0.074)
    return ((eyes + mouth) * front + fingers + neck + notch + rule).clamp()


def _idol(ctx: Ctx, name: str, recipe) -> list:
    src = _idol_geometry()
    low = name_mesh(core.copy_obj(src, name), name)
    core.decimate_to(low, 2600)
    hi = high(src, f"{name}_high", recipe, curv_blur=4, keep_base=False)
    core.smooth_by_angle(low, 70)
    core.uv_smart(low, 55, 0.006, shape="CONCAVE")
    finish(ctx, [BakeSpec(name, low, [hi], size=512, cage=0.004, ray=0.01)])
    return [low]


def idol_jade(ctx: Ctx) -> list:
    return _idol(ctx, "idol_jade", looks.jade(carve=_idol_carve, seed=1.0))


def idol_gold(ctx: Ctx) -> list:
    return _idol(ctx, "idol_gold", looks.gold(carve=_idol_carve, seed=2.0, edge_lo=40.0, edge_hi=160.0))


def idol_stone(ctx: Ctx) -> list:
    return _idol(ctx, "idol_stone", looks.grey_stone(carve=_idol_carve, seed=3.0))


# ---------------------------------------------------------------------------
# Medkit: worn leather field pouch, buckled flap, stitched green leaf
# ---------------------------------------------------------------------------

BODY = (0.155, 0.095, 0.11)  # half x, half y, height
FLAP_PATH = [(-0.099, 0.104), (-0.092, 0.115), (-0.06, 0.1205), (0.0, 0.1215), (0.06, 0.1205), (0.09, 0.116),
             (0.1005, 0.104), (0.1025, 0.085), (0.1025, 0.065)]
FLAP_HW = 0.15


def _flap_tip_z(x: float) -> float:
    return 0.066 + 0.022 * (x / FLAP_HW) ** 2


def _medkit_body(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    hx, hy, h = BODY
    shapes.box(bm, (-hx, -hy, 0.0), (hx, hy, h))
    obj = core.obj_from_bmesh("medkit_body", bm)
    core.bevel(obj, 0.026, 4 if detail else 2, 30)
    return obj


def _medkit_flap(detail: bool) -> bpy.types.Object:
    """Flap draped over the top and the front, lower edge curving down to a tongue."""
    nx = 17 if detail else 9
    ns = 24 if detail else 9
    path = [Vector((0, y, z)) for y, z in FLAP_PATH]
    lens = [0.0]
    for a, b in zip(path[:-1], path[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1]

    def at(sv):
        for i in range(len(path) - 1):
            if lens[i] <= sv <= lens[i + 1]:
                t = (sv - lens[i]) / max(lens[i + 1] - lens[i], 1e-9)
                return path[i].lerp(path[i + 1], t)
        return path[-1]

    rows = []
    for j in range(ns + 1):
        row = []
        for i in range(nx):
            x = -FLAP_HW + 2 * FLAP_HW * i / (nx - 1)
            # Arc length at which this column reaches its tip height.
            tip = _flap_tip_z(x)
            s_end = lens[-3] + (0.104 - tip) if tip < 0.104 else lens[-3]
            sv = s_end * j / ns
            q = at(min(sv, total)) if sv <= total else path[-1]
            if sv > total:
                q = Vector((0, path[-1].y, path[-1].z - (sv - total)))
            row.append(Vector((x * (1.0 - 0.06 * (j / ns) ** 3), q.y, q.z)))
        rows.append(row)
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in r] for r in rows]
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(nx - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((0, c.y, c.z - 0.06))) < 0:
            f.normal_flip()
    obj = core.obj_from_bmesh("medkit_flap", bm)
    m = obj.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = 0.0045
    m.offset = 1.0
    m.use_even_offset = True
    core.apply_modifiers(obj)
    return obj


def _medkit_strap(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    shapes.box(bm, (-0.016, BODY[1] - 0.002, 0.008), (0.016, BODY[1] + 0.0035, 0.072))
    # Loop of the strap under the body front edge.
    obj = core.obj_from_bmesh("medkit_strap", bm)
    core.bevel(obj, 0.0015, 2 if detail else 1, 30)
    return obj


def _medkit_buckle(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    y = BODY[1] + 0.0065
    hw, z0, z1 = 0.023, 0.028, 0.054
    rect = [Vector((-hw, y, z0)), Vector((hw, y, z0)), Vector((hw, y, z1)), Vector((-hw, y, z1))]
    pts = []
    for i in range(4):
        a, b = rect[i], rect[(i + 1) % 4]
        for t in (0.0, 0.08, 0.92):
            pts.append(a.lerp(b, t))
    pts.append(pts[0])
    shapes.tube(bm, pts, 0.0028, sides=8 if detail else 5, caps=False)
    shapes.tube(bm, [Vector((0, y + 0.001, z0 + 0.002)), Vector((0, y + 0.004, z1 - 0.004))], 0.0016,
                sides=6 if detail else 4)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return core.obj_from_bmesh("medkit_buckle", bm)


def _leaf(g: Graph, u: S, v: S, L: float = 0.08, W: float = 0.04):
    """Vesica leaf (u across, v along), satin-stitched fill, midrib, stem. Returns (mask, height)."""
    rc = (L * L / 4 + W * W / 4) / W  # circle radius
    c = rc - W / 2
    d1 = g.vmath("LENGTH", g.combine(u - c, v, 0.0))
    d2 = g.vmath("LENGTH", g.combine(u + c, v, 0.0))
    inside = (rc - d1).smooth(0.0, 0.0012) * (rc - d2).smooth(0.0, 0.0012)
    stem = motifs.band(g, u, 0.0014, 0.0006) * (v + L / 2).smooth(0.002, -0.001) * (v + L / 2 + 0.014).smooth(
        -0.001, 0.001)
    mid = motifs.band(g, u, 0.0008, 0.0005) * inside
    satin = g.math("SINE", (u * 0.8 + v * 0.6) * 2600.0) * 0.5 + 0.5
    satin2 = g.math("SINE", (u * -0.8 + v * 0.6) * 2600.0) * 0.5 + 0.5
    side = g.math("GREATER_THAN", u, 0.0)
    fill = g.mixf(side, satin, satin2)
    rim = ((rc - d1).smooth(0.0, 0.0012) * (rc - d2).smooth(0.0, 0.0012)
           - (rc - d1).smooth(0.0022, 0.0034) * (rc - d2).smooth(0.0022, 0.0034)).clamp()
    mask = (inside + stem).clamp()
    height = mask * (fill * 0.5 + 0.5) - mid * 0.6 + rim * 0.3
    return mask, height, rim


def _flap_emblem(g: Graph, p: S):
    x, y, z = g.separate(p)
    a = math.radians(-28)
    u = x * math.cos(a) - (y - 0.004) * math.sin(a)
    v = x * math.sin(a) + (y - 0.004) * math.cos(a)
    m, h, rim = _leaf(g, u, v)
    top = z.smooth(0.1235, 0.125)
    return m * top, h * top, rim * top


def _flap_stitches(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    dash = (g.math("SINE", (x + y + z) * 1150.0) * 0.5 + 0.5).smooth(0.35, 0.55)
    side = motifs.band(g, x.abs() - (FLAP_HW - 0.008), 0.0009, 0.0006)
    tip = z - (x * x * (0.022 / FLAP_HW ** 2) + 0.066 + 0.008)
    bottom = motifs.band(g, tip, 0.0009, 0.0006) * y.smooth(0.095, 0.1)
    return ((side + bottom) * dash).clamp()


def medkit(ctx: Ctx) -> list:
    parts = [_medkit_body(False), _medkit_flap(False), _medkit_strap(False), _medkit_buckle(False)]
    for i, o in enumerate(parts):
        core.mark_part(o, i)
    low = name_mesh(core.join(parts, "medkit"), "medkit")
    body = _medkit_body(True)
    core.remesh(body, 0.0018)
    flap = _medkit_flap(True)
    core.subsurf(flap, 1)
    strap = _medkit_strap(True)
    buckle = _medkit_buckle(True)

    def bulge(g):
        p = g.pos()
        x, y, z = g.separate(p)
        wr = g.noise(g.scale_vec(p, 20.0, 6.0, 20.0), scale=1.0, detail=4.0, w=3.0)
        return (g.noise(p, scale=8.0, detail=3.0, w=1.0) - 0.5) * 0.004 + (wr.smooth(0.55, 0.7)) * -0.0015

    body_hi = high(body, "medkit_body_high", [looks.leather(seed=1.0), looks.canvas(seed=2.0)], disp=bulge,
                   curv_blur=3, keep_base=False)
    # Canvas gussets on the two ends.
    for poly in body_hi.data.polygons:
        poly.material_index = 1 if abs(poly.normal.x) > 0.72 else 0
    flap_hi = high(flap, "medkit_flap_high", looks.leather(emblem=_flap_emblem, stitches=_flap_stitches, seed=4.0),
                   curv_blur=2, keep_base=False)
    strap_hi = high(strap, "medkit_strap_high", looks.leather(seed=5.0), curv_blur=1, keep_base=False)
    buckle_hi = high(buckle, "medkit_buckle_high", looks.brass(seed=6.0), subdiv=1, curv_blur=1, keep_base=False)
    core.smooth_by_angle(low, 50)
    core.uv_smart(low, 55, 0.008, shape="CONCAVE")
    finish(ctx, [BakeSpec("medkit", low, [body_hi, flap_hi, strap_hi, buckle_hi], size=512, cage=0.008,
                          ray=0.02)])
    low.data.attributes.remove(low.data.attributes["part"])
    return [low]


# ---------------------------------------------------------------------------
# Broken amphora
# ---------------------------------------------------------------------------

AMPHORA = [(0.0, 0.0), (0.018, 0.0), (0.026, 0.012), (0.03, 0.04), (0.05, 0.08), (0.09, 0.13), (0.13, 0.2),
           (0.155, 0.27), (0.165, 0.33), (0.16, 0.39), (0.14, 0.44), (0.1, 0.48), (0.066, 0.505), (0.052, 0.53),
           (0.048, 0.58), (0.056, 0.6), (0.06, 0.612), (0.054, 0.62)]
WALL = 0.011


def _profile_r(z: float) -> float:
    for (r0, z0), (r1, z1) in zip(AMPHORA[:-1], AMPHORA[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return AMPHORA[-1][0]


def _refine(profile, n: int):
    out = []
    for (r0, z0), (r1, z1) in zip(profile[:-1], profile[1:]):
        for k in range(n):
            t = k / n
            out.append((r0 + (r1 - r0) * t, z0 + (z1 - z0) * t))
    out.append(profile[-1])
    return out


def _shell(detail: bool, cuts) -> bpy.types.Object:
    """Outer amphora surface cut by planes [(co, normal)], solidified inwards."""
    bm = bmesh.new()
    shapes.lathe(bm, _refine(AMPHORA, 6 if detail else 1), 96 if detail else 20, phase=0.1)
    for co, no in cuts:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no, clear_outer=True)
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y, 0))) < 0 and c.z > 0.01:
            f.normal_flip()
    obj = core.obj_from_bmesh("shell", bm)
    m = obj.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = WALL
    m.offset = -1.0
    m.use_even_offset = True
    m.use_rim = True
    m.use_rim_only = False
    core.apply_modifiers(obj)
    return obj


def _handles(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    for s in (-1, 1):
        pts = []
        for i in range(9):
            t = i / 8
            a = math.pi * t
            # Loop from the neck (z 0.575) out and down to the shoulder (z 0.455).
            r = 0.05 + 0.075 * math.sin(a) ** 0.8 + 0.02 * t
            z = 0.575 - 0.12 * t + 0.035 * math.sin(a)
            pts.append(Vector((s * r, 0.0, z)))
        shapes.tube(bm, pts, 0.011, sides=10 if detail else 6)
    return core.obj_from_bmesh("handles", bm)


def _clay_attrs(obj) -> None:
    """Point attributes from the upright lathe frame: ``inner`` surface, fresh ``brk`` faces, ``paint`` bands."""
    co = core.mesh_coords(obj)
    r = np.hypot(co[:, 0], co[:, 1])
    ro = np.array([_profile_r(z) for z in co[:, 2]])
    depth = ro - r
    inner = np.clip((depth - WALL * 0.55) / (WALL * 0.3), 0, 1)
    brk = np.clip(1 - np.abs(depth - WALL / 2) / (WALL * 0.42), 0, 1) ** 0.6
    outer = np.clip(1 - depth / (WALL * 0.3), 0, 1)
    z = co[:, 2]
    bands = ((np.abs(z - 0.415) < 0.012) | (np.abs(z - 0.382) < 0.004) | (np.abs(z - 0.448) < 0.004))
    wave = np.abs(z - (0.35 + 0.012 * np.sin(np.arctan2(co[:, 1], co[:, 0]) * 9))) < 0.004
    paint = (bands | wave).astype(float) * outer
    far = r > ro + 0.004  # handles: solid clay
    inner[far] = 0.0
    brk[far] = 0.0
    core.write_attr(obj, "inner", inner)
    core.write_attr(obj, "brk", brk)
    core.write_attr(obj, "paint", paint)


PIECES = {
    # name: (plane cuts, include handles, pose (loc x, loc y, yaw, tilt x, tilt y))
    "base": ([((0, 0, 0.36), (0.25, 0.1, 1)), ((0.0, -0.06, 0.3), (-0.3, -1.0, 0.8)),
              ((0.08, 0.05, 0.3), (1.0, 0.6, 0.9))], False, (0.02, 0.0, 20.0, 0.0, 88.0)),
    "neck": ([((0, 0, 0.47), (0.2, -0.15, -1)), ((0.0, 0.04, 0.44), (-0.1, 1.0, -0.6))], True,
             (-0.3, 0.2, -60.0, 90.0, 0.0)),
    "shard1": ([((0, 0, 0.33), (0, 0, -1)), ((0, 0, 0.45), (0.1, 0, 1)), ((0, 0, 0), (1, -0.35, 0)),
                ((0, 0, 0), (-0.55, -1, 0))], False, (0.26, 0.22, 40.0, 0.0, 0.0)),
    "shard2": ([((0, 0, 0.38), (0.2, 0, -1)), ((0, 0, 0.47), (0, 0, 1)), ((0, 0, 0), (-1, 0.5, 0)),
                ((0, 0, 0), (0.7, 1, 0))], False, (0.3, -0.16, 100.0, 0.0, 0.0)),
    "shard3": ([((0, 0, 0.24), (0, 0, -1)), ((0, 0, 0.36), (0.2, 0.1, 1)), ((0, 0, 0), (-0.8, -1, 0)),
                ((0, 0, 0), (1, -0.3, 0))], False, (-0.1, -0.28, 200.0, 0.0, 0.0)),
}


def _outer_up(low) -> Matrix:
    """Rotation laying a shard with its outer (convex, painted) face up."""
    n = Vector((0, 0, 0))
    for p in low.data.polygons:
        c = p.center
        if _profile_r(c.z) - math.hypot(c.x, c.y) < WALL * 0.3:
            n += p.normal * p.area
    return n.normalized().rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()


def _lay(objs, pose, pre: Matrix | None = None) -> None:
    """Rotate pieces to their pose and rest them on the floor (all objects move together)."""
    lx, ly, yaw, tx, ty = pose
    m = Euler((math.radians(tx), math.radians(ty), math.radians(yaw)), "XYZ").to_matrix().to_4x4()
    if pre is not None:
        m = Matrix.Rotation(math.radians(yaw), 4, "Z") @ pre
    for o in objs:
        o.data.transform(m)
    zmin = min(core.mesh_coords(o)[:, 2].min() for o in objs)
    for o in objs:
        o.data.transform(Matrix.Translation((lx, ly, -zmin)))


def pot_broken(ctx: Ctx) -> list:
    lows, highs = [], []
    for name, (cuts, with_handles, pose) in PIECES.items():
        low = _shell(False, cuts)
        hi = _shell(True, cuts)
        if with_handles:
            low = core.join([low, _handles(False)], f"pot_{name}_low")
            hi = core.join([hi, _handles(True)], f"pot_{name}_hi")
        core.remesh(hi, 0.0022)
        _clay_attrs(hi)  # in the upright frame, before posing
        pre = _outer_up(low) if name.startswith("shard") else None
        _lay([low, hi], pose, pre)
        lows.append(low)
        highs.append(hi)

    def disp(g):
        p = g.pos()
        brk = g.attr("brk").smooth(0.2, 0.8)
        return (g.noise(p, scale=90.0, detail=3.0, w=1.0) - 0.5) * 0.0008 + brk * (
            g.noise(p, scale=400.0, detail=2.0, w=2.0) - 0.5) * 0.0012

    hi = core.join(highs, "pot_high")
    core.curvature(hi, "curv0", 2)
    core.displace(hi, disp)
    hi = high(hi, "pot_high", looks.clay(seed=3.0, band=lambda g, p: g.attr("paint")), curv_blur=3,
              keep_base=False)
    low = name_mesh(core.join(lows, "pot_broken"), "pot_broken")
    core.smooth_by_angle(low, 50)
    core.uv_smart(low, 55, 0.006, shape="CONCAVE")
    finish(ctx, [BakeSpec("pot_broken", low, [hi], size=1024, cage=0.005, ray=0.012)])
    return [low]


# ---------------------------------------------------------------------------
# Sand drift: 2 m along X, 0.6 m out from a wall at y = 0 (glTF z = 0 .. +0.6)
# ---------------------------------------------------------------------------

DRIFT_L, DRIFT_D, DRIFT_H = 2.0, 0.6, 0.35


def _periodic(g: Graph, p: S, scale: float):
    """Noise coordinates periodic in X over the drift length (drifts tile end to end)."""
    x, y, z = g.separate(p)
    th = x * (2 * math.pi / DRIFT_L)
    R = scale * DRIFT_L / (2 * math.pi)
    v = g.combine(g.math("COSINE", th) * R, g.math("SINE", th) * R, y * scale)
    return v, z * scale


def _toe(x: float) -> float:
    th = 2 * math.pi * x / DRIFT_L
    return DRIFT_D * (0.9 + 0.05 * math.cos(th + 0.7) + 0.05 * math.cos(2 * th + 2.1))


def _drift_profile(x: float, d: float) -> float:
    """Height at distance d from the wall. Periodic in x so the ends of chained drifts match."""
    th = 2 * math.pi * x / DRIFT_L
    toe = _toe(x)
    top = DRIFT_H * (0.97 + 0.03 * math.cos(th + 1.9)) if abs(abs(x) - DRIFT_L / 2) > 1e-6 else DRIFT_H * (
        0.97 + 0.03 * math.cos(math.pi + 1.9))
    if d >= toe:
        return 0.0
    t = d / toe
    return top * (1 - t) ** 1.55 * (1 + 0.25 * t * (1 - t))


def _drift(nx: int, nd: int) -> bpy.types.Object:
    bm = bmesh.new()
    grid = []
    for j in range(nd + 1):
        row = []
        for i in range(nx + 1):
            x = -DRIFT_L / 2 + DRIFT_L * i / nx
            d = _toe(x) * (j / nd) ** 1.15
            row.append(bm.verts.new((x, -d, _drift_profile(x, d))))
        grid.append(row)
    for j in range(nd):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    # End caps (hidden when drifts are chained, closed when one ends against a side wall).
    for i, sgn in ((0, -1), (nx, 1)):
        col = [grid[j][i] for j in range(nd + 1)]
        base = [bm.verts.new((col[j].co.x, col[j].co.y, 0.0)) for j in range(nd)] + [col[nd]]
        for j in range(nd):
            quad = [base[j], base[j + 1], col[j + 1], col[j]] if j + 1 < nd else [base[j], col[nd], col[j]]
            f = bm.faces.new(quad)
            f.normal_update()
            if f.normal.x * sgn < 0:
                f.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bm.normal_update()
    for f in bm.faces:
        if abs(f.normal.x) < 0.5 and f.normal.z < 0:
            f.normal_flip()
    return core.obj_from_bmesh("sand_drift", bm)


def sand_drift(ctx: Ctx) -> list:
    low = name_mesh(_drift(28, 9), "sand_drift")
    src = _drift(400, 110)

    def disp(g):
        p = g.pos()
        x, y, z = g.separate(p)
        v, w = _periodic(g, p, 5.0)
        n = g.noise(v, scale=1.0, detail=4.0, w=w + 1.0)
        v2, w2 = _periodic(g, p, 1.2)
        n2 = g.noise(v2, scale=1.0, detail=3.0, w=w2 + 2.0)
        phase = y * 90.0 + (n - 0.5) * 9.0 + (n2 - 0.5) * 6.0
        rip = (g.math("SINE", phase) * 0.5 + 0.5) ** 1.6
        amt = z.smooth(0.0, 0.3).lin(0, 1, 1.0, 0.35) * z.smooth(0.0, 0.02)
        return rip * amt * 0.004 + (n2 - 0.5) * 0.01 * z.smooth(0.0, 0.05)

    hi = high(src, "sand_drift_high", looks.sand(periodic=_periodic, seed=1.0), disp=disp, curv_blur=2,
              keep_base=False)
    core.smooth_by_angle(low, 60)
    core.uv_smart(low, 70, 0.004)
    finish(ctx, [BakeSpec("sand_drift", low, [hi], size=1024, cage=0.02, ray=0.05, normal_jpeg=True)])
    return [low]
