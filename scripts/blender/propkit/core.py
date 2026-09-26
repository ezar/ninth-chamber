"""Scene, mesh, bake and export helpers for the prop build.

Conventions (Blender side): +Z up, metres, origin at the bottom centre of the
prop. The glTF exporter converts to +Y up. The game's "front" is glTF -Z,
which is Blender +Y; glTF +Z (towards the player for wall-mounted props) is
Blender -Y.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Callable, Iterable, Sequence

import bpy  # noqa: F401  (must precede bmesh when bpy runs as a module)
import bmesh
import numpy as np
from mathutils import Matrix, Vector

from .nodes import Graph, S

# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------


def reset_scene(threads: int = 0) -> bpy.types.Scene:
    BAKED.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    scene.unit_settings.system = "METRIC"
    if threads:
        scene.render.threads_mode = "FIXED"
        scene.render.threads = threads
    return scene


def link(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.scene.collection.objects.link(obj)
    return obj


def obj_from_bmesh(name: str, bm: bmesh.types.BMesh) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def copy_obj(obj: bpy.types.Object, name: str) -> bpy.types.Object:
    me = obj.data.copy()
    me.name = name
    new = bpy.data.objects.new(name, me)
    new.matrix_world = obj.matrix_world.copy()
    return link(new)


def delete(objs: Iterable[bpy.types.Object]) -> None:
    for o in list(objs):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)


def apply_modifiers(obj: bpy.types.Object) -> bpy.types.Object:
    """Bake the modifier stack into the mesh data (no operator context needed)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def bevel(
    obj: bpy.types.Object,
    width: float,
    segments: int = 1,
    angle: float = 30.0,
    profile: float = 0.5,
    clamp: bool = True,
    limit: str = "ANGLE",
    affect: str = "EDGES",
    miter: str = "MITER_ARC",
) -> bpy.types.Object:
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = limit
    m.angle_limit = math.radians(angle)
    m.profile = profile
    m.use_clamp_overlap = clamp
    m.affect = affect
    m.miter_outer = miter
    m.harden_normals = False
    return apply_modifiers(obj)


def remesh(obj: bpy.types.Object, voxel: float) -> bpy.types.Object:
    m = obj.modifiers.new("Remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.adaptivity = 0.0
    m.use_smooth_shade = True
    return apply_modifiers(obj)


def subsurf(obj: bpy.types.Object, levels: int, simple: bool = False) -> bpy.types.Object:
    m = obj.modifiers.new("Subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.subdivision_type = "SIMPLE" if simple else "CATMULL_CLARK"
    m.boundary_smooth = "ALL"
    return apply_modifiers(obj)


def decimate(obj: bpy.types.Object, ratio: float) -> bpy.types.Object:
    m = obj.modifiers.new("Decimate", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = ratio
    m.use_collapse_triangulate = True
    return apply_modifiers(obj)


def decimate_to(obj: bpy.types.Object, tris: int) -> bpy.types.Object:
    cur = tri_count(obj)
    if cur > tris:
        decimate(obj, tris / cur)
    return obj


def weld(obj: bpy.types.Object, dist: float = 1e-4) -> bpy.types.Object:
    m = obj.modifiers.new("Weld", "WELD")
    m.merge_threshold = dist
    return apply_modifiers(obj)


def triangulate(obj: bpy.types.Object) -> bpy.types.Object:
    m = obj.modifiers.new("Tri", "TRIANGULATE")
    m.quad_method = "BEAUTY"
    m.ngon_method = "BEAUTY"
    m.keep_custom_normals = True
    return apply_modifiers(obj)


def tri_count(obj: bpy.types.Object) -> int:
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def join(objs: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    """Join meshes into a new object (materials are merged by slot)."""
    bm = bmesh.new()
    mats: list[bpy.types.Material] = []
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m) if m is not None else 0)
        if remap:
            for p in me.polygons:
                p.material_index = remap[p.material_index] if p.material_index < len(remap) else 0
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    out = obj_from_bmesh(name, bm)
    for m in mats:
        out.data.materials.append(m)
    delete(objs)
    return out


def set_origin_bottom(obj: bpy.types.Object) -> None:
    """Move mesh data so the bounding-box bottom centre is at the origin."""
    co = mesh_coords(obj)
    lo, hi = co.min(0), co.max(0)
    off = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]))
    obj.data.transform(Matrix.Translation(-off))


