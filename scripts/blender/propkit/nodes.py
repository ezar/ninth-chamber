"""A tiny node-graph DSL shared by shader trees and geometry-node trees.

Materials and high-poly displacement are written as ordinary Python
expressions (``(noise - 0.5) * 2``) that expand into Blender math nodes, so the
same procedural functions can drive both the geometry and the textures.
Every texture node is a pure function of object-space position in metres,
which keeps the whole build deterministic.
"""

from __future__ import annotations

from typing import Iterable, Sequence, Union

import bpy

Number = Union[int, float]


def hex_rgb(h: str) -> tuple[float, float, float]:
    """sRGB hex string to linear RGB (what Blender colour sockets expect)."""
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2])


class S:
    """An output socket that supports arithmetic (scalar) through math nodes."""

    def __init__(self, g: "Graph", sock: bpy.types.NodeSocket):
        self.g = g
        self.s = sock

    # Arithmetic -----------------------------------------------------------
    def __add__(self, o):
        return self.g.math("ADD", self, o)

    def __radd__(self, o):
        return self.g.math("ADD", o, self)

    def __sub__(self, o):
        return self.g.math("SUBTRACT", self, o)

    def __rsub__(self, o):
        return self.g.math("SUBTRACT", o, self)

    def __mul__(self, o):
        return self.g.math("MULTIPLY", self, o)

    def __rmul__(self, o):
        return self.g.math("MULTIPLY", o, self)

    def __truediv__(self, o):
        return self.g.math("DIVIDE", self, o)

    def __rtruediv__(self, o):
        return self.g.math("DIVIDE", o, self)

    def __neg__(self):
        return self.g.math("MULTIPLY", self, -1.0)

    def __pow__(self, o):
        return self.g.math("POWER", self, o)

    # Helpers ----------------------------------------------------------------
    def clamp(self) -> "S":
        return self.g.math("ADD", self, 0.0, clamp=True)

    def lin(self, a: Number, b: Number, lo: Number = 0.0, hi: Number = 1.0) -> "S":
        """Linear remap [a, b] -> [lo, hi], clamped."""
        return self.g.map_range(self, a, b, lo, hi, "LINEAR")

    def smooth(self, a: Number, b: Number, lo: Number = 0.0, hi: Number = 1.0) -> "S":
        """Smoothstep remap [a, b] -> [lo, hi]."""
        return self.g.map_range(self, a, b, lo, hi, "SMOOTHSTEP")

    def abs(self) -> "S":
        return self.g.math("ABSOLUTE", self)

    def max(self, o) -> "S":
        return self.g.math("MAXIMUM", self, o)

    def min(self, o) -> "S":
        return self.g.math("MINIMUM", self, o)

    def inv(self) -> "S":
        return self.g.math("SUBTRACT", 1.0, self)


