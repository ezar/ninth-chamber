"""Bronze and gold props: brazier, lever, relic (Amber Heart)."""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector

from . import core, looks, motifs, shapes
from .core import BakeSpec
from .kit import Ctx, finish, high, name_mesh
from .nodes import Graph, S

# ---------------------------------------------------------------------------
# Brazier: tripod, bowl rim at 1.15 m, bowl 0.9 m across, coals on top
# ---------------------------------------------------------------------------

RIM_Z = 1.15
BOWL_OUTER = [(0.0, 0.9), (0.1, 0.9), (0.13, 0.905), (0.16, 0.925), (0.24, 0.945), (0.32, 0.975), (0.38, 1.01),
              (0.42, 1.05), (0.44, 1.07), (0.437, 1.078), (0.44, 1.09), (0.448, 1.11), (0.466, 1.12),
              (0.474, 1.132), (0.47, 1.145), (0.458, RIM_Z)]
BOWL_INNER = [(0.43, RIM_Z), (0.422, 1.14), (0.41, 1.11), (0.38, 1.065), (0.31, 1.02), (0.2, 0.985),
              (0.1, 0.97), (0.0, 0.967)]
LEG_ANGLES = (90.0, 210.0, 330.0)
BRACE_Z = 0.3
LEG_PROFILE = [(0.2, 0.95), (0.24, 0.88), (0.285, 0.72), (0.33, 0.54), (0.37, 0.36), (0.4, 0.2), (0.415, 0.1),
               (0.42, 0.06)]


def _leg_path(a_deg: float) -> list[Vector]:
    a = math.radians(a_deg)
    d = Vector((math.cos(a), math.sin(a), 0))
    return [d * r + Vector((0, 0, z)) for r, z in LEG_PROFILE]


def _brace_radius() -> float:
    for (r0, z0), (r1, z1) in zip(LEG_PROFILE[:-1], LEG_PROFILE[1:]):
        if z1 <= BRACE_Z <= z0:
            t = (z0 - BRACE_Z) / (z0 - z1)
            return r0 + (r1 - r0) * t
    return 0.38


