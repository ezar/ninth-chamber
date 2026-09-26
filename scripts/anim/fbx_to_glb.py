"""
Converts Mixamo FBX downloads to glTF binaries for scripts/anim/build-clips.ts.

Usage (Blender, headless):
    blender -b -P scripts/anim/fbx_to_glb.py -- <in.fbx> [<in2.fbx> ...] <out folder>

Each <name>.fbx becomes <out folder>/<name>.glb with its skeleton and its one
animation, sampled at 30 fps. Bone names stay as Mixamo writes them
("mixamorig:Hips" ...); the "mixamo" rig profile in scripts/anim/rigs.ts
strips the prefix.
"""

import os
import sys

import bpy


def convert(src: str, out_dir: str) -> str:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False, ignore_leaf_bones=True)
    out = os.path.join(out_dir, os.path.splitext(os.path.basename(src))[0] + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_frame_range=False,
        export_force_sampling=True,
        export_anim_single_armature=True,
        export_materials="NONE",
        export_image_format="NONE",
    )
    return out


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(args) < 2:
        raise SystemExit("usage: blender -b -P fbx_to_glb.py -- <in.fbx>... <out folder>")
    *sources, out_dir = args
    os.makedirs(out_dir, exist_ok=True)
    for src in sources:
        print("wrote", convert(src, out_dir))


main()