def mesh_coords(obj: bpy.types.Object) -> np.ndarray:
    me = obj.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def set_mesh_coords(obj: bpy.types.Object, co: np.ndarray) -> None:
    obj.data.vertices.foreach_set("co", co.reshape(-1).astype(np.float64))
    obj.data.update()


def bounds(objs: Sequence[bpy.types.Object]) -> tuple[np.ndarray, np.ndarray]:
    pts = []
    for o in objs:
        co = mesh_coords(o)
        if len(co):
            m = np.array(o.matrix_world)
            pts.append(co @ m[:3, :3].T + m[:3, 3])
    allp = np.concatenate(pts)
    return allp.min(0), allp.max(0)


# ---------------------------------------------------------------------------
# Surface analysis and displacement
# ---------------------------------------------------------------------------


def curvature(obj: bpy.types.Object, name: str = "curv", blur: int = 3) -> np.ndarray:
    """Mean-curvature estimate per vertex (1/m, + convex, - concave).

    Written as a float point attribute so shaders and geometry nodes can read
    it as edge-wear (convex) and crevice (concave) masks.
    """
    me = obj.data
    n = len(me.vertices)
    co = mesh_coords(obj)
    nor = np.empty(n * 3)
    me.vertex_normals.foreach_get("vector", nor)
    nor = nor.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    i, j = e[:, 0], e[:, 1]
    d = co[j] - co[i]
    l2 = (d * d).sum(1) + 1e-12
    ki = -2.0 * (nor[i] * d).sum(1) / l2
    kj = 2.0 * (nor[j] * d).sum(1) / l2
    cnt = np.bincount(i, minlength=n) + np.bincount(j, minlength=n)
    cnt = np.maximum(cnt, 1)
    k = (np.bincount(i, ki, n) + np.bincount(j, kj, n)) / cnt
    for _ in range(blur):
        nb = (np.bincount(i, k[j], n) + np.bincount(j, k[i], n)) / cnt
        k = 0.5 * k + 0.5 * nb
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    a = me.attributes.new(name, "FLOAT", "POINT")
    a.data.foreach_set("value", k.astype(np.float32))
    return k


def write_attr(obj: bpy.types.Object, name: str, values: np.ndarray) -> None:
    me = obj.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    a = me.attributes.new(name, "FLOAT", "POINT")
    a.data.foreach_set("value", values.astype(np.float32))


def displace(obj: bpy.types.Object, fn: Callable[[Graph], S], name: str = "Displace") -> bpy.types.Object:
    """Offset vertices along their normal by a geometry-nodes field (metres)."""
    tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    g = Graph(tree)
    gin = g.node("NodeGroupInput")
    gout = g.node("NodeGroupOutput")
    setp = g.node("GeometryNodeSetPosition")
    amount = fn(g)
    off = g.vmath("SCALE", g.normal(), scale=amount)
    g.links.new(gin.outputs[0], setp.inputs["Geometry"])
    g.feed(setp.inputs["Offset"], off)
    g.links.new(setp.outputs[0], gout.inputs[0])
    m = obj.modifiers.new(name, "NODES")
    m.node_group = tree
    apply_modifiers(obj)
    bpy.data.node_groups.remove(tree)
    return obj


