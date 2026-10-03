"""
Renders the app icon: the nine-segment seal carved in sandstone, the ninth
segment in glowing amber (Blender Cycles, orthographic, 1024 px).

Usage (Blender as a Python module, see scripts/bake):
    python scripts/brand/render_icon.py -- <out.png> <size> art/textures/wall

The PNGs in public/icons (192/512 rounded, 512 maskable, 180 Apple touch,
32 favicon) are cut from the 1024 px render.
"""
import bpy, bmesh, math, sys
from mathutils import Vector

out, size, tex_dir = sys.argv[-3], int(sys.argv[-2]), sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = size
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Punchy'

def img(name):
    return bpy.data.images.load(f"{tex_dir}/{name}")

def stone_material(name, tint, rough=0.85, scale=1.0, bump=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; n = nt.nodes; l = nt.links
    bsdf = n['Principled BSDF']
    tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
    l.new(tc.outputs['Object'], mp.inputs['Vector'])
    alb = n.new('ShaderNodeTexImage'); alb.image = img('albedo.jpg'); l.new(mp.outputs['Vector'], alb.inputs['Vector'])
    mix = n.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
    mix.inputs[7].default_value = (*tint, 1)
    l.new(alb.outputs['Color'], mix.inputs[6]); l.new(mix.outputs[2], bsdf.inputs['Base Color'])
    nor = n.new('ShaderNodeTexImage'); nor.image = img('normal.jpg'); nor.image.colorspace_settings.name = 'Non-Color'
    l.new(mp.outputs['Vector'], nor.inputs['Vector'])
    nm = n.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = bump
    l.new(nor.outputs['Color'], nm.inputs['Color']); l.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = rough
    return m

def amber_material():
    m = bpy.data.materials.new('amber'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.75, 0.22, 0.01, 1)
    b.inputs['Roughness'].default_value = 0.18
    b.inputs['Emission Color'].default_value = (1.0, 0.3, 0.015, 1)
    b.inputs['Emission Strength'].default_value = 2.4
    b.inputs['Coat Weight'].default_value = 0.25
    return m

# Slab: a slightly domed square of dark sandstone.
bpy.ops.mesh.primitive_plane_add(size=2.4)
slab = bpy.context.active_object
slab.data.materials.append(stone_material('slab', (0.2, 0.145, 0.1), 0.95, 0.55, 0.9))

def ring_segment(a0, a1, r0, r1, height, name, mat, bevel=0.012):
    bm = bmesh.new()
    steps = 24
    outer = [(r1 * math.cos(a0 + (a1 - a0) * i / steps), r1 * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]
    inner = [(r0 * math.cos(a1 - (a1 - a0) * i / steps), r0 * math.sin(a1 - (a1 - a0) * i / steps)) for i in range(steps + 1)]
    verts = [bm.verts.new((x, y, 0)) for x, y in outer + inner]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, height), verts=top)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    bev = ob.modifiers.new('bevel', 'BEVEL'); bev.width = bevel; bev.segments = 3; bev.limit_method = 'ANGLE'
    ob.data.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return ob

carved = stone_material('carved', (1.0, 0.8, 0.55), 0.7, 1.1, 0.6)
amber = amber_material()
R0, R1 = 0.50, 0.72
gap = math.radians(4.5)
for k in range(9):
    # Segments go clockwise from the top; the ninth ends just left of the top.
    start = math.radians(90) - gap / 2 - math.radians(40) * k
    a1 = start
    a0 = start - math.radians(40) + gap
    if k == 8:
        ring_segment(a0, a1, R0 + 0.02, R1 - 0.02, 0.05, f'seg{k}', amber, 0.008)
    else:
        ring_segment(a0, a1, R0, R1, 0.09, f'seg{k}', carved)
# Centre: a carved ring and an amber gem.
bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.022, location=(0, 0, 0.02))
t = bpy.context.active_object; t.data.materials.append(carved)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.085, location=(0, 0, 0.0))
g = bpy.context.active_object; g.scale.z = 0.55; g.data.materials.append(amber)
bpy.ops.object.shade_smooth()

# Light: warm key from the upper left, cool rim, dim fill; dark world.
def area(name, loc, energy, color, sizea):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.color = color; l.size = sizea
    o = bpy.data.objects.new(name, l); o.location = loc; scene.collection.objects.link(o)
    d = Vector((0, 0, 0)) - Vector(loc); o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('-Z', 'Y')
area('key', (-1.6, 1.8, 2.2), 320, (1.0, 0.72, 0.45), 1.2)
area('rim', (1.8, -1.2, 1.0), 90, (0.55, 0.65, 0.9), 1.5)
area('fill', (0, 0, 3), 25, (1, 0.9, 0.8), 3)
w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.003, 0.002, 1); scene.world = w

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
cam.location = (0, 0, 5); cam.rotation_euler = (0, 0, 0)

# Glow around the amber.
scene.use_nodes = True
nt = scene.node_tree; n = nt.nodes
rl = n['Render Layers']; comp = n['Composite']
glare = n.new('CompositorNodeGlare'); glare.glare_type = 'FOG_GLOW'; glare.quality = 'HIGH'; glare.size = 9
try:
    glare.threshold = 0.45
except Exception:
    pass
vig = n.new('CompositorNodeEllipseMask'); vig.width = 1.25; vig.height = 1.25
blur = n.new('CompositorNodeBlur'); blur.size_x = blur.size_y = int(size * 0.18)
mix = n.new('CompositorNodeMixRGB'); mix.blend_type = 'MULTIPLY'
nt.links.new(rl.outputs['Image'], glare.inputs['Image'])
nt.links.new(vig.outputs['Mask'], blur.inputs['Image'])
nt.links.new(glare.outputs['Image'], mix.inputs[1])
nt.links.new(blur.outputs['Image'], mix.inputs[2])
mix.inputs['Fac'].default_value = 0.8
nt.links.new(mix.outputs['Image'], comp.inputs['Image'])
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
