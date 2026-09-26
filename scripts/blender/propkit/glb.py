"""Minimal GLB reader used to validate exported files (no Blender needed)."""

from __future__ import annotations

import json
import struct
from typing import Any

_COMP = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path: str) -> tuple[dict[str, Any], bytes]:
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", path
    off = 12
    js: dict[str, Any] = {}
    binc = b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def _accessor_array(js, binc, idx):
    import numpy as np

    acc = js["accessors"][idx]
    bv = js["bufferViews"][acc["bufferView"]]
    comp = acc["componentType"]
    n = _NCOMP[acc["type"]]
    dt = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[comp]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    arr = np.frombuffer(binc, dtype=dt, count=acc["count"] * n, offset=start)
    return arr.reshape(acc["count"], n) if n > 1 else arr


def summary(path: str) -> dict[str, Any]:
    """Nodes, meshes, triangle counts, bounds (glTF space) and images of a GLB."""
    import numpy as np

    js, binc = read_glb(path)
    meshes = []
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    node_of_mesh = {}
    for ni, node in enumerate(js.get("nodes", [])):
        if "mesh" in node:
            node_of_mesh[node["mesh"]] = node
    for mi, mesh in enumerate(js.get("meshes", [])):
        tris = 0
        mats = []
        node = node_of_mesh.get(mi, {})
        t = np.array(node.get("translation", [0, 0, 0]))
        for prim in mesh["primitives"]:
            if "indices" in prim:
                tris += js["accessors"][prim["indices"]]["count"] // 3
            pa = js["accessors"][prim["attributes"]["POSITION"]]
            lo = np.minimum(lo, np.array(pa["min"]) + t)
            hi = np.maximum(hi, np.array(pa["max"]) + t)
            if "material" in prim:
                mats.append(js["materials"][prim["material"]]["name"])
        meshes.append({"node": node.get("name"), "mesh": mesh.get("name"), "tris": tris, "materials": mats,
                       "translation": node.get("translation", [0, 0, 0]),
                       "attributes": sorted(mesh["primitives"][0]["attributes"].keys())})
    images = []
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        images.append({"name": im.get("name"), "mime": im.get("mimeType"), "bytes": bv["byteLength"]})
    mats = []
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        mats.append({
            "name": m.get("name"),
            "baseColorTexture": pbr.get("baseColorTexture", {}).get("index"),
            "metallicRoughnessTexture": pbr.get("metallicRoughnessTexture", {}).get("index"),
            "occlusionTexture": m.get("occlusionTexture", {}).get("index"),
            "normalTexture": m.get("normalTexture", {}).get("index"),
            "emissiveTexture": m.get("emissiveTexture", {}).get("index"),
            "emissiveFactor": m.get("emissiveFactor"),
        })
    return {
        "meshes": meshes,
        "tris": sum(m["tris"] for m in meshes),
        "bounds": [lo.tolist(), hi.tolist()],
        "images": images,
        "materials": mats,
        "textures": js.get("textures", []),
    }
