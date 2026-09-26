"""
Turns the Meshy image-to-3D scan of Nora (A-pose, unrigged, ~1.5M triangles)
into a game-ready skinned GLB: decimated, scaled to 1.72 m, facing -Z in
glTF, with a humanoid skeleton fitted to the mesh and automatic weights.

Usage (Blender as a Python module):
    python scripts/character/rig_nora.py <meshy.glb> <out.glb>

Bone names match the joints the procedural animation drives
(src/render/nora.ts): hips, spine, chest, neck, head, shoulder_L/R,
upperArm_L/R, lowerArm_L/R, hand_L/R, thigh_L/R, shin_L/R, foot_L/R.
"""

import math
import sys

import bpy
import numpy as np
from mathutils import Vector

HEIGHT = 1.72
TARGET_FACES = 45000


def load(path: str) -> bpy.types.Object:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


def clean(obj: bpy.types.Object) -> None:
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode="OBJECT")
    dec = obj.modifiers.new("decimate", "DECIMATE")
    dec.ratio = TARGET_FACES / max(1, len(obj.data.polygons))
    bpy.ops.object.modifier_apply(modifier="decimate")


def normalise(obj: bpy.types.Object) -> np.ndarray:
    """Scale to HEIGHT, feet on z=0, centred."""
    co = np.array([v.co for v in obj.data.vertices])
    s = HEIGHT / (co[:, 2].max() - co[:, 2].min())
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    co = np.array([v.co for v in obj.data.vertices])
    off = np.array([-(co[:, 0].max() + co[:, 0].min()) / 2, -(co[:, 1].max() + co[:, 1].min()) / 2, -co[:, 2].min()])
    for v in obj.data.vertices:
        v.co += Vector(off)
    # The Meshy scan faces -Y after import. Turn it half a turn about the vertical
    # so it faces +Y, which the glTF exporter writes as -Z (the game's forward);
    # rotating the vertices directly is independent of selection state.
    for v in obj.data.vertices:
        v.co.x, v.co.y = -v.co.x, -v.co.y
    obj.data.update()
    return np.array([v.co for v in obj.data.vertices])


def centreline(pts: np.ndarray, axis: int, lo: float, hi: float, n: int) -> np.ndarray:
    """Mean position of vertex slices along an axis (skips empty slices)."""
    out = []
    for a, b in zip(np.linspace(lo, hi, n)[:-1], np.linspace(lo, hi, n)[1:]):
        sel = pts[(pts[:, axis] >= a) & (pts[:, axis] < b)]
        if len(sel) > 5:
            out.append(sel.mean(0))
    return np.array(out)


def fit_joints(co: np.ndarray) -> dict[str, Vector]:
    H = HEIGHT
    j: dict[str, Vector] = {}
    # Legs: centreline of each leg below the crotch.
    for side, sign in (("L", -1), ("R", 1)):
        leg = co[(co[:, 0] * sign > 0.02) & (co[:, 2] < 0.78 * H * 0.62)]
        line = centreline(leg, 2, 0.02, 0.5 * H, 24)
        at = lambda z: line[np.argmin(np.abs(line[:, 2] - z))]  # noqa: E731
        hip = at(0.47 * H)
        knee = at(0.28 * H)
        ankle = at(0.055 * H)
        # The hip joint sits well inside the silhouette; the satchel skews the leg
        # centreline on one side, so use a fixed, symmetric width.
        j[f"thigh_{side}"] = Vector((sign * 0.095, 0.0, 0.52 * H))
        del hip
        j[f"shin_{side}"] = Vector((knee[0], knee[1] + 0.01, 0.285 * H))
        j[f"foot_{side}"] = Vector((ankle[0], ankle[1] - 0.02, 0.055 * H))
        j[f"toe_{side}"] = Vector((ankle[0], ankle[1] + 0.14, 0.01))
    # Arms (A-pose, about 30 degrees from vertical). Joint positions were measured
    # from the arm centreline of this scan (shoulder, rolled-sleeve elbow, wrist
    # where the hand widens, fingertips) and scale with the height.
    k = H / 1.72
    for side, sign in (("L", -1), ("R", 1)):
        j[f"shoulder_{side}"] = Vector((sign * 0.03, 0.0, 1.376 * k))
        j[f"upperArm_{side}"] = Vector((sign * 0.165, -0.01, 1.40 * k))
        j[f"lowerArm_{side}"] = Vector((sign * 0.305, 0.03, 1.165 * k))
        j[f"hand_{side}"] = Vector((sign * 0.45, -0.05, 0.94 * k))
        j[f"handTip_{side}"] = Vector((sign * 0.55, -0.05, 0.82 * k))
    j["hips"] = Vector((0, 0, 0.53 * H))
    j["spine"] = Vector((0, 0.0, 0.6 * H))
    j["chest"] = Vector((0, 0.0, 0.7 * H))
    j["neck"] = Vector((0, 0.0, 0.84 * H))
    j["head"] = Vector((0, 0.01, 0.88 * H))
    j["headTop"] = Vector((0, 0.01, H))
    return j


BONES = [
    # name, head joint, tail joint, parent
    ("hips", "hips", "spine", None),
    ("spine", "spine", "chest", "hips"),
    ("chest", "chest", "neck", "spine"),
    ("neck", "neck", "head", "chest"),
    ("head", "head", "headTop", "neck"),
]
for s in ("L", "R"):
    BONES += [
        (f"shoulder_{s}", f"shoulder_{s}", f"upperArm_{s}", "chest"),
        (f"upperArm_{s}", f"upperArm_{s}", f"lowerArm_{s}", f"shoulder_{s}"),
        (f"lowerArm_{s}", f"lowerArm_{s}", f"hand_{s}", f"upperArm_{s}"),
        (f"hand_{s}", f"hand_{s}", f"handTip_{s}", f"lowerArm_{s}"),
        (f"thigh_{s}", f"thigh_{s}", f"shin_{s}", "hips"),
        (f"shin_{s}", f"shin_{s}", f"foot_{s}", f"thigh_{s}"),
        (f"foot_{s}", f"foot_{s}", f"toe_{s}", f"shin_{s}"),
    ]


def build_armature(j: dict[str, Vector]) -> bpy.types.Object:
    arm_data = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, h, t, parent in BONES:
        b = arm_data.edit_bones.new(name)
        b.head = j[h]
        b.tail = j[t]
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin(mesh: bpy.types.Object, rig: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    weighted = sum(1 for v in mesh.data.vertices if any(g.weight > 0 for g in v.groups))
    print(f"weighted vertices: {weighted}/{len(mesh.data.vertices)}")


def shrink_textures(max_size: int = 2048) -> None:
    for img in bpy.data.images:
        if img.size[0] > max_size:
            img.scale(max_size, max_size)


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    src, out = args[0], args[1]
    mesh = load(src)
    mesh.name = "nora"
    clean(mesh)
    co = normalise(mesh)
    joints = fit_joints(co)
    for k, v in joints.items():
        print(f"{k:12s} {v.x:+.3f} {v.y:+.3f} {v.z:+.3f}")
    rig = build_armature(joints)
    skin(mesh, rig)
    shrink_textures()
    bpy.ops.wm.save_as_mainfile(filepath=out.replace(".glb", ".blend"))
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_image_format="JPEG",
        export_jpeg_quality=88,
        use_selection=False,
    )
    print(f"exported {out}")


main()
