"""Build every game prop as a GLB with baked PBR textures.

Run with Blender's Python module (bpy 4.5) and Pillow available:

    python scripts/blender/build_props.py                 # all props + contact sheet
    python scripts/blender/build_props.py --only door,lever
    python scripts/blender/build_props.py --quick         # half-size bakes for iteration

Outputs go to public/models/<name>.glb. Everything is modelled and textured
procedurally (no external assets), so the output is CC0-compatible and the
build is deterministic: all noise is a pure function of position and every
random choice uses a seeded ``random.Random``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from dataclasses import dataclass, field
from typing import Callable

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401  (initialises Blender before bmesh/mathutils users)

from propkit import contact, core  # noqa: E402
from propkit.glb import summary  # noqa: E402
from propkit.kit import Ctx  # noqa: E402
from propkit import props_stone, props_metal, props_small  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BUDGET_BYTES = 1_450_000  # per GLB
OUT_DIR = os.path.join(REPO, "public", "models")


@dataclass
class PropDef:
    fn: Callable[[Ctx], list]
    budget: int  # triangle budget
    front: float = 1.0  # contact-sheet camera side (+1 = game front, glTF -Z)
    azimuth: float = 35.0
    elevation: float = 18.0
    zoom: float = 1.0
    notes: str = ""
    extra: dict = field(default_factory=dict)


PROPS: dict[str, PropDef] = {
    "brazier": PropDef(props_metal.brazier, 3000, elevation=24),
    "column_base": PropDef(props_stone.column_base, 2000, elevation=22),
    "column_capital": PropDef(props_stone.column_capital, 2000, elevation=-12),
    "door": PropDef(props_stone.door, 4000, azimuth=28),
    "lever": PropDef(props_metal.lever, 1500, front=-1.0, azimuth=40),
    "block": PropDef(props_stone.block, 1500),
    "idol_jade": PropDef(props_small.idol_jade, 3000),
    "idol_gold": PropDef(props_small.idol_gold, 3000),
    "idol_stone": PropDef(props_small.idol_stone, 3000),
    "relic": PropDef(props_metal.relic, 4000),
    "altar": PropDef(props_stone.altar, 3000),
    "medkit": PropDef(props_small.medkit, 1500, elevation=30),
    "rubble_a": PropDef(props_stone.rubble_a, 1500, elevation=25),
    "rubble_b": PropDef(props_stone.rubble_b, 1500, elevation=25),
    "rubble_c": PropDef(props_stone.rubble_c, 1500, elevation=25),
    "pot_broken": PropDef(props_small.pot_broken, 2500, elevation=28),
    "sand_drift": PropDef(props_small.sand_drift, 1500, front=-1.0, elevation=25),
}


def build_one(name: str, ctx: Ctx) -> dict:
    d = PROPS[name]
    t0 = time.time()
    core.reset_scene()
    objs = d.fn(ctx)
    tris = {o.name: core.tri_count(o) for o in objs}
    path = os.path.join(OUT_DIR, f"{name}.glb")
    core.export_glb(objs, path)
    level = 0
    while os.path.getsize(path) > BUDGET_BYTES and level < 5 and core.BAKED:
        level += 1
        core.reencode(level)
        core.export_glb(objs, path)
    info = summary(path)
    info["encode_level"] = level
    info["file_bytes"] = os.path.getsize(path)
    info["seconds"] = round(time.time() - t0, 1)
    total = sum(tris.values())
    flag = "" if total <= d.budget else f"  OVER BUDGET ({d.budget})"
    big = "" if info["file_bytes"] <= 1.5e6 else "  OVER 1.5 MB"
    lo, hi = info["bounds"]
    dims = [hi[i] - lo[i] for i in range(3)]
    print(f"[{name}] {total} tris {tris}{flag}; {info['file_bytes'] / 1e6:.2f} MB{big}; "
          f"size x{dims[0]:.3f} y{dims[1]:.3f} z{dims[2]:.3f} (glTF); encode level {level}; {info['seconds']} s",
          flush=True)
    return info


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated prop names")
    ap.add_argument("--quick", action="store_true", help="half-resolution bakes")
    ap.add_argument("--work", default=os.path.join(tempfile.gettempdir(), "ninth-chamber-props"))
    ap.add_argument("--contact", default="", help="contact sheet PNG path (default: <work>/contact.png)")
    ap.add_argument("--no-contact", action="store_true")
    ap.add_argument("--no-build", action="store_true", help="only render the contact sheet")
    args = ap.parse_args(sys.argv[1:] if "--" not in sys.argv else sys.argv[sys.argv.index("--") + 1:])

    names = [n for n in args.only.split(",") if n] or list(PROPS)
    for n in names:
        if n not in PROPS:
            raise SystemExit(f"unknown prop {n!r}; known: {', '.join(PROPS)}")
    ctx = Ctx(tex_dir=os.path.join(args.work, "tex"), quick=args.quick)
    report = {}
    failed = []
    if not args.no_build:
        for n in names:
            try:
                report[n] = build_one(n, ctx)
            except Exception:  # keep going; report at the end
                import traceback

                traceback.print_exc()
                failed.append(n)
        os.makedirs(args.work, exist_ok=True)
        with open(os.path.join(args.work, "report.json"), "w") as f:
            json.dump(report, f, indent=1)

    if not args.no_contact:
        tiles = []
        for n in PROPS if not args.only else names:
            path = os.path.join(OUT_DIR, f"{n}.glb")
            if not os.path.exists(path):
                continue
            d = PROPS[n]
            png = os.path.join(args.work, "tiles", f"{n}.png")
            contact.render_tile(path, png, contact.View(azimuth=d.azimuth, elevation=d.elevation, front=d.front,
                                                        zoom=d.zoom), res=560, samples=40)
            info = summary(path)
            lo, hi = info["bounds"]
            label = (f"{n}  {info['tris']} tris  {os.path.getsize(path) / 1e6:.2f} MB\n"
                     f"{hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} m  "
                     f"{', '.join(m['node'] for m in info['meshes'])}")
            tiles.append((png, label))
        out = args.contact or os.path.join(args.work, "contact.png")
        contact.sheet(tiles, out, cols=5 if len(tiles) > 6 else max(1, len(tiles)))
        print("contact sheet:", out)
    if failed:
        print("FAILED:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    # bpy as a module can hang in its exit handlers; leave immediately.
    os._exit(code)
