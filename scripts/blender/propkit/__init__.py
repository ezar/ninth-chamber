"""Procedural prop kit for The Ninth Chamber (driven by ../build_props.py).

Modules:
  nodes       node-graph DSL shared by shader and geometry-node trees
  shapes      bmesh construction helpers (boxes, lofts, lathes, tubes)
  core        scene, mesh ops, curvature, UVs, Cycles baking, glTF export
  kit         high-poly source / low-poly target workflow
  looks       material recipes (sandstone, bronze, gold, jade, stone, clay, leather, sand, coals, amber)
  motifs      carved patterns (nine-segment seal, glyph frieze)
  props_*     one builder per prop
  contact     re-import and render the contact sheet
  glb         minimal GLB reader for validation
"""
