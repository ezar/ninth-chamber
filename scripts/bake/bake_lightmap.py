"""
Bakes a level's indirect lighting (global illumination) into a lightmap with
Blender Cycles (spec §11: "lightmaps horneados en Blender con iluminación
global para lo estático").

The game keeps direct light dynamic (sun shadows, flickering fires), so only
the indirect diffuse pass is baked; the runtime adds it as the materials'
lightMap on the second UV set. The lights match the runtime ones: fires at
the runtime gain and height, and each room's sun lighting only its own room
(light linking), since the game shows one sun at a time.

Usage (Blender as a Python module, `pip install bpy`):
    python scripts/bake/bake_lightmap.py <export.json> <out-dir> [samples]

Writes <out-dir>/<level>.lightmap.png (sRGB, normalised) and
<out-dir>/<level>.lightmap.json ({ "scale": s }): linear irradiance = texel * s.
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(h: str) -> tuple[float, float, float]:
    n = int(h[1:], 16)
    return tuple(srgb_to_linear(((n >> s) & 255) / 255) for s in (16, 8, 0))  # type: ignore[return-value]


def to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Game space is Y-up with -Z north; Blender is Z-up."""
    return (x, -z, y)


def reset_scene() -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    scene.world = world
    return scene


def build_meshes(data: dict, image: bpy.types.Image) -> dict[int, bpy.types.Object]:
    """One object per room (room index -> object; -1 for triangles outside any room).

    Split by room so each room's sun can be linked to its own geometry only.
    """
    materials = []
    for name, s in data["surfaces"].items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes["Principled BSDF"]
        r, g, b = hex_color(s["albedo"])
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
        bsdf.inputs["Roughness"].default_value = 1.0
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        nodes.active = tex
        materials.append(mat)

    # room -> (verts, uvs, faces, face material)
    parts: dict[int, tuple[list, list, list, list]] = {}
    for mi, s in enumerate(data["surfaces"].values()):
        p = s["position"]
        uv = s["uv1"]
        idx = s["index"]
        rooms = s.get("rooms") or [-1] * (len(idx) // 3)
        for t in range(0, len(idx), 3):
            verts, uvs, faces, face_mat = parts.setdefault(rooms[t // 3], ([], [], [], []))
            face = []
            for k in range(3):
                i = idx[t + k]
                face.append(len(verts))
                verts.append(to_blender(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]))
                uvs.append((uv[i * 2], uv[i * 2 + 1]))
            faces.append(tuple(face))
            face_mat.append(mi)

    objects: dict[int, bpy.types.Object] = {}
    for room, (verts, uvs, faces, face_mat) in parts.items():
        mesh = bpy.data.meshes.new(f"level_{room}")
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        # (x, y, z) -> (x, -z, y) is a proper rotation, so the winding and normals carry over.
        layer = mesh.uv_layers.new(name="lightmap")
        for poly in mesh.polygons:
            poly.material_index = face_mat[poly.index]
            for li in poly.loop_indices:
                layer.data[li].uv = uvs[mesh.loops[li].vertex_index]
        for m in materials:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(f"level_{room}", mesh)
        bpy.context.scene.collection.objects.link(obj)
        objects[room] = obj
    return objects


def add_lights(data: dict, objects: dict[int, bpy.types.Object]) -> None:
    scene = bpy.context.scene
    room_ids = data.get("roomIds", [])
    for sun in data["suns"]:
        light = bpy.data.lights.new(f"sun_{sun['room']}", "SUN")
        light.energy = sun["intensity"]
        light.color = hex_color(sun["color"])
        light.angle = math.radians(0.8)
        obj = bpy.data.objects.new(light.name, light)
        d = Vector(to_blender(*sun["direction"])).normalized()
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
        # The game has one sun at a time, the current room's: each sun lights
        # only its own room (light linking); bounce still spreads from there.
        room = room_ids.index(sun["room"]) if sun["room"] in room_ids else None
        if room is not None and room in objects:
            receivers = bpy.data.collections.new(f"sunlit_{sun['room']}")
            receivers.objects.link(objects[room])
            obj.light_linking.receiver_collection = receivers
        scene.collection.objects.link(obj)

    for i, p in enumerate(data["points"]):
        light = bpy.data.lights.new(f"fire_{i}", "POINT")
        # Three.js candela -> Blender watts for a point light: P = 4π·I.
        light.energy = 4 * math.pi * p["candela"]
        light.color = hex_color(p["color"])
        light.shadow_soft_size = 0.25
        obj = bpy.data.objects.new(light.name, light)
        obj.location = to_blender(p["x"], p["y"], p["z"])
        scene.collection.objects.link(obj)

    # Bright sky seen through each skylight cell: a downward-facing emitter.
    sky = bpy.data.materials.new("sky")
    sky.use_nodes = True
    nodes = sky.node_tree.nodes
    nodes.clear()
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*hex_color("#a9bccb"), 1)
    emit.inputs["Strength"].default_value = 2.5
    out = nodes.new("ShaderNodeOutputMaterial")
    sky.node_tree.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    for i, cell in enumerate(data["skylights"]):
        bpy.ops.mesh.primitive_plane_add(size=2, location=to_blender(cell["x"], cell["ceil"] + 0.3, cell["z"]))
        plane = bpy.context.active_object
        plane.name = f"sky_{i}"
        plane.rotation_euler = (math.pi, 0, 0)  # face down
        plane.data.materials.append(sky)
        plane.visible_camera = False


def bake(objects: list[bpy.types.Object], samples: int) -> None:
    scene = bpy.context.scene
    scene.cycles.samples = samples
    bake = scene.render.bake
    bake.use_pass_direct = False
    bake.use_pass_indirect = True
    bake.use_pass_color = False
    bake.margin = 4
    bake.margin_type = "EXTEND"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.data.uv_layers.active = obj.data.uv_layers["lightmap"]
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"INDIRECT"}, use_clear=True, margin=4)


