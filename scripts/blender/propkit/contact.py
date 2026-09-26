"""Re-import exported GLBs into a clean scene and render a lit contact sheet.

Warm key (fire) + cool fill (overhead daylight) + rim, on a dark umber floor,
rendered with Cycles and OpenImageDenoise. One tile per prop, then tiled into
a single PNG with labels (Pillow).
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

import bpy
import numpy as np
from mathutils import Vector

from . import core
from .nodes import hex_rgb


@dataclass
class View:
    azimuth: float = 35.0  # degrees, 0 = looking at the front (Blender +Y side)
    elevation: float = 18.0
    front: float = 1.0  # +1: front faces Blender +Y (glTF -Z); -1: front faces Blender -Y
    zoom: float = 1.0
    target_z: float | None = None


def _world(strength: float = 0.25) -> None:
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    c = hex_rgb("#1a1511")
    bg.inputs["Color"].default_value = (c[0], c[1], c[2], 1.0)
    bg.inputs["Strength"].default_value = strength


def _floor(size: float) -> None:
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    ob = core.obj_from_bmesh("floor", bm)
    m = bpy.data.materials.new("floor")
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    c = hex_rgb("#3a2c20")
    p.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
    p.inputs["Roughness"].default_value = 0.9
    ob.data.materials.append(m)


def _area(name, color, energy, loc, target, size):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    c = hex_rgb(color)
    ld.color = c
    ob = bpy.data.objects.new(name, ld)
    core.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def render_tile(glb: str, out_png: str, view: View, res: int = 640, samples: int = 64) -> dict:
    """Import one GLB into a clean scene and render it."""
    scene = core.reset_scene()
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = [o for o in scene.objects if o.type == "MESH"]
    return stage_and_render(meshes, out_png, view, res, samples)


def stage_and_render(meshes, out_png: str, view: View, res: int = 640, samples: int = 64) -> dict:
    """Frame ``meshes`` in the current scene with the standard lights and render."""
    scene = bpy.context.scene
    lo, hi = core.bounds(meshes)
    size = hi - lo
    center = (lo + hi) / 2
    radius = float(np.linalg.norm(size) / 2)
    tz = view.target_z if view.target_z is not None else center[2]
    target = Vector((center[0], center[1], tz))

    _world()
    _floor(max(40.0, radius * 20))

    az = math.radians(view.azimuth)
    el = math.radians(view.elevation)
    fwd = Vector((math.sin(az) * -1.0, math.cos(az), 0)) * view.front  # towards the camera
    cam_dir = Vector((fwd.x * math.cos(el), fwd.y * math.cos(el), math.sin(el)))
    cd = bpy.data.cameras.new("cam")
    cd.lens = 70
    cd.sensor_width = 36
    cam = bpy.data.objects.new("cam", cd)
    core.link(cam)
    fov = 2 * math.atan(18 / cd.lens)
    dist = radius / math.sin(fov / 2) * 1.02 / view.zoom
    cam.location = target + cam_dir * dist
    cam.rotation_euler = (-cam_dir).to_track_quat("-Z", "Y").to_euler()
    cd.clip_start = dist * 0.01
    cd.clip_end = dist * 10
    scene.camera = cam

    # Lights scale with the prop so every tile reads the same.
    s = max(radius, 0.12)
    key_dir = Vector((math.sin(az + 0.9) * -1, math.cos(az + 0.9), 0.0)) * view.front
    key_loc = target + (key_dir * 1.6 + Vector((0, 0, 1.0))) * s * 3
    _area("key", "#ffdcb8", 760 * s * s, key_loc, target, s * 1.6)
    fill_dir = Vector((math.sin(az - 1.2) * -1, math.cos(az - 1.2), 0)) * view.front
    fill_loc = target + (fill_dir * 1.5 + Vector((0, 0, 1.9))) * s * 3
    _area("fill", "#a9bccb", 480 * s * s, fill_loc, target, s * 3)
    rim_loc = target + (-fwd * 1.4 + Vector((0, 0, 1.2))) * s * 3
    _area("rim", "#ffe2c0", 420 * s * s, rim_loc, target, s * 1.2)

    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Base Contrast"
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    return {"size": size.tolist()}


def sheet(tiles: list[tuple[str, str]], out_png: str, cols: int = 5, cell: int = 400) -> None:
    """Tile rendered PNGs (path, label) into one labelled contact sheet."""
    from PIL import Image, ImageDraw, ImageFont

    rows = (len(tiles) + cols - 1) // cols
    pad = 34
    W, H = cols * cell, rows * (cell + pad)
    im = Image.new("RGB", (W, H), (14, 12, 10))
    dr = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    for i, (path, label) in enumerate(tiles):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + pad)
        if os.path.exists(path):
            t = Image.open(path).convert("RGB").resize((cell, cell), Image.LANCZOS)
            im.paste(t, (x, y))
        for k, line in enumerate(label.split("\n")[:2]):
            dr.text((x + 8, y + cell + 3 + k * 15), line, fill=(236, 227, 208), font=font)
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    im.save(out_png)