def _brazier_body(detail: bool) -> bpy.types.Object:
    segs = 48 if detail else 30
    sides = 12 if detail else 8
    bm = bmesh.new()
    shapes.lathe(bm, BOWL_OUTER + BOWL_INNER, segs)
    # Heavy foot ring under the bowl where the legs are fixed.
    ring = [(0.15, 0.93), (0.235, 0.935), (0.24, 0.905), (0.232, 0.885), (0.15, 0.885)]
    shapes.lathe(bm, ring + [ring[0]], segs)
    for a in LEG_ANGLES:
        path = _leg_path(a)
        rad = [0.036, 0.034, 0.031, 0.029, 0.028, 0.029, 0.031, 0.034]
        shapes.tube(bm, path, rad, sides=sides)
        # Two collars (knuckles) along the leg.
        for k in (3, 5):
            mid = path[k]
            t = (path[k + 1] - path[k - 1]).normalized()
            shapes.tube(bm, [mid - t * 0.03, mid - t * 0.02, mid + t * 0.02, mid + t * 0.03],
                        [0.03, 0.042, 0.042, 0.03], sides=sides)
        # Paw-like foot.
        fz = Vector((path[-1].x, path[-1].y, 0.0))
        foot = [(0.0, 0.0), (0.058, 0.0), (0.066, 0.014), (0.06, 0.032), (0.046, 0.05), (0.036, 0.066),
                (0.0, 0.07)]
        before = set(bm.verts)
        shapes.lathe(bm, foot, 14 if detail else 9, phase=math.radians(a))
        new = [v for v in bm.verts if v not in before]
        bmesh.ops.translate(bm, verts=new, vec=fz)
        # Tab bolting the leg to the foot ring.
        top = path[0]
        shapes.tube(bm, [top + Vector((0, 0, -0.035)), top + Vector((0, 0, 0.0))], [0.04, 0.04], sides=sides)
    rb = _brace_radius()
    loop = [Vector((rb * math.cos(2 * math.pi * i / 42), rb * math.sin(2 * math.pi * i / 42), BRACE_Z))
            for i in range(43)]
    shapes.tube(bm, loop, 0.016, sides=8 if detail else 6, caps=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return core.obj_from_bmesh("brazier", bm)


def _coals_mesh(detail: bool) -> bpy.types.Object:
    rings = 14 if detail else 5
    segs = 64 if detail else 22
    prof = []
    for i in range(rings + 1):
        r = 0.408 * i / rings
        z = 1.118 - 0.018 * (r / 0.408) ** 2 + 0.012 * (1 - (r / 0.408) ** 2)
        prof.append((r, z))
    bm = bmesh.new()
    shapes.lathe(bm, list(reversed(prof)), segs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return core.obj_from_bmesh("coals", bm)


def _brazier_soot(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    r = g.vmath("LENGTH", g.combine(x, y, 0.0))
    n = g.normal()
    nx, ny, nz = g.separate(n)
    radial = (nx * x + ny * y) / (r + 1e-4)
    inner = radial.smooth(0.05, -0.2) * z.smooth(0.97, 1.0) * r.smooth(0.1, 0.2)
    streak = g.noise(g.scale_vec(p, 12.0, 12.0, 1.5), scale=1.0, detail=4.0, w=51.0)
    outer = z.smooth(1.0, 1.14) * (streak.smooth(0.35, 0.65) * 0.6 + 0.25) * radial.smooth(-0.1, 0.2)
    under = z.smooth(0.9, 0.97) * z.smooth(1.02, 0.98) * 0.4
    return (inner * 0.95 + outer * 0.7 + under).clamp()


def _brazier_touch(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    rim = z.smooth(1.125, 1.145)
    feet = z.smooth(0.03, 0.005)
    coll = (z - 0.54).abs().smooth(0.03, 0.012) + (z - 0.2).abs().smooth(0.03, 0.012)
    return (rim * 0.9 + feet * 0.8 + coll * 0.7).clamp()


def _brazier_carve(g: Graph, p: S) -> S:
    """A band of nine small bosses just under the rim (drawn as a raised relief)."""
    x, y, z = g.separate(p)
    ang = g.math("ARCTAN2", y, x)
    t = ang * (9 / (2 * math.pi))
    f = g.math("FRACT", t) - 0.5
    r = g.vmath("LENGTH", g.combine(x, y, 0.0))
    d = g.vmath("LENGTH", g.combine(f * (2 * math.pi / 9) * r, (z - 1.1), 0.0))
    boss = d.smooth(0.016, 0.009)
    ring = motifs.band(g, d - 0.021, 0.0025, 0.0015)
    band = motifs.band(g, z - 1.1, 0.012, 0.004) * r.smooth(0.43, 0.445)
    return ring * band * 0.8 - boss * band  # negative = raised bosses


def brazier(ctx: Ctx) -> list:
    body = name_mesh(_brazier_body(False), "brazier")
    coals = name_mesh(_coals_mesh(False), "coals")
    src = _brazier_body(True)

    def disp(g):
        p = g.pos()
        return (g.noise(p, scale=20.0, detail=4.0, w=5.0) - 0.5) * 0.0015

    hi = high(src, "brazier_high", looks.bronze(touch=_brazier_touch, soot=_brazier_soot, carve=_brazier_carve,
                                                  seed=1.0, edge_lo=70.0, edge_hi=220.0),
              subdiv=2, disp=disp, curv_blur=2, keep_base=False)
    csrc = _coals_mesh(True)

    def cdisp(g):
        p = g.pos()
        f1 = g.voronoi(p, scale=16.0, feature="F1", w=0.0)
        f2 = g.voronoi(p, scale=16.0, feature="F2", w=0.0)
        lump = (f2 - f1).smooth(0.0, 0.35) * 0.028
        return lump + (g.noise(p, scale=30.0, detail=4.0, w=2.0) - 0.5) * 0.006

    core.subsurf(csrc, 2, simple=True)
    chi = high(csrc, "coals_high", looks.coals(), disp=cdisp, curv_blur=2, keep_base=False)
    for o in (body, coals):
        core.smooth_by_angle(o, 50)
    core.uv_smart(body, 55, 0.004, shape="CONCAVE")
    core.uv_smart(coals, 70, 0.01)
    finish(ctx, [BakeSpec("brazier", body, [hi], size=1024, cage=0.02, ray=0.05),
                 BakeSpec("coals", coals, [chi], size=512, cage=0.04, ray=0.08, emit=True)])
    return [body, coals]


# ---------------------------------------------------------------------------
# Lever: wall plate (back at y=0, protruding to -Y = glTF +Z) and a handle
# ---------------------------------------------------------------------------

PIVOT = Vector((0.0, -0.055, 0.25))
HANDLE_LEN = 0.55


def _lever_plate(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    shapes.box(bm, (-0.2, -0.03, 0.0), (0.2, 0.0, 0.5))
    shapes.box(bm, (-0.1, -0.08, 0.08), (0.1, -0.03, 0.42))
    for sx in (-0.155, 0.155):
        for sz in (0.045, 0.455):
            before = set(bm.verts)
            prof = [(0.016, 0.0), (0.015, 0.004), (0.011, 0.009), (0.0, 0.011)]
            shapes.lathe(bm, prof, 10 if detail else 7)
            new = [v for v in bm.verts if v not in before]
            bmesh.ops.rotate(bm, verts=new, cent=(0, 0, 0), matrix=core.Matrix.Rotation(math.radians(90), 3, "X"))
            bmesh.ops.translate(bm, verts=new, vec=(sx, -0.029, sz))
    bm.normal_update()
    obj = core.obj_from_bmesh("lever_plate", bm)
    # Vertical slot in the housing for the handle.
    from .props_stone import _recess

    planes = [((0.018, 0, 0), (1, 0, 0)), ((-0.018, 0, 0), (1, 0, 0)), ((0, 0, 0.12), (0, 0, 1)),
              ((0, 0, 0.38), (0, 0, 1))]

    def pick(f):
        c = f.calc_center_median()
        return f.normal.y < -0.9 and abs(c.y + 0.08) < 1e-4 and abs(c.x) < 0.018 and 0.12 < c.z < 0.38

    _recess(obj, planes, pick, 0.045)
    # The back face sits against the wall and is never seen.
    bm = shapes.to_bm(obj)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.y > 0.9 and abs(f.calc_center_median().y) < 1e-4],
                     context="FACES")
    shapes.from_bm(obj, bm)
    return obj


def _lever_handle(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    sides = 12 if detail else 8
    p = PIVOT
    # Hub (axle boss) across X, inside the slot.
    shapes.tube(bm, [p + Vector((-0.017, 0, 0)), p + Vector((0.017, 0, 0))], 0.03, sides=sides + 4)
    # Rod out along -Y with a grip section of wrapped bands.
    fwd = Vector((0, -1, 0))
    pts = [p + fwd * d for d in (0.0, 0.06, 0.12, 0.3, 0.36, 0.44, 0.49)]
    rad = [0.02, 0.017, 0.015, 0.015, 0.017, 0.017, 0.015]
    shapes.tube(bm, pts, rad, sides=sides)
    for d0 in (0.365, 0.395, 0.425):
        shapes.tube(bm, [p + fwd * (d0 - 0.006), p + fwd * d0, p + fwd * (d0 + 0.006)], [0.017, 0.0195, 0.017],
                    sides=sides)
    # Knob at the end: 0.55 m from the pivot.
    before = set(bm.verts)
    knob = [(0.0, 0.0), (0.016, 0.0), (0.03, 0.012), (0.036, 0.03), (0.032, 0.048), (0.02, 0.058), (0.0, 0.06)]
    shapes.lathe(bm, knob, sides + 2)
    new = [v for v in bm.verts if v not in before]
    bmesh.ops.rotate(bm, verts=new, cent=(0, 0, 0), matrix=core.Matrix.Rotation(math.radians(90), 3, "X"))
    bmesh.ops.translate(bm, verts=new, vec=p + fwd * (HANDLE_LEN - 0.06))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return core.obj_from_bmesh("handle", bm)


def _lever_touch(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    along = (y * -1.0) - 0.055
    grip = along.smooth(0.3, 0.38) * g.math("GREATER_THAN", along, 0.05)
    slot = (x.abs().smooth(0.05, 0.02) * z.smooth(0.1, 0.13) * z.smooth(0.4, 0.37) * y.smooth(-0.07, -0.085))
    return (grip + slot * 0.7).clamp()


def _lever_carve(g: Graph, p: S) -> S:
    x, y, z = g.separate(p)
    front = y.smooth(-0.075, -0.079)
    ticks = (motifs.band(g, z - 0.14, 0.003, 0.002) + motifs.band(g, z - 0.36, 0.003, 0.002)) * (
        x.abs() - 0.045).abs().smooth(0.02, 0.015)
    border = motifs.band(g, x.abs() - 0.185, 0.0025, 0.0015) * z.smooth(0.012, 0.016) * z.smooth(0.488, 0.484) + (
        motifs.band(g, z - 0.015, 0.0025, 0.0015) + motifs.band(g, z - 0.485, 0.0025, 0.0015)) * (
        0.186 - x.abs()).smooth(0.0, 0.002)
    plate_front = y.smooth(-0.027, -0.03)
    seal = motifs.seal(g, x, z - 0.4, 0.035, groove=0.003, soft=0.0015, ninth="outline") * front
    return (ticks * front + border * plate_front + seal).clamp()


def lever(ctx: Ctx) -> list:
    plate = _lever_plate(False)
    handle = _lever_handle(False)
    core.mark_part(plate, 0)
    core.mark_part(handle, 1)
    low = core.join([plate, handle], "lever_low")
    hp = _lever_plate(True)
    hh = _lever_handle(True)

    def disp(g):
        return (g.noise(g.pos(), scale=40.0, detail=4.0, w=7.0) - 0.5) * 0.0006

    look = looks.bronze(touch=_lever_touch, carve=_lever_carve, seed=3.0, edge_lo=90.0, edge_hi=300.0, ao_dist=0.04)
    core.bevel(hp, 0.004, 3, 30)
    hi_p = high(hp, "lever_plate_high", look, voxel=0.0015, disp=disp, curv_blur=3, keep_base=False)
    hi_h = high(hh, "handle_high", look, subdiv=2, disp=disp, curv_blur=2, keep_base=False)
    core.bevel(low, 0.004, 1, 40)
    core.smooth_by_angle(low, 45)
    core.uv_smart(low, 55, 0.006, shape="CONCAVE")
    finish(ctx, [BakeSpec("lever", low, [hi_p, hi_h], size=1024, cage=0.006, ray=0.015)])
    parts = core.split_parts(low, {0: "lever_plate", 1: "handle"})
    h = parts["handle"]
    core.set_origin(h, PIVOT)
    return [parts["lever_plate"], h]


# ---------------------------------------------------------------------------
# Relic: the Amber Heart (nine-facet gem in a thin gold cage), 0.22 m tall
# ---------------------------------------------------------------------------

GEM_TIERS = [  # (radius, z, angular phase in segments)
    (0.0, 0.036, 0.0),
    (0.036, 0.062, 0.5),
    (0.058, 0.108, 0.0),
    (0.058, 0.12, 0.0),
    (0.047, 0.158, 0.5),
    (0.028, 0.184, 0.0),
    (0.0, 0.186, 0.0),
]


def _gem_point(r, z, k, phase):
    a = 2 * math.pi * (k + phase) / 9 + math.pi / 2
    return Vector((r * math.cos(a), r * math.sin(a), z))


def _gem_radius(z: float) -> float:
    """Distance from the axis to the gem surface along a girdle-vertex direction."""
    prof = [(r if ph == 0.0 else r * math.cos(math.pi / 9), zz) for r, zz, ph in GEM_TIERS]
    for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return 0.0


def _gem() -> bpy.types.Object:
    bm = bmesh.new()
    rings = [[_gem_point(r, z, k, ph) for k in range(9)] for r, z, ph in GEM_TIERS]
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(9):
            j = (i + 1) % 9
            quad = [a[i], a[j], b[j], b[i]]
            uniq = []
            for v in quad:
                if all((v.co - u.co).length > 1e-7 for u in uniq):
                    uniq.append(v)
            if len(uniq) >= 3:
                try:
                    bm.faces.new(uniq)
                except ValueError:
                    pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = core.obj_from_bmesh("gem", bm)
    core.flat(obj)
    return obj


def _cage(detail: bool) -> bpy.types.Object:
    bm = bmesh.new()
    sides = 6 if detail else 5
    wire = 0.0026
    # Foot and bezel cup.
    foot = [(0.0, 0.0), (0.046, 0.0), (0.048, 0.006), (0.042, 0.012), (0.024, 0.02), (0.016, 0.03),
            (0.022, 0.042), (0.03, 0.05), (0.026, 0.052), (0.014, 0.044), (0.0, 0.04)]
    shapes.lathe(bm, foot, 27 if detail else 18, phase=math.pi / 2)
    for k in range(9):
        pts = []
        for z in (0.05, 0.062, 0.078, 0.094, 0.108, 0.12, 0.14, 0.158, 0.172, 0.184):
            pts.append(_gem_point(_gem_radius(z) + wire + 0.0006, z, k, 0.0))
        shapes.tube(bm, pts, wire, sides=sides)
    girdle = [_gem_point(0.058 + wire * 1.3 + 0.0006, 0.114, i / 5, 0.0) for i in range(46)]
    shapes.tube(bm, girdle, wire * 1.3, sides=sides, caps=False)
    top = [_gem_point(0.028 + wire + 0.0006, 0.186, i / 3, 0.0) for i in range(28)]
    shapes.tube(bm, top, wire * 1.1, sides=sides, caps=False)
    # Finial loop on top (reaches 0.22 m).
    loop = [Vector((0.0, 0.011 * math.sin(2 * math.pi * i / 16), 0.2045 + 0.0125 * math.cos(2 * math.pi * i / 16)))
            for i in range(17)]
    shapes.tube(bm, loop, wire, sides=sides, caps=False)
    shapes.tube(bm, [Vector((0, 0, 0.186)), Vector((0, 0, 0.1935))], [0.006, 0.0045], sides=sides + 2)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return core.obj_from_bmesh("relic", bm)


def relic(ctx: Ctx) -> list:
    cage = name_mesh(_cage(False), "relic")
    gem = name_mesh(_gem(), "gem")
    csrc = _cage(True)
    hi = high(csrc, "relic_high", looks.gold(seed=2.0, ao_dist=0.02, bump_dist=0.00015), subdiv=1, curv_blur=2,
              keep_base=False)
    gsrc = core.copy_obj(gem, "gem_src")
    ghi = high(gsrc, "gem_high", looks.amber_gem(seed=4.0), curv_blur=0, keep_base=False)
    core.smooth_by_angle(cage, 60)
    core.uv_smart(cage, 60, 0.006, shape="CONCAVE")
    core.uv_smart(gem, 30, 0.01)
    finish(ctx, [BakeSpec("relic", cage, [hi], size=512, cage=0.002, ray=0.006),
                 BakeSpec("gem", gem, [ghi], size=512, cage=0.002, ray=0.005, normal=False, emit=True)])
    return [cage, gem]