def smooth_by_angle(obj: bpy.types.Object, angle: float = 40.0) -> None:
    """Smooth shading with sharp edges above ``angle`` (baked into the mesh)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < lim
        else:
            e.smooth = True
    bm.to_mesh(me)
    bm.free()


def flat(obj: bpy.types.Object) -> None:
    for p in obj.data.polygons:
        p.use_smooth = False


# ---------------------------------------------------------------------------
# UVs
# ---------------------------------------------------------------------------


def _edit(obj: bpy.types.Object):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for o in bpy.context.scene.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")


def uv_smart(
    obj: bpy.types.Object,
    angle: float = 50.0,
    margin: float = 0.004,
    weights: Callable[[bmesh.types.BMFace], float] | None = None,
    rotate: bool = True,
    shape: str = "AABB",
) -> None:
    """Smart-project, equalise texel density, optionally rescale islands, pack."""
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    _edit(obj)
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    if weights is not None:
        scale_islands(obj, weights)
    pack(obj, margin, rotate, shape)


def pack(obj: bpy.types.Object, margin: float = 0.004, rotate: bool = True, shape: str = "AABB") -> None:
    _edit(obj)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=rotate, rotate_method="CARDINAL" if rotate else "ANY",
                            scale=True, merge_overlap=False, margin_method="FRACTION", margin=margin,
                            shape_method=shape)
    bpy.ops.object.mode_set(mode="OBJECT")
    fill_uv(obj, margin * 0.5)


def fill_uv(obj: bpy.types.Object, margin: float = 0.002) -> None:
    """Stretch the packed layout to fill the unit square (mild anisotropic texels, no waste)."""
    uvl = obj.data.uv_layers.active
    n = len(obj.data.loops)
    uv = np.empty(n * 2)
    uvl.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    lo, hi = uv.min(0), uv.max(0)
    span = np.maximum(hi - lo, 1e-9)
    # Only stretch up to 1.6x per axis so texel density stays reasonable.
    k = np.minimum((1 - 2 * margin) / span, 1.6 * (1 - 2 * margin) / span.max())
    uv = (uv - lo) * k + margin
    uvl.data.foreach_set("uv", uv.reshape(-1))


def uv_islands(bm: bmesh.types.BMesh, uv) -> list[list[bmesh.types.BMFace]]:
    """Group faces into UV islands (faces sharing UV-coincident edges)."""
    faces = list(bm.faces)
    parent = {f.index: f.index for f in faces}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f0, f1 = lf
        ok = True
        for v in e.verts:
            u0 = next(l[uv].uv for l in f0.loops if l.vert == v)
            u1 = next(l[uv].uv for l in f1.loops if l.vert == v)
            if (u0 - u1).length > 1e-5:
                ok = False
                break
        if ok:
            parent[find(f0.index)] = find(f1.index)
    groups: dict[int, list] = {}
    for f in faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def scale_islands(obj: bpy.types.Object, weight: Callable[[bmesh.types.BMFace], float]) -> None:
    """Scale each UV island about its centre by the mean face weight (texel priority)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    for isl in uv_islands(bm, uv):
        w = sum(weight(f) * f.calc_area() for f in isl) / max(sum(f.calc_area() for f in isl), 1e-9)
        if abs(w - 1.0) < 1e-6:
            continue
        loops = [l for f in isl for l in f.loops]
        c = sum((l[uv].uv for l in loops), Vector((0, 0))) / len(loops)
        for l in loops:
            l[uv].uv = c + (l[uv].uv - c) * w
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

CHANNELS = ("base", "rough", "metal", "ao", "emit")


@dataclass
class Look:
    """Channel sockets returned by a material recipe."""

    base: S
    rough: S | float
    metal: S | float = 0.0
    ao: S | float = 1.0
    height: S | None = None
    bump: float = 1.0  # bump strength
    bump_dist: float = 0.004  # metres of height per unit of the height field
    emit: S | None = None


