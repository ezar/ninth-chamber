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


def orientation_report(path: str) -> dict[str, float]:
    """Per mesh: fraction of triangles whose outward ray escapes (higher = facing outwards).

    A cheap check for single-sided glTF materials: for each triangle, look along
    its normal and test whether any other triangle of the same file is hit within
    a short distance (brute force on a sample). Flipped open surfaces score low.
    """
    import numpy as np

    js, binc = read_glb(path)
    tris_all = []
    per_mesh = []
    node_of_mesh = {n["mesh"]: n for n in js.get("nodes", []) if "mesh" in n}
    for mi, mesh in enumerate(js["meshes"]):
        t = np.array(node_of_mesh.get(mi, {}).get("translation", [0, 0, 0]))
        for prim in mesh["primitives"]:
            pos = _accessor_array(js, binc, prim["attributes"]["POSITION"]).astype(np.float64) + t
            idx = _accessor_array(js, binc, prim["indices"]).astype(np.int64).reshape(-1, 3)
            tri = pos[idx]
            tris_all.append(tri)
            per_mesh.append((mesh.get("name"), tri))
    allt = np.concatenate(tris_all)
    out = {}
    rng = np.random.default_rng(0)
    size = np.ptp(allt.reshape(-1, 3), axis=0).max()
    for name, tri in per_mesh:
        k = min(len(tri), 300)
        sel = tri[rng.choice(len(tri), k, replace=False)]
        c = sel.mean(1)
        n = np.cross(sel[:, 1] - sel[:, 0], sel[:, 2] - sel[:, 0])
        area = np.linalg.norm(n, axis=1)
        n = n / np.maximum(area[:, None], 1e-12)
        # Ignore the floor contact: rays going down from z=0 faces are fine either way.
        origins = c + n * size * 1e-3
        escaped = 0
        v0, v1, v2 = allt[:, 0], allt[:, 1], allt[:, 2]
        e1, e2 = v1 - v0, v2 - v0
        for o, d in zip(origins, n):
            pvec = np.cross(d, e2)
            det = (e1 * pvec).sum(1)
            ok = np.abs(det) > 1e-12
            inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
            tvec = o - v0
            u = (tvec * pvec).sum(1) * inv
            qvec = np.cross(tvec, e1)
            v = (d * qvec).sum(1) * inv
            tt = (e2 * qvec).sum(1) * inv
            hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (tt > 0)
            escaped += 0 if hit.any() else 1
        out[name] = escaped / k
    return out