class Graph:
    """Wraps a node tree (shader or geometry nodes) with builder helpers."""

    def __init__(self, tree: bpy.types.NodeTree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self.is_geo = tree.bl_idname == "GeometryNodeTree"
        self._x = 0

    # Low level --------------------------------------------------------------
    def node(self, kind: str, **props) -> bpy.types.Node:
        n = self.nodes.new(kind)
        n.location = (self._x, 0)
        self._x += 20
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def feed(self, sock: bpy.types.NodeSocket, value) -> None:
        """Connect a socket-like value or set a constant default."""
        if isinstance(value, S):
            self.links.new(value.s, sock)
        elif isinstance(value, bpy.types.NodeSocket):
            self.links.new(value, sock)
        elif value is None:
            return
        elif isinstance(value, str):
            c = hex_rgb(value)
            sock.default_value = (c[0], c[1], c[2], 1.0) if len(sock.default_value) == 4 else c
        elif isinstance(value, (tuple, list)):
            v = list(value)
            if len(sock.default_value) == 4 and len(v) == 3:
                v.append(1.0)
            sock.default_value = v
        else:
            sock.default_value = value

    def const(self, v: Number) -> S:
        n = self.node("ShaderNodeValue")
        n.outputs[0].default_value = v
        return S(self, n.outputs[0])

    def rgb(self, h: str) -> S:
        n = self.node("ShaderNodeRGB")
        c = hex_rgb(h)
        n.outputs[0].default_value = (c[0], c[1], c[2], 1.0)
        return S(self, n.outputs[0])

    # Math ---------------------------------------------------------------------
    def math(self, op: str, a, b=None, clamp: bool = False) -> S:
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return S(self, n.outputs[0])

    def map_range(self, x, a, b, lo, hi, interp: str = "LINEAR") -> S:
        n = self.node("ShaderNodeMapRange", interpolation_type=interp, clamp=True)
        self.feed(n.inputs[0], x)
        self.feed(n.inputs[1], a)
        self.feed(n.inputs[2], b)
        self.feed(n.inputs[3], lo)
        self.feed(n.inputs[4], hi)
        return S(self, n.outputs[0])

    def vmath(self, op: str, a, b=None, scale: Number | None = None) -> S:
        n = self.node("ShaderNodeVectorMath", operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if scale is not None:
            self.feed(n.inputs[3], scale)
        out = n.outputs[1] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs[0]
        return S(self, out)

    def combine(self, x, y, z) -> S:
        n = self.node("ShaderNodeCombineXYZ")
        self.feed(n.inputs[0], x)
        self.feed(n.inputs[1], y)
        self.feed(n.inputs[2], z)
        return S(self, n.outputs[0])

    def separate(self, v) -> tuple[S, S, S]:
        n = self.node("ShaderNodeSeparateXYZ")
        self.feed(n.inputs[0], v)
        return S(self, n.outputs[0]), S(self, n.outputs[1]), S(self, n.outputs[2])

    def mix(self, fac, a, b, blend: str = "MIX") -> S:
        """Colour mix (``a`` at fac 0, ``b`` at fac 1)."""
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[6], a)
        self.feed(n.inputs[7], b)
        return S(self, n.outputs[2])

    def mixf(self, fac, a, b) -> S:
        """Scalar lerp."""
        n = self.node("ShaderNodeMix", data_type="FLOAT", clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[2], a)
        self.feed(n.inputs[3], b)
        return S(self, n.outputs[0])

    def mixv(self, fac, a, b) -> S:
        n = self.node("ShaderNodeMix", data_type="VECTOR", clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[4], a)
        self.feed(n.inputs[5], b)
        return S(self, n.outputs[1])

    def ramp(self, x, stops: Sequence[tuple[float, str]], interp: str = "LINEAR") -> S:
        """Colour ramp from (position, hex) stops."""
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, h) in zip(cr.elements, stops):
            el.position = pos
            c = hex_rgb(h)
            el.color = (c[0], c[1], c[2], 1.0)
        self.feed(n.inputs[0], x)
        return S(self, n.outputs[0])

    def hsv(self, col, h: Number = 0.5, s: Number = 1.0, v: Number = 1.0) -> S:
        n = self.node("ShaderNodeHueSaturation")
        self.feed(n.inputs[0], h)
        self.feed(n.inputs[1], s)
        self.feed(n.inputs[2], v)
        self.feed(n.inputs[4], col)
        return S(self, n.outputs[0])

    # Inputs ---------------------------------------------------------------------
    def pos(self) -> S:
        """Object-space position (metres)."""
        if self.is_geo:
            return S(self, self.node("GeometryNodeInputPosition").outputs[0])
        return S(self, self.node("ShaderNodeTexCoord").outputs["Object"])

    def normal(self) -> S:
        if self.is_geo:
            return S(self, self.node("GeometryNodeInputNormal").outputs[0])
        return S(self, self.node("ShaderNodeNewGeometry").outputs["Normal"])

    def attr(self, name: str) -> S:
        """A float point attribute written by the build (for example ``curv``)."""
        if self.is_geo:
            n = self.node("GeometryNodeInputNamedAttribute", data_type="FLOAT")
            n.inputs[0].default_value = name
            return S(self, n.outputs[0])
        n = self.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name=name)
        return S(self, n.outputs["Fac"])

    def attr_color(self, name: str) -> S:
        n = self.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name=name)
        return S(self, n.outputs["Color"])

    def ao(self, distance: Number = 0.2, samples: int = 8, inside: bool = False, local: bool = True) -> S:
        """Cycles ambient-occlusion node (shader trees only)."""
        n = self.node("ShaderNodeAmbientOcclusion", samples=samples, inside=inside, only_local=local)
        self.feed(n.inputs["Distance"], distance)
        return S(self, n.outputs["AO"])

    # Textures -------------------------------------------------------------------
    def noise(
        self,
        vec=None,
        scale: Number = 5.0,
        detail: Number = 2.0,
        rough: Number = 0.5,
        lacunarity: Number = 2.0,
        distortion: Number = 0.0,
        w: Number | S | None = None,
        kind: str = "FBM",
        color: bool = False,
    ) -> S:
        n = self.node("ShaderNodeTexNoise", noise_dimensions="4D" if w is not None else "3D", noise_type=kind)
        n.normalize = kind == "FBM"
        self.feed(n.inputs["Vector"], vec if vec is not None else self.pos())
        if w is not None:
            self.feed(n.inputs["W"], w)
        self.feed(n.inputs["Scale"], scale)
        self.feed(n.inputs["Detail"], detail)
        self.feed(n.inputs["Roughness"], rough)
        self.feed(n.inputs["Lacunarity"], lacunarity)
        self.feed(n.inputs["Distortion"], distortion)
        return S(self, n.outputs["Color" if color else "Fac"])

    def voronoi(
        self,
        vec=None,
        scale: Number = 5.0,
        feature: str = "F1",
        metric: str = "EUCLIDEAN",
        rand: Number = 1.0,
        w: Number | S | None = None,
        out: str = "Distance",
        detail: Number = 0.0,
        dims: str | None = None,
    ) -> S:
        n = self.node(
            "ShaderNodeTexVoronoi",
            voronoi_dimensions=dims or ("4D" if w is not None else "3D"),
            feature=feature,
            distance=metric,
        )
        self.feed(n.inputs["Vector"], vec if vec is not None else self.pos())
        if w is not None:
            self.feed(n.inputs["W"], w)
        self.feed(n.inputs["Scale"], scale)
        self.feed(n.inputs["Randomness"], rand)
        self.feed(n.inputs["Detail"], detail)
        return S(self, n.outputs[out])

    def wave(
        self,
        vec=None,
        scale: Number = 5.0,
        distortion: Number = 0.0,
        detail: Number = 2.0,
        axis: str = "Z",
        profile: str = "SIN",
        kind: str = "BANDS",
        phase: Number = 0.0,
    ) -> S:
        n = self.node("ShaderNodeTexWave", wave_type=kind, bands_direction=axis, wave_profile=profile)
        self.feed(n.inputs["Vector"], vec if vec is not None else self.pos())
        self.feed(n.inputs["Scale"], scale)
        self.feed(n.inputs["Distortion"], distortion)
        self.feed(n.inputs["Detail"], detail)
        self.feed(n.inputs["Phase Offset"], phase)
        return S(self, n.outputs["Fac"])

    def warp(self, vec, amount: Number, scale: Number, detail: Number = 2.0, seed: Number = 0.0) -> S:
        """Domain warp: position + amount * (noise colour - 0.5)."""
        c = self.noise(vec, scale=scale, detail=detail, w=seed, color=True)
        off = self.vmath("SUBTRACT", c, (0.5, 0.5, 0.5))
        return self.vmath("ADD", vec, self.vmath("SCALE", off, scale=amount))

    def scale_vec(self, vec, sx: Number, sy: Number, sz: Number) -> S:
        return self.vmath("MULTIPLY", vec, (sx, sy, sz))


def sum_all(items: Iterable[S]) -> S:
    items = list(items)
    acc = items[0]
    for it in items[1:]:
        acc = acc + it
    return acc