def high_material(name: str, recipe: Callable[[Graph], Look]) -> bpy.types.Material:
    """Principled material plus one emission output per bake channel."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    g = Graph(nt)
    look = recipe(g)
    bsdf = g.node("ShaderNodeBsdfPrincipled")
    g.feed(bsdf.inputs["Base Color"], look.base)
    g.feed(bsdf.inputs["Roughness"], look.rough)
    g.feed(bsdf.inputs["Metallic"], look.metal)
    if look.height is not None:
        bump = g.node("ShaderNodeBump")
        g.feed(bump.inputs["Strength"], look.bump)
        g.feed(bump.inputs["Distance"], look.bump_dist)
        g.feed(bump.inputs["Height"], look.height)
        g.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    out = g.node("ShaderNodeOutputMaterial")
    out.name = "OUT_main"
    g.links.new(bsdf.outputs[0], out.inputs["Surface"])
    # ORM packed in one emission pass: R occlusion, G roughness, B metalness.
    orm = g.node("ShaderNodeCombineColor")
    g.feed(orm.inputs[0], look.ao)
    g.feed(orm.inputs[1], look.rough)
    g.feed(orm.inputs[2], look.metal)
    chans = {"base": look.base, "orm": orm.outputs[0],
             "emit": look.emit if look.emit is not None else "#000000"}
    for ch, val in chans.items():
        em = g.node("ShaderNodeEmission")
        g.feed(em.inputs["Color"], val if not isinstance(val, (int, float)) else (val, val, val))
        em.inputs["Strength"].default_value = 1.0
        o = g.node("ShaderNodeOutputMaterial")
        o.name = "OUT_" + ch
        g.links.new(em.outputs[0], o.inputs["Surface"])
    out.is_active_output = True
    mat["has_emit"] = look.emit is not None
    return mat


def _activate_output(mat: bpy.types.Material, ch: str) -> None:
    nt = mat.node_tree
    nt.nodes["OUT_" + ch].is_active_output = True


def gltf_output_group() -> bpy.types.NodeTree:
    name = "glTF Material Output"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
    grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    grp.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    grp.nodes.new("NodeGroupInput")
    return grp


# ---------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------


@dataclass
class BakeSpec:
    name: str  # texture-set / material name
    low: bpy.types.Object  # target (UV-unwrapped) mesh
    highs: list[bpy.types.Object]  # sources with high_material()s
    size: int = 1024
    cage: float = 0.03
    ray: float = 0.08
    samples: int = 4
    normal: bool = True
    emit: bool = False
    emit_strength: float = 1.0
    jpeg_quality: int = 88
    normal_jpeg: bool = False  # store the normal map as JPEG (size budget)
    orm_size: int | None = None  # ORM resolution when smaller than ``size``
    png_limit: int = 320_000  # data maps above this many bytes as PNG fall back to JPEG
    albedo: str | None = None  # calibrate the mean base colour to this sRGB hex (palette target)
    extra: dict = field(default_factory=dict)


def _new_image(name: str, size: int, data: bool) -> bpy.types.Image:
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return img


def _pixels(img: bpy.types.Image) -> np.ndarray:
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _resize(arr: np.ndarray, size: int) -> np.ndarray:
    """Box downsample (power-of-two factors)."""
    h = arr.shape[0]
    if h == size:
        return arr
    f = h // size
    return arr.reshape(size, f, size, f, -1).mean((1, 3))


def _save(arr: np.ndarray, path: str, fmt: str, data: bool, quality: int = 90) -> bpy.types.Image:
    """Encode with Pillow (4:4:4 JPEG, optimised PNG) and load it back as a file image.

    Loading the encoded file lets the glTF exporter embed these exact bytes.
    """
    from PIL import Image

    name = os.path.basename(path)
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    rgb = np.clip(arr[::-1, :, :3] * 255.0 + 0.5, 0, 255).astype(np.uint8)  # Blender rows are bottom-up
    im = Image.fromarray(rgb, "RGB")
    if fmt == "JPEG":
        im.save(path, "JPEG", quality=quality, subsampling=0, optimize=True)
    else:
        im.save(path, "PNG", optimize=True)
    out = bpy.data.images.load(path, check_existing=False)
    out.name = name
    out.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return out


def _encode_auto(arr: np.ndarray, base_path: str, data: bool, png_limit: int, quality: int) -> bpy.types.Image:
    """Lossless PNG when it stays under ``png_limit`` bytes, otherwise 4:4:4 JPEG."""
    import io

    from PIL import Image

    rgb = np.clip(arr[::-1, :, :3] * 255.0 + 0.5, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "PNG", optimize=True)
    if buf.tell() <= png_limit:
        return _save(arr, base_path + ".png", "PNG", data)
    return _save(arr, base_path + ".jpg", "JPEG", data, quality)


def _blur_r(orm: np.ndarray) -> np.ndarray:
    """Soften bake noise in the occlusion channel (3x3 box)."""
    r = orm[..., 0]
    p = np.pad(r, 1, mode="edge")
    acc = sum(p[1 + dy : 1 + dy + r.shape[0], 1 + dx : 1 + dx + r.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    out = orm.copy()
    out[..., 0] = acc / 9.0
    return out


def calibrate_albedo(base: np.ndarray, target: str) -> np.ndarray:
    """Scale each channel so the mean albedo of the baked texels matches ``target``.

    Keeps all the procedural variation while pinning the overall colour to the
    art-direction palette; non-metal albedo is kept inside sRGB 40..235.
    """
    rgb = base[..., :3]
    covered = rgb.sum(-1) > 1e-4
    mean = rgb[covered].mean(0)
    t = np.array([int(target.lstrip("#")[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])
    out = base.copy()
    out[..., :3] = np.where(covered[..., None], np.clip(rgb * (t / np.maximum(mean, 1e-4)), 40 / 255, 235 / 255),
                            rgb)
    return out


def triangulate_ngons(obj: bpy.types.Object) -> None:
    """Tangents (bake and export) need tris/quads."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    ng = [f for f in bm.faces if len(f.verts) > 4]
    if ng:
        bmesh.ops.triangulate(bm, faces=ng, quad_method="BEAUTY", ngon_method="BEAUTY")
        bm.to_mesh(obj.data)
    bm.free()