def smooth(pixels: np.ndarray) -> np.ndarray:
    """Light 3×3 box filter to take the edge off Monte Carlo noise (indirect light is smooth)."""
    padded = np.pad(pixels, ((1, 1), (1, 1), (0, 0)), mode="edge")
    acc = np.zeros_like(pixels)
    for dy in range(3):
        for dx in range(3):
            acc += padded[dy : dy + pixels.shape[0], dx : dx + pixels.shape[1]]
    return acc / 9


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    export_path, out_dir = args[0], args[1]
    samples = int(args[2]) if len(args) > 2 else 128
    with open(export_path) as f:
        data = json.load(f)
    w, h = data["lightmapSize"]["width"], data["lightmapSize"]["height"]

    reset_scene()
    image = bpy.data.images.new("lightmap", w, h, alpha=False, float_buffer=True)
    objects = build_meshes(data, image)
    add_lights(data, objects)

    t0 = time.time()
    bake(list(objects.values()), samples)
    print(f"baked {w}×{h} at {samples} spp in {time.time() - t0:.0f} s")

    px = np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    px = smooth(px)
    scale = float(np.percentile(px, 99.7)) or 1.0
    norm = np.clip(px / scale, 0, 1)
    # Store with an sRGB curve so dark indirect light keeps precision in 8 bits.
    enc = np.where(norm <= 0.0031308, norm * 12.92, 1.055 * np.power(norm, 1 / 2.4) - 0.055)
    out = bpy.data.images.new("lightmap_out", w, h, alpha=False)
    rgba = np.concatenate([enc, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    out.pixels = rgba.ravel().tolist()
    os.makedirs(out_dir, exist_ok=True)
    png = os.path.join(out_dir, f"{data['level']}.lightmap.png")
    out.filepath_raw = png
    out.file_format = "PNG"
    out.save()
    with open(os.path.join(out_dir, f"{data['level']}.lightmap.json"), "w") as f:
        json.dump({"scale": scale, "samples": samples, "width": w, "height": h}, f, indent=2)
        f.write("\n")
    print(f"wrote {png} (scale {scale:.4f})")


main()
