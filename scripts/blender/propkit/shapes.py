"""bmesh construction helpers (Blender space: +Z up, metres)."""

from __future__ import annotations

import math
from typing import Callable, Iterable, Optional, Sequence

import bmesh
from mathutils import Matrix, Vector


def box(bm: bmesh.types.BMesh, lo, hi) -> list:
    """Axis-aligned box from ``lo`` to ``hi``; returns its faces."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [bm.verts.new(c) for c in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                   (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
    idx = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return [bm.faces.new([v[i] for i in f]) for f in idx]


def loft(bm: bmesh.types.BMesh, rings: Sequence[Sequence[Vector]], closed: bool = True,
         cap_start: bool = False, cap_end: bool = False) -> list:
    """Bridge consecutive vertex rings (same count) with quads."""
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    faces = []
    n = len(vr[0])
    last = n if closed else n - 1
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(last):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    if cap_start:
        faces.append(bm.faces.new(list(reversed(vr[0]))))
    if cap_end:
        faces.append(bm.faces.new(vr[-1]))
    return faces


def lathe(bm: bmesh.types.BMesh, profile: Sequence[tuple[float, float]], segs: int,
          cap_start: bool = False, cap_end: bool = False, phase: float = 0.0,
          radius_fn: Optional[Callable[[float, float, float], float]] = None) -> list:
    """Surface of revolution around Z from (radius, z) points.

    Profile points with radius 0 collapse into a pole (fan of triangles).
    ``radius_fn(r, z, angle)`` may perturb the radius per vertex.
    """
    rings = []
    for r, z in profile:
        ring = []
        for i in range(segs):
            a = phase + 2 * math.pi * i / segs
            rr = radius_fn(r, z, a) if radius_fn else r
            ring.append(Vector((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)
    faces = loft(bm, rings, True, cap_start, cap_end)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return faces


def tube(bm: bmesh.types.BMesh, pts: Sequence[Vector], radius, sides: int = 8, caps: bool = True,
         twist: float = 0.0) -> list:
    """Tube along a polyline. ``radius`` is a float or a list per point."""
    pts = [Vector(p) for p in pts]
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * len(pts)
    rings = []
    prev_n = None
    for k, p in enumerate(pts):
        if k == 0:
            t = (pts[1] - pts[0]).normalized()
        elif k == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[k + 1] - pts[k]).normalized() + (pts[k] - pts[k - 1]).normalized()).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = n
        b = t.cross(n).normalized()
        ring = []
        for i in range(sides):
            a = twist + 2 * math.pi * i / sides
            ring.append(p + (n * math.cos(a) + b * math.sin(a)) * radii[k])
        rings.append(ring)
    return loft(bm, rings, True, caps, caps)


def square_loops(profile: Sequence[tuple[float, float]]) -> list[list[Vector]]:
    """Square rings (half-width, z) for column dressings; 4 verts each."""
    rings = []
    for hw, z in profile:
        rings.append([Vector((hw, -hw, z)), Vector((hw, hw, z)), Vector((-hw, hw, z)), Vector((-hw, -hw, z))])
    return rings


def to_bm(obj) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    return bm


def from_bm(obj, bm: bmesh.types.BMesh) -> None:
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def transform(bm: bmesh.types.BMesh, m: Matrix, verts=None) -> None:
    bmesh.ops.transform(bm, matrix=m, verts=list(verts) if verts is not None else bm.verts)


def rot_z(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, "Z")