def bake(spec: BakeSpec, tex_dir: str) -> bpy.types.Material:
    """Bake all channels from ``spec.highs`` onto ``spec.low`` and give it a glTF material."""
    scene = bpy.context.scene
    scene.cycles.samples = spec.samples
    bk = scene.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = spec.cage
    bk.max_ray_distance = spec.ray
    bk.margin = max(4, spec.size // 64)
    bk.margin_type = "EXTEND"
    bk.use_clear = True
    bk.target = "IMAGE_TEXTURES"
    bk.normal_space = "TANGENT"

    low = spec.low
    triangulate_ngons(low)
    low.data.materials.clear()
    tmp = bpy.data.materials.new(spec.name + "_bake")
    tmp.use_nodes = True
    tnode = tmp.node_tree.nodes.new("ShaderNodeTexImage")
    tmp.node_tree.nodes.active = tnode
    low.data.materials.append(tmp)

    mats = {m for h in spec.highs for m in h.data.materials if m is not None}

    for o in bpy.context.scene.objects:
        o.select_set(False)
    for h in spec.highs:
        h.hide_render = False
        h.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low

    chans = ["base", "orm"] + (["emit"] if spec.emit else [])
    res: dict[str, np.ndarray] = {}
    for ch in chans:
        img = _new_image(f"{spec.name}_{ch}", spec.size, ch == "orm")
        tnode.image = img
        for m in mats:
            _activate_output(m, ch)
        scene.cycles.samples = spec.samples * (3 if ch == "orm" else 1)
        bpy.ops.object.bake(type="EMIT")
        res[ch] = _pixels(img)
        bpy.data.images.remove(img)
    for m in mats:
        _activate_output(m, "main")
    if spec.normal:
        img = _new_image(f"{spec.name}_nrm", spec.size, True)
        tnode.image = img
        scene.cycles.samples = spec.samples
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
        res["normal"] = _pixels(img)
        bpy.data.images.remove(img)

    if spec.albedo:
        res["base"] = calibrate_albedo(res["base"], spec.albedo)
    os.makedirs(tex_dir, exist_ok=True)
    stem = os.path.join(tex_dir, spec.name)
    base_img = _save(res["base"], stem + "_basecolor.jpg", "JPEG", False, spec.jpeg_quality)
    orm = _blur_r(res["orm"][..., :3])
    if spec.orm_size:
        orm = _resize(orm, spec.orm_size)
    orm_img = _encode_auto(orm, stem + "_orm", True, spec.png_limit, 95)
    nrm_img = None
    if spec.normal:
        limit = 0 if spec.normal_jpeg else spec.png_limit
        nrm_img = _encode_auto(res["normal"], stem + "_normal", True, limit, 94)
    emit_img = None
    if spec.emit:
        emit_img = _save(res["emit"], stem + "_emissive.jpg", "JPEG", False, spec.jpeg_quality)

    low.data.materials.clear()
    bpy.data.materials.remove(tmp)
    mat = final_material(spec.name, base_img, orm_img, nrm_img, emit_img, spec.emit_strength)
    low.data.materials.append(mat)
    BAKED.append((spec, {"base": res["base"], "orm": orm, "normal": res.get("normal"), "emit": res.get("emit")},
                  mat, stem))
    return mat


# Baked texture sets of the prop being built: (spec, arrays, material, file stem).
BAKED: list = []


def reencode(level: int) -> None:
    """Re-encode the current prop's maps at a lower quality (size budget), level 1, 2, 3..."""
    for spec, arr, mat, stem in BAKED:
        nodes = mat.node_tree.nodes
        qn = max(72, 92 - 6 * level)
        qo = max(72, 93 - 6 * level)
        qb = max(75, spec.jpeg_quality - 3 * level)
        orm = arr["orm"]
        if level >= 2 and orm.shape[0] > 256:
            orm = _resize(orm, orm.shape[0] // 2)
        base = arr["base"]
        if level >= 4 and base.shape[0] > 512:
            base = _resize(base, base.shape[0] // 2)
        nodes["TEX_base"].image = _save(base, f"{stem}_basecolor.jpg", "JPEG", False, qb)
        nodes["TEX_orm"].image = _save(orm, f"{stem}_orm.jpg", "JPEG", True, qo)
        if arr["normal"] is not None:
            nodes["TEX_normal"].image = _save(arr["normal"], f"{stem}_normal.jpg", "JPEG", True, qn)
        if arr["emit"] is not None:
            nodes["TEX_emit"].image = _save(arr["emit"], f"{stem}_emissive.jpg", "JPEG", False, qb)


def final_material(name, base_img, orm_img, nrm_img, emit_img=None, emit_strength=1.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True  # exported as doubleSided: false
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.name = "TEX_base"
    tb.image = base_img
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    to = nt.nodes.new("ShaderNodeTexImage")
    to.name = "TEX_orm"
    to.image = orm_img
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    if nrm_img is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.name = "TEX_normal"
        tn.image = nrm_img
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    if emit_img is not None:
        te = nt.nodes.new("ShaderNodeTexImage")
        te.name = "TEX_emit"
        te.image = emit_img
        nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return mat


# ---------------------------------------------------------------------------
# Export and inspection
# ---------------------------------------------------------------------------


def export_glb(objs: Sequence[bpy.types.Object], path: str) -> None:
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_attributes=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_draco_mesh_compression_enable=False,
        export_copyright="CC0 1.0 - The Ninth Chamber, generated by scripts/blender/build_props.py",
    )


# ---------------------------------------------------------------------------
# Parts (several exported objects sharing one texture set)
# ---------------------------------------------------------------------------


def mark_part(obj: bpy.types.Object, part: int) -> None:
    me = obj.data
    a = me.attributes.get("part") or me.attributes.new("part", "INT", "FACE")
    a.data.foreach_set("value", np.full(len(me.polygons), part, dtype=np.int32))


def split_parts(obj: bpy.types.Object, names: dict[int, str]) -> dict[str, bpy.types.Object]:
    """Split a joined mesh back into objects by its ``part`` face attribute."""
    out = {}
    vals = np.empty(len(obj.data.polygons), dtype=np.int32)
    obj.data.attributes["part"].data.foreach_get("value", vals)
    for pid, name in names.items():
        o = copy_obj(obj, name)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        kill = [bm.faces[i] for i in np.nonzero(vals != pid)[0]]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        o.data.attributes.remove(o.data.attributes["part"])
        o.data.name = name
        out[name] = o
    delete([obj])
    return out


def set_origin(obj: bpy.types.Object, pivot) -> None:
    """Put the object origin at ``pivot`` (world) without moving the geometry."""
    pv = Vector(pivot)
    obj.data.transform(Matrix.Translation(-pv))
    obj.location = pv
