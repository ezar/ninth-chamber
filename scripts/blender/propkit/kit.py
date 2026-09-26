"""High-poly/low-poly workflow shared by every prop builder."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional, Sequence

import bpy

from . import core
from .core import BakeSpec, Look
from .nodes import Graph, S


@dataclass
class Ctx:
    tex_dir: str
    preview: bool = False  # lookdev: build sources only, no bake
    quick: bool = False  # faster, lower-quality bakes for iteration

    def scale(self, size: int) -> int:
        return max(256, size // 2) if self.quick else size


def high(
    base: bpy.types.Object,
    name: str,
    recipe: Callable[[Graph], Look] | Sequence[Callable[[Graph], Look]],
    *,
    bevel: Optional[tuple] = None,
    voxel: float = 0.0,
    subdiv: int = 0,
    disp: Optional[Callable[[Graph], S]] = None,
    curv0_blur: int = 2,
    curv_blur: int = 3,
    keep_base: bool = True,
) -> bpy.types.Object:
    """Make a detailed bake source from ``base``.

    bevel = (width, segments[, angle]) applied before remeshing; voxel remesh
    gives even density for displacement; ``disp`` offsets along normals and
    can read ``curv0`` (curvature before displacement).
    """
    h = core.copy_obj(base, name) if keep_base else base
    h.name = name
    if bevel:
        w, segs = bevel[0], bevel[1]
        ang = bevel[2] if len(bevel) > 2 else 30.0
        core.bevel(h, w, segs, ang)
    if voxel:
        core.remesh(h, voxel)
    if subdiv:
        core.subsurf(h, subdiv)
    if disp is not None:
        core.curvature(h, "curv0", curv0_blur)
        core.displace(h, disp)
    core.curvature(h, "curv", curv_blur)
    recipes = recipe if isinstance(recipe, (list, tuple)) else [recipe]
    if len(h.data.materials) == 0:
        for i, r in enumerate(recipes):
            h.data.materials.append(core.high_material(f"{name}_m{i}", r))
    else:
        for i, r in enumerate(recipes):
            h.data.materials[i] = core.high_material(f"{name}_m{i}", r)
    h["is_high"] = True
    return h


def finish(ctx: Ctx, specs: Sequence[BakeSpec]) -> None:
    """Bake every texture set, then drop the high-poly sources."""
    if ctx.preview:
        return
    highs = set()
    for s in specs:
        s.size = ctx.scale(s.size)
        if s.orm_size:
            s.orm_size = ctx.scale(s.orm_size)
        if ctx.quick:
            s.samples = max(1, s.samples // 2)
        core.bake(s, ctx.tex_dir)
        highs.update(s.highs)
    core.delete([h for h in highs if h.name in bpy.data.objects])


def name_mesh(obj: bpy.types.Object, name: str) -> bpy.types.Object:
    """Object and mesh datablock share the name the game looks up."""
    obj.name = name
    obj.data.name = name
    return obj
