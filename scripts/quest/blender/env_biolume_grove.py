"""
Biolume Grove: a bioluminescent jungle clearing on an alien world at night.

Giant braided trunks and arching roots ring a mossy clearing with a still,
dark pool ahead. Overhead a high canopy opens towards the front onto a starry
sky with two pale moons. Glowing fungi, bulbs, curled fronds and moss light
the forest floor in cyan, turquoise, violet and magenta, and tiny spores
drift through a low mist. The viewer sits on the soft, curled cap of a giant
mushroom on a patch of moss.

Light layers:
- glow: the glowing plants and the light they cast. Stays fairly on while
  the film plays; the app breathes it slowly (PULSE).
- motes: the drifting spores (SHIMMER).
The moons, the stars and the mist they light are the base: the forest at
night with its plants dimmed.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import aurora_scene as A

SAMPLES = 128

# The still pool in the clearing ahead (centre and radii, metres).
POOL = (0.4, 8.6, 5.6, 4.3)
WATER_Z = -0.14

# Where the canopy opens: a wedge widening ahead from this point, so the moons show above the screen.
OPENING = (-3.0, 9.0)
CANOPY_Z = (23.5, 28.5, 34.0)

# The two moons: (azimuth from +Y towards +X, elevation, angular radius) in degrees.
MOON = (-21.0, 36.0, 3.6)
MOON2 = (17.0, 48.0, 1.3)

CYAN = (0.12, 0.85, 1.0)
TURQUOISE = (0.05, 1.0, 0.62)
AQUA = (0.45, 1.0, 0.92)
VIOLET = (0.42, 0.22, 1.0)
MAGENTA = (1.0, 0.16, 0.72)
MOONLIGHT = (0.62, 0.74, 1.0)
AMBIENT = (0.07, 0.11, 0.2)

rng = random.Random(1137)
GLOW_SPOTS = []  # where the glowing plants are, for the spores to gather around
GLOW_CREEPERS = False  # glowing creepers spiralling up the trunks (they read as stray arcs at a distance)


# ---------------------------------------------------------------- utilities


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def ground_z(x, y):
    """The forest floor: flat under the viewer, rolling further out, rising into the forest, dipping into the pool."""
    r = math.hypot(x, y)
    roll = 0.45 * noise.noise(Vector((x * 0.07, y * 0.07, 1.3))) + 0.12 * noise.noise(Vector((x * 0.3, y * 0.3, 4.1)))
    z = roll * smooth(1.8, 6.0, r) + 0.035 * max(0.0, r - 16) ** 1.35
    px, py, rx, ry = POOL
    e = ((x - px) / rx) ** 2 + ((y - py) / ry) ** 2 + 0.35 * noise.noise(Vector((x * 0.25, y * 0.25, 7.7)))
    return z - 0.6 * (1 - smooth(0.55, 1.05, e))


def direction(az, el):
    az, el = math.radians(az), math.radians(el)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def azimuth(x, y):
    return math.degrees(math.atan2(x, y))


def link(obj, coll):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    (A.collection(coll) if isinstance(coll, str) else coll).objects.link(obj)
    return obj


def mesh_object(name, bm, mats, coll="base", location=(0, 0, 0), smooth_shade=True, up=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if up:
        bm.normal_update()
        if sum(f.normal.z * f.calc_area() for f in bm.faces) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    if smooth_shade:
        for p in mesh.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    return link(obj, coll)


def instance(src, location, rotation=(0, 0, 0), scale=1.0, coll="base"):
    """A linked copy of `src` (sharing its mesh), placed and scaled."""
    obj = src.copy()
    (A.collection(coll) if isinstance(coll, str) else coll).objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
    return obj


def curve_object(name, splines, mat, coll="base", resolution=6, bevel_resolution=3):
    """One curve object from several splines, each a list of (x, y, z, radius)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_resolution
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    for pts in splines:
        sp = cu.splines.new("NURBS")
        sp.points.add(len(pts) - 1)
        for p, (x, y, z, r) in zip(sp.points, pts):
            p.co = (x, y, z, 1.0)
            p.radius = r
        sp.order_u = 4 if len(pts) >= 4 else len(pts)
        sp.use_endpoint_u = True
        sp.use_smooth = True
    cu.materials.append(mat)
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    return link(obj, coll)


def lathe(bm, profile, segs, origin=(0, 0, 0), radial=None, mat_of=None):
    """Revolve a profile [(r, z), ...] around Z into `bm`. `radial(phi, i)` scales the radius;
    `mat_of(i)` gives the material index of the band between profile points i and i+1."""
    ox, oy, oz = origin
    rings = []
    for i, (r, z) in enumerate(profile):
        if r <= 1e-6:
            rings.append([bm.verts.new((ox, oy, oz + z))])
            continue
        ring = []
        for j in range(segs):
            phi = 2 * math.pi * j / segs
            rr = r * (radial(phi, i) if radial else 1.0)
            ring.append(bm.verts.new((ox + rr * math.cos(phi), oy + rr * math.sin(phi), oz + z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        mi = mat_of(i) if mat_of else 0
        for j in range(segs):
            if len(a) == 1:
                verts = (a[0], b[j], b[(j + 1) % segs])
            elif len(b) == 1:
                verts = (a[j], a[(j + 1) % segs], b[0])
            else:
                verts = (a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j])
            f = bm.faces.new(verts)
            f.material_index = mi
    return bm


def tube(bm, pts, sides=8, mat_index=0, cap=True):
    """A tube along [(x, y, z, radius), ...] into `bm` (for the exported seat, where curves won't do)."""
    rings = []
    n = len(pts)
    for i, (x, y, z, r) in enumerate(pts):
        p = Vector((x, y, z))
        a = Vector(pts[max(i - 1, 0)][:3])
        b = Vector(pts[min(i + 1, n - 1)][:3])
        t = (b - a).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        v = t.cross(u).normalized()
        rings.append([bm.verts.new(p + r * (math.cos(2 * math.pi * k / sides) * u + math.sin(2 * math.pi * k / sides) * v))
                      for k in range(sides)])
    for i in range(n - 1):
        for k in range(sides):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
            f.material_index = mat_index
    if cap:
        f = bm.faces.new(list(reversed(rings[0])))
        f.material_index = mat_index
        f = bm.faces.new(rings[-1])
        f.material_index = mat_index


def ellipsoid(bm, centre, radii, segs=12, rings=8, mat_index=0, rotation_z=0.0, lumps=0.0, seed=0.0):
    cx, cy, cz = centre
    rx, ry, rz = radii
    c, s = math.cos(rotation_z), math.sin(rotation_z)
    verts = []
    top = bm.verts.new((cx, cy, cz + rz))
    for i in range(1, rings):
        th = math.pi * i / rings
        row = []
        for j in range(segs):
            ph = 2 * math.pi * j / segs
            x, y, z = math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)
            k = 1 + lumps * noise.noise(Vector((x * 2.3 + seed, y * 2.3, z * 2.3)))
            x, y, z = x * rx * k, y * ry * k, z * rz * k
            row.append(bm.verts.new((cx + c * x - s * y, cy + s * x + c * y, cz + z)))
        verts.append(row)
    bottom = bm.verts.new((cx, cy, cz - rz))
    for j in range(segs):
        bm.faces.new((top, verts[0][(j + 1) % segs], verts[0][j])).material_index = mat_index
        bm.faces.new((bottom, verts[-1][j], verts[-1][(j + 1) % segs])).material_index = mat_index
    for i in range(len(verts) - 1):
        for j in range(segs):
            bm.faces.new((verts[i][j], verts[i][(j + 1) % segs], verts[i + 1][(j + 1) % segs], verts[i + 1][j])).material_index = mat_index


def no_light_sampling(mat):
    """Small glowing bits: drawn, but not sampled as lights (point lights do the lighting)."""
    try:
        mat.cycles.emission_sampling = "NONE"
    except AttributeError:
        pass
    return mat


# ---------------------------------------------------------------- node helpers


def new_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    return mat, nt.nodes, nt.links, nt.nodes["Principled BSDF"]


def socket(links, value, target):
    if isinstance(value, (int, float)):
        target.default_value = value
    elif isinstance(value, tuple):
        target.default_value = value
    else:
        links.new(value, target)


def math_op(nodes, links, op, a, b=None, clamp=False):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    socket(links, a, n.inputs[0])
    if b is not None:
        socket(links, b, n.inputs[1])
    return n.outputs[0]


def vec_op(nodes, links, op, a, b=None):
    n = nodes.new("ShaderNodeVectorMath")
    n.operation = op
    socket(links, a, n.inputs[0])
    if b is not None:
        socket(links, b, n.inputs[1])
    return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]


def tex_noise(nodes, links, vec, scale, detail=4.0, roughness=0.55, distortion=0.0, color=False):
    n = nodes.new("ShaderNodeTexNoise")
    links.new(vec, n.inputs["Vector"])
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = roughness
    n.inputs["Distortion"].default_value = distortion
    return n.outputs[1] if color else n.outputs[0]


def tex_voronoi(nodes, links, vec, scale, randomness=1.0, output=0):
    n = nodes.new("ShaderNodeTexVoronoi")
    links.new(vec, n.inputs["Vector"])
    n.inputs["Scale"].default_value = scale
    n.inputs["Randomness"].default_value = randomness
    return n.outputs[output]


def ramp(nodes, links, fac, stops):
    n = nodes.new("ShaderNodeValToRGB")
    els = n.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = (*col, 1) if len(col) == 3 else col
    links.new(fac, n.inputs["Fac"])
    return n.outputs["Color"]


def map_range(nodes, links, value, a, b, c=0.0, d=1.0, smoothstep=False):
    n = nodes.new("ShaderNodeMapRange")
    if smoothstep:
        n.interpolation_type = "SMOOTHSTEP"
    socket(links, value, n.inputs["Value"])
    n.inputs["From Min"].default_value = a
    n.inputs["From Max"].default_value = b
    n.inputs["To Min"].default_value = c
    n.inputs["To Max"].default_value = d
    return n.outputs["Result"]


def scaled(nodes, links, vec, sx, sy, sz):
    n = nodes.new("ShaderNodeMapping")
    links.new(vec, n.inputs["Vector"])
    n.inputs["Scale"].default_value = (sx, sy, sz)
    return n.outputs["Vector"]


def mix_color(nodes, links, fac, a, b):
    n = nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    socket(links, fac, n.inputs["Factor"])
    socket(links, a if not isinstance(a, tuple) else (*a, 1), n.inputs[6])
    socket(links, b if not isinstance(b, tuple) else (*b, 1), n.inputs[7])
    return n.outputs[2]


def bump(nodes, links, bsdf, height, strength=0.4, distance=0.1):
    b = nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    links.new(height, b.inputs["Height"])
    links.new(b.outputs["Normal"], bsdf.inputs["Normal"])


# ---------------------------------------------------------------- materials


def bark_material():
    mat, nodes, links, bsdf = new_material("bark")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    fibres = tex_noise(nodes, links, scaled(nodes, links, coord, 5.0, 5.0, 0.45), 1.6, detail=8, roughness=0.62, distortion=0.4)
    blotch = tex_noise(nodes, links, coord, 0.35, detail=3)
    col = ramp(nodes, links, fibres, [(0.3, (0.03, 0.03, 0.045)), (0.55, (0.07, 0.066, 0.088)), (0.8, (0.12, 0.105, 0.125))])
    col = mix_color(nodes, links, map_range(nodes, links, blotch, 0.4, 0.7), col, (0.05, 0.06, 0.075))
    # Moss settles on whatever faces up.
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(nodes.new("ShaderNodeNewGeometry").outputs["Normal"], normal_z.inputs[0])
    moss_mask = math_op(nodes, links, "MULTIPLY", map_range(nodes, links, normal_z.outputs["Z"], 0.1, 0.6, smoothstep=True),
                        map_range(nodes, links, tex_noise(nodes, links, coord, 1.4, detail=5), 0.36, 0.52))
    moss = ramp(nodes, links, tex_noise(nodes, links, coord, 14.0, detail=4), [(0.3, (0.02, 0.06, 0.045)), (0.7, (0.05, 0.12, 0.08))])
    links.new(mix_color(nodes, links, moss_mask, col, moss), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.82
    height = math_op(nodes, links, "ADD", fibres, math_op(nodes, links, "MULTIPLY", moss_mask, 0.6))
    bump(nodes, links, bsdf, height, strength=0.55, distance=0.06)
    return mat


def ground_material():
    mat, nodes, links, bsdf = new_material("forest floor")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    large = tex_noise(nodes, links, coord, 0.18, detail=4)
    mid = tex_noise(nodes, links, coord, 1.3, detail=6, distortion=0.3)
    fine = tex_noise(nodes, links, coord, 22.0, detail=6)
    litter = tex_voronoi(nodes, links, coord, 9.0)
    moss = ramp(nodes, links, fine, [(0.2, (0.02, 0.05, 0.04)), (0.8, (0.07, 0.15, 0.11))])
    soil = ramp(nodes, links, mid, [(0.3, (0.025, 0.02, 0.028)), (0.7, (0.08, 0.06, 0.065))])
    mask = map_range(nodes, links, math_op(nodes, links, "ADD", large, math_op(nodes, links, "MULTIPLY", mid, 0.5)), 0.68, 0.82, smoothstep=True)
    col = mix_color(nodes, links, mask, moss, soil)
    col = mix_color(nodes, links, map_range(nodes, links, litter, 0.05, 0.18, 0.35, 0.0), col, (0.07, 0.05, 0.06))
    damp = map_range(nodes, links, tex_noise(nodes, links, coord, 0.45, detail=3), 0.5, 0.7, 0.0, 0.55)
    col = mix_color(nodes, links, damp, col, (0.012, 0.018, 0.02))
    links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Sheen Weight"].default_value = 0.2
    bsdf.inputs["Sheen Tint"].default_value = (0.4, 0.8, 0.7, 1)
    bump(nodes, links, bsdf, math_op(nodes, links, "ADD", fine, math_op(nodes, links, "MULTIPLY", litter, 0.6)), strength=0.6, distance=0.04)
    return mat


def water_material():
    mat, nodes, links, bsdf = new_material("water")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    bsdf.inputs["Base Color"].default_value = (0.004, 0.008, 0.01, 1)
    bsdf.inputs["Roughness"].default_value = 0.02
    bsdf.inputs["IOR"].default_value = 1.33
    bsdf.inputs["Specular IOR Level"].default_value = 0.6
    ripples = tex_noise(nodes, links, scaled(nodes, links, coord, 1.0, 1.0, 1.0), 1.1, detail=3)
    bump(nodes, links, bsdf, ripples, strength=0.035, distance=0.2)
    return mat


def leaf_material(name, color, translucency=0.35):
    mat, nodes, links, bsdf = new_material(name)
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    var = tex_noise(nodes, links, coord, 3.0, detail=3)
    col = mix_color(nodes, links, var, tuple(c * 0.6 for c in color), tuple(min(1, c * 1.5) for c in color))
    links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.6
    bsdf.inputs["Sheen Weight"].default_value = 0.4
    translucent = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(col, translucent.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = translucency
    links.new(bsdf.outputs[0], mix.inputs[1])
    links.new(translucent.outputs[0], mix.inputs[2])
    out = nodes["Material Output"]
    links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def canopy_material(index):
    """A layer of leaves high overhead: leafy clumps with gaps, opening wide over the forest ahead."""
    mat, nodes, links, bsdf = new_material(f"canopy {index}")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    bsdf.inputs["Base Color"].default_value = (0.012, 0.028, 0.03, 1)
    bsdf.inputs["Roughness"].default_value = 0.7
    clumps = tex_noise(nodes, links, coord, 0.09 + 0.03 * index, detail=6, roughness=0.6, distortion=0.25)
    leaves = tex_voronoi(nodes, links, coord, 3.5 + index)
    density = math_op(nodes, links, "SUBTRACT", clumps, math_op(nodes, links, "MULTIPLY", leaves, 0.25))
    # The opening ahead.
    ox, oy = OPENING
    rel = vec_op(nodes, links, "SUBTRACT", coord, (ox, oy, 0.0))
    ahead = math_op(nodes, links, "SUBTRACT", nodes_sep(nodes, links, rel, "Y"),
                    math_op(nodes, links, "MULTIPLY", math_op(nodes, links, "ABSOLUTE", nodes_sep(nodes, links, rel, "X")), 0.37))
    ahead = math_op(nodes, links, "ADD", ahead, math_op(nodes, links, "MULTIPLY", tex_noise(nodes, links, coord, 0.08, detail=3), 9.0))
    opening = map_range(nodes, links, ahead, 4.5, -1.5, 0.0, 1.0)  # 0 in the opening
    solid = math_op(nodes, links, "GREATER_THAN", density, 0.44 + 0.04 * index)
    alpha = math_op(nodes, links, "MULTIPLY", solid, opening)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(alpha, mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(bsdf.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes["Material Output"].inputs["Surface"])
    return mat


def crown_material():
    """Leaf masses in the treetops: dense clumps with ragged, see-through edges."""
    mat, nodes, links, bsdf = new_material("crown")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    bsdf.inputs["Base Color"].default_value = (0.006, 0.014, 0.017, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Specular IOR Level"].default_value = 0.2
    clumps = tex_noise(nodes, links, coord, 1.6, detail=6, roughness=0.65, distortion=0.3)
    leaves = tex_voronoi(nodes, links, coord, 14.0)
    density = math_op(nodes, links, "SUBTRACT", clumps, math_op(nodes, links, "MULTIPLY", leaves, 0.3))
    solid = math_op(nodes, links, "GREATER_THAN", density, 0.36)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    translucent = nodes.new("ShaderNodeBsdfTranslucent")
    translucent.inputs["Color"].default_value = (0.01, 0.035, 0.03, 1)
    leaf = nodes.new("ShaderNodeMixShader")
    leaf.inputs[0].default_value = 0.3
    links.new(bsdf.outputs[0], leaf.inputs[1])
    links.new(translucent.outputs[0], leaf.inputs[2])
    mix = nodes.new("ShaderNodeMixShader")
    links.new(solid, mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(leaf.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes["Material Output"].inputs["Surface"])
    return mat


def glow_material(name, color, strength, pale=0.0):
    """A glowing plant: emissive, a little paler at its heart."""
    mat, nodes, links, bsdf = new_material(name)
    emit = nodes.new("ShaderNodeEmission")
    lw = nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    core = mix_color(nodes, links, lw.outputs["Facing"], tuple(c + (1 - c) * pale for c in color), color)
    links.new(core, emit.inputs["Color"])
    emit.inputs["Strength"].default_value = strength
    links.new(emit.outputs[0], nodes["Material Output"].inputs["Surface"])
    return mat


def moss_glow_material(name, color, strength):
    """Glowing moss: specks of light that thin out towards the patch's edge (object space, patch radius 1)."""
    mat, nodes, links, bsdf = new_material(name)
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    radial = map_range(nodes, links, vec_op(nodes, links, "LENGTH", scaled(nodes, links, coord, 1, 1, 0)), 0.2, 1.0, 1.0, 0.0, smoothstep=True)
    specks = map_range(nodes, links, tex_voronoi(nodes, links, coord, 34.0), 0.0, 0.4, 1.0, 0.0)
    specks = math_op(nodes, links, "ADD", math_op(nodes, links, "POWER", specks, 2.0), 0.04)
    clump = map_range(nodes, links, tex_noise(nodes, links, coord, 2.5, detail=4), 0.4, 0.62)
    fac = math_op(nodes, links, "MULTIPLY", math_op(nodes, links, "MULTIPLY", specks, clump), radial)
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    links.new(math_op(nodes, links, "MULTIPLY", fac, strength), emit.inputs["Strength"])
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    add = nodes.new("ShaderNodeAddShader")
    links.new(transparent.outputs[0], add.inputs[0])
    links.new(emit.outputs[0], add.inputs[1])
    links.new(add.outputs[0], nodes["Material Output"].inputs["Surface"])
    return no_light_sampling(mat)


def mist_material(name, density, color=(0.7, 0.85, 1.0)):
    """Even, thin mist (a constant density renders far faster than a textured one)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    vol = nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*color, 1)
    vol.inputs["Anisotropy"].default_value = 0.35
    vol.inputs["Density"].default_value = density
    links.new(vol.outputs[0], out.inputs["Volume"])
    return mat


def mist_shell(name, height, mat, radius=92.0):
    """A closed layer of mist hugging the forest floor up to `height` above it."""
    bm = bmesh.new()
    segs = 96
    radii = [0.0]
    r = 1.0
    while r < radius:
        radii.append(r)
        r = r * 1.12 + 0.5
    radii.append(radius)

    def surface(offset):
        rings = []
        for rr in radii:
            if rr == 0:
                rings.append([bm.verts.new((0, 0, ground_z(0, 0) + offset))])
                continue
            rings.append([bm.verts.new((rr * math.cos(2 * math.pi * j / segs), rr * math.sin(2 * math.pi * j / segs),
                                        ground_z(rr * math.cos(2 * math.pi * j / segs), rr * math.sin(2 * math.pi * j / segs)) + offset))
                          for j in range(segs)])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for j in range(segs):
                if len(a) == 1:
                    bm.faces.new((a[0], b[j], b[(j + 1) % segs]))
                else:
                    bm.faces.new((a[j], b[j], b[(j + 1) % segs], a[(j + 1) % segs]))
        return rings[-1]

    top = surface(height)
    bottom = surface(-1.0)
    for j in range(segs):
        bm.faces.new((top[j], top[(j + 1) % segs], bottom[(j + 1) % segs], bottom[j]))
    return mesh_object(name, bm, [mat], smooth_shade=False)


# ---------------------------------------------------------------- sky


def sky(nodes, links):
    """Night sky: a deep blue gradient, stars, a faint band of nebula and two pale moons."""
    d = nodes.new("ShaderNodeTexCoord").outputs["Generated"]
    d = vec_op(nodes, links, "NORMALIZE", d)
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(d, sep.inputs[0])
    el = sep.outputs["Z"]
    col = ramp(nodes, links, map_range(nodes, links, el, -0.05, 0.9),
               [(0.0, (0.03, 0.06, 0.09)), (0.25, (0.012, 0.022, 0.05)), (1.0, (0.003, 0.005, 0.016))])

    # Stars, two sizes; each star its own brightness and tint.
    for scale, size, power in ((140.0, 0.07, 120.0), (420.0, 0.1, 40.0)):
        dist = tex_voronoi(nodes, links, d, scale)
        cell = tex_voronoi(nodes, links, d, scale, output=1)
        star = map_range(nodes, links, dist, 0.0, size, 1.0, 0.0)
        star = math_op(nodes, links, "POWER", star, 3.0)
        bright = map_range(nodes, links, nodes_sep(nodes, links, cell, "X"), 0.55, 1.0, 0.0, power)
        tint = mix_color(nodes, links, nodes_sep(nodes, links, cell, "Y"), (0.75, 0.85, 1.0), (1.0, 0.9, 0.85))
        amount = math_op(nodes, links, "MULTIPLY", star, bright)
        col = add_colors(nodes, links, col, tint, amount)

    # A faint band of glowing dust across the sky, teal fading to violet.
    band_axis = Vector((0.55, -0.25, 0.8)).normalized()
    across = math_op(nodes, links, "ABSOLUTE", vec_op(nodes, links, "DOT_PRODUCT", d, tuple(band_axis)))
    band = map_range(nodes, links, across, 0.0, 0.32, 1.0, 0.0, smoothstep=True)
    dust = tex_noise(nodes, links, d, 3.0, detail=8, roughness=0.62, distortion=0.4)
    band = math_op(nodes, links, "MULTIPLY", band, map_range(nodes, links, dust, 0.4, 0.75))
    band_col = mix_color(nodes, links, tex_noise(nodes, links, d, 1.2, detail=2), (0.1, 0.5, 0.6), (0.45, 0.2, 0.7))
    col = add_colors(nodes, links, col, band_col, math_op(nodes, links, "MULTIPLY", band, 0.05))

    col = moon(nodes, links, d, col, MOON, (0.9, 0.94, 1.0), 3.2, light=Vector((0.55, 0.15, 0.82)), halo=0.22, seed=1.0)
    col = moon(nodes, links, d, col, MOON2, (0.95, 0.86, 1.0), 2.6, light=Vector((-0.7, 0.2, 0.68)), halo=0.08, seed=5.0)
    path = nodes.new("ShaderNodeLightPath")
    seen = math_op(nodes, links, "MAXIMUM", path.outputs["Is Camera Ray"], path.outputs["Is Glossy Ray"])
    fill = mix_color(nodes, links, map_range(nodes, links, el, -0.2, 1.0), (0.02, 0.035, 0.05), AMBIENT)
    return mix_color(nodes, links, seen, fill, col)


def nodes_sep(nodes, links, vec, axis):
    s = nodes.new("ShaderNodeSeparateXYZ")
    links.new(vec, s.inputs[0])
    return s.outputs[axis]


def add_colors(nodes, links, base, color, amount):
    n = nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = "ADD"
    socket(links, amount, n.inputs["Factor"])
    links.new(base, n.inputs[6])
    socket(links, color if not isinstance(color, tuple) else (*color, 1), n.inputs[7])
    return n.outputs[2]


def moon(nodes, links, d, col, where, tint, strength, light, halo, seed):
    """A moon disc: lit on one side (a gibbous phase), cratered, with a soft halo."""
    az, el, radius = where
    centre = direction(az, el)
    east = Vector((0, 0, 1)).cross(centre).normalized()
    north = centre.cross(east).normalized()
    k = 1 / math.tan(math.radians(radius))
    u = math_op(nodes, links, "MULTIPLY", vec_op(nodes, links, "DOT_PRODUCT", d, tuple(east)), k)
    v = math_op(nodes, links, "MULTIPLY", vec_op(nodes, links, "DOT_PRODUCT", d, tuple(north)), k)
    facing = vec_op(nodes, links, "DOT_PRODUCT", d, tuple(centre))
    r2 = math_op(nodes, links, "ADD", math_op(nodes, links, "MULTIPLY", u, u), math_op(nodes, links, "MULTIPLY", v, v))
    inside = math_op(nodes, links, "MULTIPLY", map_range(nodes, links, r2, 1.0, 0.94, 0.0, 1.0),
                     math_op(nodes, links, "GREATER_THAN", facing, 0.0))
    w = math_op(nodes, links, "SQRT", math_op(nodes, links, "MAXIMUM", math_op(nodes, links, "SUBTRACT", 1.0, r2), 0.0))
    lx, ly, lz = light.normalized()
    lit = math_op(nodes, links, "ADD", math_op(nodes, links, "MULTIPLY", u, lx),
                  math_op(nodes, links, "ADD", math_op(nodes, links, "MULTIPLY", v, ly), math_op(nodes, links, "MULTIPLY", w, lz)))
    lit = map_range(nodes, links, lit, -0.05, 0.35, 0.03, 1.0, smoothstep=True)
    uv = nodes.new("ShaderNodeCombineXYZ")
    links.new(u, uv.inputs[0])
    links.new(v, uv.inputs[1])
    uv.inputs[2].default_value = seed
    maria = map_range(nodes, links, tex_noise(nodes, links, uv.outputs[0], 1.6, detail=5), 0.35, 0.7, 0.55, 1.0)
    craters = map_range(nodes, links, tex_voronoi(nodes, links, uv.outputs[0], 7.0), 0.0, 0.25, 0.75, 1.0)
    surface = math_op(nodes, links, "MULTIPLY", maria, craters)
    amount = math_op(nodes, links, "MULTIPLY", math_op(nodes, links, "MULTIPLY", inside, lit), math_op(nodes, links, "MULTIPLY", surface, strength))
    col = add_colors(nodes, links, col, tint, amount)
    # Halo: light scattered around the disc.
    for width, amount in ((2.5, halo), (12.0, halo * 0.12)):
        glow = math_op(nodes, links, "POWER", math_op(nodes, links, "MAXIMUM", facing, 0.0), 1.0 / (1 - math.cos(math.radians(radius * width))))
        col = add_colors(nodes, links, col, (0.5, 0.65, 0.95), math_op(nodes, links, "MULTIPLY", glow, amount))
    return col


# ---------------------------------------------------------------- the forest


def build():
    A.world(strength=1.0, shader=sky)
    scene = bpy.context.scene
    scene.cycles.transparent_max_bounces = 12
    scene.cycles.max_bounces = 5
    bloom(scene)

    bark = bark_material()
    floor_mat = ground_material()
    stalk = A.material("stalk", (0.04, 0.07, 0.06), roughness=0.6, sheen=0.4)
    vine_mat = A.material("vine", (0.03, 0.045, 0.04), roughness=0.75)
    fern_mat = leaf_material("fern", (0.03, 0.085, 0.065))
    leaf_mat = leaf_material("big leaf", (0.025, 0.06, 0.07), translucency=0.45)

    terrain(floor_mat)
    A.plane((2 * POOL[2] + 3, 2 * POOL[3] + 3), (POOL[0], POOL[1], WATER_Z), water_material(), name="pool")

    # Moonlight, through the opening in the canopy.
    sun = bpy.data.lights.new("moonlight", "SUN")
    sun.color = MOONLIGHT
    sun.energy = 2.2
    sun.angle = math.radians(5.0)
    moon_obj = bpy.data.objects.new("moonlight", sun)
    A.collection("base").objects.link(moon_obj)
    moon_obj.rotation_euler = direction(MOON[0], MOON[1]).to_track_quat("Z", "Y").to_euler()

    for i, z in enumerate(CANOPY_Z):
        A.plane((300, 300), (0, 0, z), canopy_material(i), name="canopy")

    GLOW_SPOTS.clear()
    trees = forest(bark)
    glow = Glow()
    for t in trees:
        if t["near"]:
            decorate_tree(t, glow)
    undergrowth(glow, stalk, fern_mat, leaf_mat, bark)
    vines(trees, vine_mat, glow)
    motes()

    mist_shell("mist low", 1.3, mist_material("mist low", 0.016))
    mist_shell("mist", 5.0, mist_material("mist high", 0.0075))

    build_seat()


def bloom(scene):
    """A soft glow around the brightest things, as the eye sees glowing plants in the dark."""
    tree = bpy.data.node_groups.new("bloom", "CompositorNodeTree")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Threshold"].default_value = 0.6
    glare.inputs["Strength"].default_value = 0.35
    glare.inputs["Size"].default_value = 0.5
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs[0], out.inputs[0])
    scene.compositing_node_group = tree


def terrain(mat):
    bm = bmesh.new()
    segs = 220
    radii = [0.0]
    r = 0.35
    while r < 140:
        radii.append(r)
        r *= 1.045 if r > 3 else 1.0
        r += 0.12 if r <= 3 else 0.0
    rings = []
    for r in radii:
        if r == 0:
            rings.append([bm.verts.new((0, 0, ground_z(0, 0)))])
            continue
        ring = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            x, y = r * math.cos(a), r * math.sin(a)
            ring.append(bm.verts.new((x, y, ground_z(x, y))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(segs):
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[(j + 1) % segs]))
            else:
                bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    mesh_object("forest floor", bm, [mat], up=True)


def tree_strand(t, cx, cy, gz, radius, height, th0, twist, lean):
    z = gz - 0.6 + (height + 0.6) * t
    h = z - gz
    flare = 1 + 1.5 * math.exp(-max(h, 0) / 2.4)
    spread = 1 + 3.2 * smooth(0.78, 1.0, t)
    R = radius * 0.55 * flare * spread
    th = th0 + twist * 2 * math.pi * t
    bend = math.sin(math.pi * t * 0.9)
    x = cx + lean[0] * bend + R * math.cos(th)
    y = cy + lean[1] * bend + R * math.sin(th)
    rad = radius * 0.5 * (1 + 0.8 * math.exp(-max(h, 0) / 1.8)) * (1 - 0.6 * t)
    return x, y, z, rad, th


def forest(bark):
    """Giant trees of braided, twisting trunks with arching roots, in rings around the clearing."""
    placements = [
        # (distance, azimuth, trunk radius): the near ring, framing the clearing.
        (14.5, 41, 1.7), (13.5, -44, 1.9), (17, 66, 1.4), (14, -76, 1.5), (12, 102, 1.3),
        (15.5, -108, 1.7), (12.5, 142, 1.5), (14.5, -148, 1.4), (11, 178, 1.9), (19, 122, 1.2),
        (20, -128, 1.3), (21, 86, 1.5), (22, -62, 1.2), (24, 55, 1.1),
    ]
    r = random.Random(5)
    for _ in range(16):  # the middle ring
        for _attempt in range(30):
            d, az = r.uniform(25, 38), r.uniform(-180, 180)
            if abs(az) < 26 and d < 34:
                continue
            break
        placements.append((d, az, r.uniform(1.1, 1.8)))
    for _ in range(120):  # the far forest, fading into the mist
        placements.append((r.uniform(38, 95), r.uniform(-180, 180), r.uniform(1.2, 2.4)))

    bm = bmesh.new()
    ellipsoid(bm, (0, 0, 0), (1, 1, 1), segs=18, rings=10, lumps=0.25)
    crown = mesh_object("crown", bm, [crown_material()], location=(0, 0, -300))
    for k in range(140):
        d, az = r.uniform(24, 80), r.uniform(-180, 180)
        if abs(az) < 24 and d < 32:
            continue
        x, y = d * math.sin(math.radians(az)), d * math.cos(math.radians(az))
        sc = r.uniform(1.6, 4.0) * (1 + d / 60)
        instance(crown, (x, y, ground_z(x, y) + sc * r.uniform(0.1, 0.9)), (0, 0, r.uniform(0, 6.3)),
                 (sc * r.uniform(1.2, 2.2), sc * r.uniform(1.0, 1.6), sc * r.uniform(0.6, 1.0)))
    trees = []
    for i, (d, az, radius) in enumerate(placements):
        near = d < 26
        cx, cy = d * math.sin(math.radians(az)), d * math.cos(math.radians(az))
        gz = ground_z(cx, cy)
        tr = random.Random(100 + i)
        height = CANOPY_Z[1] + tr.uniform(-2, 4) - gz * 0.3
        if d > 26 and abs(az) < 70:
            # The forest ahead makes a skyline a little above the screen, under the moons.
            skyline = math.tan(math.radians(tr.uniform(17, 29) + 0.06 * abs(az))) * d + A.EYE_HEIGHT
            height = min(height, skyline - gz - radius * 2.5)
        n = tr.choice((3, 4, 4, 5))
        twist = tr.uniform(0.45, 1.0) * tr.choice((-1, 1))
        lean = (tr.uniform(-1, 1) * radius * 1.4, tr.uniform(-1, 1) * radius * 1.4)
        strands = []
        splines = []
        steps = 26 if near else 14
        for k in range(n):
            th0 = 2 * math.pi * k / n + tr.uniform(-0.3, 0.3)
            params = (cx, cy, gz, radius * tr.uniform(0.9, 1.1), height * tr.uniform(0.92, 1.05), th0, twist, lean)
            strands.append(params)
            splines.append([tree_strand(j / steps, *params)[:4] for j in range(steps + 1)])
        roots = tr.randint(4, 7) if near else tr.randint(3, 5)
        for j in range(roots):
            a = 2 * math.pi * j / roots + tr.uniform(-0.35, 0.35)
            length = tr.uniform(1.5, 4.5) * (1.0 if near else 0.8)
            pts = []
            for s, (dd, hh, rr) in enumerate(((0.8, 2.6, 0.36), (1.5, 2.0, 0.33), (2.3, 1.2, 0.27), (3.0, 0.7, 0.2))):
                wob = 0.12 * s * tr.uniform(-1, 1)
                px = cx + radius * dd * math.cos(a + wob)
                py = cy + radius * dd * math.sin(a + wob)
                pts.append((px, py, ground_z(px, py) + hh * radius * 0.55, rr * radius))
            for s, f in enumerate((0.4, 0.75, 1.0)):
                dd = radius * 3.0 + length * f
                px, py = cx + dd * math.cos(a + 0.1 * s), cy + dd * math.sin(a + 0.1 * s)
                pts.append((px, py, ground_z(px, py) + (0.35, 0.1, -0.35)[s], radius * (0.15, 0.1, 0.05)[s]))
            splines.append(pts)
        far = d > 60
        curve_object("tree", splines, bark, resolution=6 if near else (2 if far else 3), bevel_resolution=4 if near else (1 if far else 2))
        for params in strands:
            for tt, size in ((1.0, 1.0), (0.93, 0.6), (0.86, 0.45)):
                if size < 1 and tr.random() < 0.4:
                    continue
                x, y, z, rad, th = tree_strand(tt, *params)
                sc = radius * tr.uniform(1.3, 2.6) * size
                instance(crown, (x + tr.uniform(-1.5, 1.5), y + tr.uniform(-1.5, 1.5), z + sc * tr.uniform(-0.2, 0.4)),
                         (0, tr.uniform(-0.3, 0.3), tr.uniform(0, 6.3)), (sc * tr.uniform(1.0, 1.7), sc * tr.uniform(0.8, 1.4), sc * tr.uniform(0.45, 0.8)))
        trees.append({"x": cx, "y": cy, "gz": gz, "radius": radius, "strands": strands, "near": near, "d": d, "az": az})
    return trees


class Glow:
    """The glowing plants' shared meshes and materials, all in the glow layer."""

    def __init__(self):
        self.layer = A.layer("glow")
        self.mats = {
            "cyan": glow_material("glow cyan", CYAN, 1.5, pale=0.08),
            "turquoise": glow_material("glow turquoise", TURQUOISE, 1.3, pale=0.06),
            "aqua": glow_material("glow aqua", AQUA, 1.1, pale=0.05),
            "violet": glow_material("glow violet", VIOLET, 2.0, pale=0.08),
            "magenta": glow_material("glow magenta", MAGENTA, 1.6, pale=0.08),
        }
        self.mushroom_stem = A.material("mushroom stem", (0.35, 0.32, 0.42), roughness=0.5,
                                        emission=(0.45, 0.4, 0.9), strength=0.12)
        self.vine = glow_material("glow creeper", (0.1, 0.9, 0.85), 2.2, pale=0.0)
        self.frond = {name: glow_material(f"frond {name}", col, 1.1, pale=0.0) for name, col in
                      (("turquoise", TURQUOISE), ("cyan", CYAN), ("violet", VIOLET))}
        self.mushrooms = {name: self.mushroom_mesh(name) for name in ("cyan", "violet", "magenta", "turquoise")}
        self.bulbs = {name: self.bulb_mesh(name) for name in ("cyan", "violet", "magenta", "aqua")}
        self.shelf = self.shelf_mesh()
        self.moss = {name: moss_glow_material(f"moss {name}", col, s) for name, col, s in
                     (("turquoise", TURQUOISE, 4.0), ("cyan", CYAN, 4.0), ("violet", VIOLET, 4.5))}

    def mushroom_mesh(self, name):
        bm = bmesh.new()
        profile = [(0.0, 0.0), (0.2, 0.0), (0.19, 0.5), (0.15, 1.2), (0.16, 1.5), (0.35, 1.5), (0.72, 1.45),
                   (0.97, 1.38), (1.02, 1.47), (0.92, 1.64), (0.7, 1.8), (0.4, 1.9), (0.0, 1.93)]
        lathe(bm, profile, 18, mat_of=lambda i: 0 if i < 4 else 1)
        obj = mesh_object(f"mushroom {name}", bm, [self.mushroom_stem, self.mats[name]], coll=self.layer, location=(0, 0, -200))
        return obj

    def bulb_mesh(self, name):
        bm = bmesh.new()
        profile = [(0.0, 1.0), (0.25, 0.95), (0.55, 0.72), (0.8, 0.3), (0.85, -0.1), (0.62, -0.5), (0.3, -0.8), (0.0, -0.9)]
        lathe(bm, profile, 16)
        return mesh_object(f"bulb {name}", bm, [self.mats[name]], coll=self.layer, location=(0, 0, -200))

    def shelf_mesh(self):
        bm = bmesh.new()
        ellipsoid(bm, (0.5, 0, 0), (0.55, 0.75, 0.16), segs=16, rings=8)
        return mesh_object("shelf", bm, [self.mats["aqua"]], coll=self.layer, location=(0, 0, -200))

    def mushroom_cluster(self, x, y, size, color, count, spread=None, light=True):
        r = random.Random(int(x * 1000 + y * 77))
        spread = spread or size * 2.5
        for _ in range(count):
            a, d = r.uniform(0, 2 * math.pi), r.uniform(0, spread)
            px, py = x + d * math.cos(a), y + d * math.sin(a)
            s = size * r.uniform(0.45, 1.0)
            instance(self.mushrooms[color], (px, py, ground_z(px, py) - 0.02),
                     (r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.15), r.uniform(0, 6.3)), s, coll=self.layer)
        if light:
            self.light(x, y, ground_z(x, y) + size * 2.2, color, 40 * size + 10 * count * size)

    def light(self, x, y, z, color, power, radius=0.4):
        GLOW_SPOTS.append((x, y))
        col = {"cyan": CYAN, "turquoise": TURQUOISE, "aqua": AQUA, "violet": VIOLET, "magenta": MAGENTA}[color]
        A.point_light((x, y, z), col, power, radius=radius, coll=self.layer, name="glow light")


def decorate_tree(t, glow):
    """Glowing vines along a near tree's strands, shelf fungi on its bark, mushrooms among its roots."""
    r = random.Random(int(t["x"] * 31 + t["y"] * 7))
    vine_splines = []
    for params in t["strands"] if GLOW_CREEPERS else ():
        if r.random() < 0.35:
            continue
        phase = r.uniform(0, 6.3)
        turns = r.uniform(2.5, 4.5) * r.choice((-1, 1))
        pts = []
        t0, t1 = r.uniform(0.01, 0.04), r.uniform(0.12, 0.22)
        for j in range(60):
            tt = t0 + (t1 - t0) * j / 59
            x, y, z, rad, th = tree_strand(tt, *params)
            off = th + 1.1 * math.sin(phase + turns * 2 * math.pi * j / 59)
            fade = math.sin(math.pi * j / 59) ** 0.5
            pts.append((x + (rad * 0.97) * math.cos(off), y + (rad * 0.97) * math.sin(off), z, 0.011 * fade + 0.003))
        vine_splines.append(pts)
    if vine_splines:
        curve_object("glow vine", vine_splines, glow.vine, coll=glow.layer, resolution=3, bevel_resolution=1)
    # Shelf fungi, in little stacks.
    for _ in range(r.randint(1, 3)):
        params = r.choice(t["strands"])
        tt = r.uniform(0.04, 0.16)
        for k in range(r.randint(3, 6)):
            x, y, z, rad, th = tree_strand(tt + k * 0.006, *params)
            a = th + r.uniform(-0.6, 0.6)
            s = r.uniform(0.12, 0.3)
            instance(glow.shelf, (x + rad * 0.9 * math.cos(a), y + rad * 0.9 * math.sin(a), z + k * 0.05),
                     (0, r.uniform(-0.1, 0.1), a), s, coll=glow.layer)
        x, y, z, rad, th = tree_strand(tt, *params)
        glow.light(x + (rad + 0.6) * math.cos(th), y + (rad + 0.6) * math.sin(th), z, "aqua", 35)
    # Mushrooms among the roots, on the side facing the clearing.
    towards = math.atan2(-t["y"], -t["x"])
    for k in range(r.randint(1, 3)):
        a = towards + r.uniform(-1.0, 1.0)
        d = t["radius"] * r.uniform(1.8, 3.2)
        x, y = t["x"] + d * math.cos(a), t["y"] + d * math.sin(a)
        color = r.choice(("violet", "magenta", "cyan", "violet"))
        giant = k == 0 and r.random() < 0.5
        glow.mushroom_cluster(x, y, r.uniform(0.6, 1.1) if giant else r.uniform(0.12, 0.3), color,
                              r.randint(2, 4) if giant else r.randint(5, 11))
    # Light on the trunk from below, as the glowing floor would give.
    glow.light(t["x"] + (t["radius"] * 2.5) * math.cos(towards), t["y"] + (t["radius"] * 2.5) * math.sin(towards),
               t["gz"] + 0.5, r.choice(("cyan", "violet", "turquoise", "cyan")), 220, radius=1.0)


def clearing_spot(r, dmin, dmax, front_clear=34):
    """A random spot in the clearing's ring, kept out of the view ahead (the screen and the pool)."""
    for _ in range(200):
        d = math.sqrt(r.uniform(dmin * dmin, dmax * dmax))
        az = r.uniform(-180, 180)
        if abs(az) < front_clear:
            continue
        x, y = d * math.sin(math.radians(az)), d * math.cos(math.radians(az))
        px, py, rx, ry = POOL
        if ((x - px) / (rx + 0.6)) ** 2 + ((y - py) / (ry + 0.6)) ** 2 < 1:
            continue
        return x, y
    return dmax, 0


def fern_mesh(name, mat, fronds, seed):
    r = random.Random(seed)
    bm = bmesh.new()
    for f in range(fronds):
        az = 2 * math.pi * f / fronds + r.uniform(-0.25, 0.25)
        el = math.radians(r.uniform(35, 70))
        length = r.uniform(0.75, 1.1)
        droop = r.uniform(0.5, 0.9)
        dirh = Vector((math.cos(az), math.sin(az), 0))
        side = Vector((-math.sin(az), math.cos(az), 0))

        def rib(s):
            return dirh * (length * s * math.cos(el)) + Vector((0, 0, length * (s * math.sin(el) - droop * s * s)))

        n = 16
        prev = None
        for i in range(n + 1):
            s = i / n
            p = rib(s)
            tng = (rib(min(s + 0.02, 1)) - rib(max(s - 0.02, 0))).normalized()
            w = 0.006 * (1 - s)
            a, b = bm.verts.new(p - side * w), bm.verts.new(p + side * w)
            if prev:
                bm.faces.new((prev[0], prev[1], b, a))
            prev = (a, b)
            if 0 < i < n:
                pl = 0.24 * length * math.sin(math.pi * (0.15 + 0.85 * s)) * (1 - 0.6 * s)
                for sd in (-1, 1):
                    base1 = p - tng * 0.018
                    base2 = p + tng * 0.018
                    tip = p + side * sd * pl + tng * pl * 0.35 - Vector((0, 0, pl * 0.25))
                    mid1 = (base1 + tip) / 2 + side * sd * 0.0 - tng * pl * 0.12
                    mid2 = (base2 + tip) / 2 + tng * pl * 0.12
                    v = [bm.verts.new(q) for q in (base1, mid1, tip, mid2, base2)]
                    bm.faces.new(v)
    return mesh_object(name, bm, [mat], location=(0, 0, -200))


def leaf_mesh(name, mat, seed):
    """A big, broad, heart-shaped leaf on a stalk, arching out and drooping."""
    r = random.Random(seed)
    bm = bmesh.new()
    nu, nv = 14, 8
    length, width = 1.0, 0.62
    grid = []
    for i in range(nu + 1):
        s = i / nu
        row = []
        half = width * math.sin(math.pi * min(1, s * 1.05)) ** 0.8 * (1 - 0.25 * s)
        for j in range(nv + 1):
            v = j / nv * 2 - 1
            x = 0.35 + s * length * 0.9
            y = v * half
            z = 0.55 + s * 0.25 - 0.55 * s * s - 0.12 * abs(v) ** 1.5 + 0.03 * math.sin(v * 9 + s * 4)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    tube(bm, [(0, 0, 0, 0.025), (0.12, 0, 0.35, 0.022), (0.28, 0, 0.53, 0.018), (0.38, 0, 0.56, 0.014)], sides=6)
    return mesh_object(name, bm, [mat], location=(0, 0, -200))


def tuft_mesh(name, mat, seed):
    """A tuft of slender, arching blades."""
    r = random.Random(seed)
    bm = bmesh.new()
    for _ in range(26):
        a = r.uniform(0, 2 * math.pi)
        h = r.uniform(0.35, 0.75)
        lean = r.uniform(0.15, 0.45)
        w = r.uniform(0.008, 0.014)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        base = d * r.uniform(0, 0.08)
        prev = None
        for i in range(6):
            s = i / 5
            p = base + d * (lean * h * s * s) + Vector((0, 0, h * (s - 0.25 * s * s)))
            ww = w * (1 - s * 0.95)
            pair = (bm.verts.new(p - side * ww), bm.verts.new(p + side * ww))
            if prev:
                bm.faces.new((prev[0], prev[1], pair[1], pair[0]))
            prev = pair
    return mesh_object(name, bm, [mat], location=(0, 0, -200))


def fallen_log(x, y, angle, length, radius, bark, glow):
    """A mossy fallen trunk lying across the forest floor, shelf fungi along its side."""
    r = random.Random(int(x * 13 + y))
    ca, sa = math.cos(angle), math.sin(angle)
    pts = []
    for i in range(9):
        s = i / 8 - 0.5
        px, py = x + ca * s * length + 0.3 * math.sin(s * 5) * -sa, y + sa * s * length + 0.3 * math.sin(s * 5) * ca
        pts.append((px, py, ground_z(px, py) + radius * 0.75, radius * (1.1 - 0.4 * (s + 0.5))))
    curve_object("fallen log", [pts], bark, resolution=8, bevel_resolution=5)
    for k in range(r.randint(5, 9)):
        s = r.uniform(-0.4, 0.4)
        side = r.choice((-1, 1))
        px, py = x + ca * s * length, y + sa * s * length
        rad = radius * (1.1 - 0.4 * (s + 0.5))
        instance(glow.shelf, (px - sa * side * rad * 0.9, py + ca * side * rad * 0.9, ground_z(px, py) + radius * r.uniform(0.6, 1.1)),
                 (0, 0, angle + side * math.pi / 2), r.uniform(0.1, 0.2), coll=glow.layer)
    glow.mushroom_cluster(x + ca * length * 0.3, y + sa * length * 0.3, 0.12, "magenta", 8)
    glow.light(x, y, ground_z(x, y) + radius * 2.2, "aqua", 40, radius=0.5)


def stone_material():
    mat, nodes, links, bsdf = new_material("stone")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    grain = tex_noise(nodes, links, coord, 6.0, detail=8, roughness=0.6)
    col = ramp(nodes, links, grain, [(0.3, (0.05, 0.055, 0.07)), (0.7, (0.13, 0.13, 0.15))])
    normal_z = nodes_sep(nodes, links, nodes.new("ShaderNodeNewGeometry").outputs["Normal"], "Z")
    moss = map_range(nodes, links, math_op(nodes, links, "ADD", normal_z, math_op(nodes, links, "MULTIPLY", tex_noise(nodes, links, coord, 3.0), 0.6)), 0.6, 0.95, smoothstep=True)
    links.new(mix_color(nodes, links, moss, col, (0.05, 0.12, 0.085)), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bump(nodes, links, bsdf, grain, strength=0.5, distance=0.05)
    return mat


def sorrel_mesh(name, mat, seed):
    """Low round leaves on short stalks, held flat like little umbrellas."""
    r = random.Random(seed)
    bm = bmesh.new()
    for _ in range(r.randint(5, 9)):
        a, d = r.uniform(0, 6.3), r.uniform(0.0, 0.07)
        h = r.uniform(0.04, 0.14)
        x, y = d * math.cos(a), d * math.sin(a)
        tube(bm, [(x, y, 0, 0.003), (x, y, h, 0.0025)], sides=4)
        for k in range(3):
            la = a + k * 2.1 + r.uniform(-0.2, 0.2)
            ellipsoid(bm, (x + 0.022 * math.cos(la), y + 0.022 * math.sin(la), h + 0.004), (0.026, 0.02, 0.003),
                      segs=8, rings=4, rotation_z=la)
    return mesh_object(name, bm, [mat], location=(0, 0, -200))


def litter_mesh(name, mat, seed):
    """Fallen leaves lying on the moss."""
    r = random.Random(seed)
    bm = bmesh.new()
    for _ in range(12):
        a, d = r.uniform(0, 6.3), r.uniform(0, 0.3)
        x, y = d * math.cos(a), d * math.sin(a)
        rot = r.uniform(0, 6.3)
        ln, w = r.uniform(0.06, 0.13), r.uniform(0.02, 0.04)
        dv, sv = Vector((math.cos(rot), math.sin(rot), 0)), Vector((-math.sin(rot), math.cos(rot), 0))
        prev = None
        for i in range(5):
            s = i / 4
            p = Vector((x, y, 0.004)) + dv * (ln * (s - 0.5)) + Vector((0, 0, 0.012 * (2 * s - 1) ** 2))
            ww = w * math.sin(math.pi * min(0.98, max(0.02, s)))
            pair = (bm.verts.new(p - sv * ww), bm.verts.new(p + sv * ww))
            if prev:
                bm.faces.new((prev[0], prev[1], pair[1], pair[0]))
            prev = pair
    return mesh_object(name, bm, [mat], location=(0, 0, -200))


def cushion_mesh(name, mat, seed):
    r = random.Random(seed)
    bm = bmesh.new()
    for k in range(r.randint(2, 5)):
        s = r.uniform(0.05, 0.16)
        a, d = r.uniform(0, 6.3), r.uniform(0, 0.15)
        ellipsoid(bm, (d * math.cos(a), d * math.sin(a), -s * 0.15), (s * r.uniform(1, 1.6), s, s * 0.5), segs=12, rings=6,
                  rotation_z=r.uniform(0, 6.3), lumps=0.3, seed=seed + k * 0.37)
    return mesh_object(name, bm, [mat], location=(0, 0, -200))


def ground_cover(moss_mat, glow):
    """Thousands of small things on the floor of the clearing, densest near the seat."""
    r = random.Random(99)
    sorrel_mat = leaf_material("sorrel", (0.03, 0.09, 0.075), translucency=0.4)
    litter_mat = leaf_material("litter", (0.07, 0.04, 0.06), translucency=0.15)
    grass_mat = leaf_material("grass", (0.03, 0.075, 0.06), translucency=0.3)
    kinds = {
        "sorrel": [sorrel_mesh(f"sorrel {i}", sorrel_mat, 40 + i) for i in range(3)],
        "litter": [litter_mesh(f"litter {i}", litter_mat, 60 + i) for i in range(3)],
        "cushion": [cushion_mesh(f"cushion {i}", moss_mat, 80 + i) for i in range(4)],
        "tuft": [tuft_mesh(f"small tuft {i}", grass_mat, 520 + i) for i in range(2)],
        "fern": [fern_mesh(f"small fern {i}", sorrel_mat, 6 + i, 950 + i) for i in range(2)],
    }
    glowing = [sorrel_mesh(f"glow sorrel {name}", no_light_sampling(glow_material(f"sorrel {name}", col, 1.6, pale=0.1)), 70 + i)
               for i, (name, col) in enumerate((("cyan", CYAN), ("turquoise", TURQUOISE), ("violet", VIOLET)))]
    for g in glowing:
        link(g, glow.layer)
    for _ in range(300):
        x, y = clearing_spot(r, 2.0, 12.0, front_clear=27)
        g = r.choices(glowing, weights=(4, 4, 2))[0]
        for k in range(r.randint(1, 4)):
            px, py = x + r.gauss(0, 0.25), y + r.gauss(0, 0.25)
            instance(g, (px, py, ground_z(px, py) - 0.01), (0, 0, r.uniform(0, 6.3)), r.uniform(0.8, 1.6), coll=glow.layer)
    px, py, rx, ry = POOL
    placed = 0
    while placed < 3400:
        d = 1.62 + r.expovariate(1 / 3.2)
        if d > 13:
            continue
        az = r.uniform(-180, 180)
        x, y = d * math.sin(math.radians(az)), d * math.cos(math.radians(az))
        if ((x - px) / (rx + 0.2)) ** 2 + ((y - py) / (ry + 0.2)) ** 2 < 1:
            continue
        ahead = abs(az) < 28
        if ahead:
            if r.random() < 0.55:
                continue  # calmer below the screen
            kind = r.choices(("litter", "cushion", "sorrel", "tuft"), weights=(5, 1, 3, 1))[0]
        else:
            kind = r.choices(("litter", "cushion", "sorrel", "tuft", "fern"), weights=(3, 1, 4, 3, 2))[0]
        scale = {"litter": 1.0, "cushion": 1.0, "sorrel": 1.3, "tuft": 0.6, "fern": 0.35}[kind] * r.uniform(0.7, 1.4)
        instance(r.choice(kinds[kind]), (x, y, ground_z(x, y) - 0.01), (0, 0, r.uniform(0, 6.3)), scale)
        placed += 1


def near_ground(bark, moss_mat, glow):
    """What lies a few steps from the seat: roots snaking in from the trees, mossy stones and cushions."""
    r = random.Random(314)
    roots = []
    for az, start, end in ((178, 10.5, 2.0), (-128, 11.5, 2.3), (122, 10.0, 2.6), (-70, 12.0, 2.8), (75, 13.0, 3.2), (-158, 12.5, 3.6)):
        a = math.radians(az)
        pts = []
        wob = r.uniform(0, 6.3)
        for i in range(12):
            s = i / 11
            d = start + (end - start) * s
            aa = a + 0.18 * math.sin(wob + s * 5) * (1 - s * 0.5)
            x, y = d * math.sin(aa), d * math.cos(aa)
            rad = 0.32 * (1 - s) + 0.04
            pts.append((x, y, ground_z(x, y) + rad * (0.35 if s < 0.97 else -1.5), rad))
        roots.append(pts)
        # A thinner side root branching off.
        k = r.randint(4, 7)
        bx, by, bz, br = pts[k]
        side = r.choice((-1, 1))
        sub = []
        for i in range(7):
            s = i / 6
            aa = a + side * (0.15 + 0.5 * s)
            d = math.hypot(bx, by) - 2.5 * s
            x, y = d * math.sin(aa), d * math.cos(aa)
            rad = br * 0.6 * (1 - s) + 0.02
            sub.append((x, y, ground_z(x, y) + rad * (0.3 if s < 0.95 else -1.5), rad))
        roots.append(sub)
    curve_object("surface roots", roots, bark, resolution=6, bevel_resolution=3)

    stone = stone_material()
    bm = bmesh.new()
    for k in range(34):
        x, y = clearing_spot(r, 1.8, 9.0, front_clear=22)
        s = r.uniform(0.08, 0.35)
        ellipsoid(bm, (x, y, ground_z(x, y) + s * 0.1), (s * r.uniform(1, 1.6), s, s * r.uniform(0.45, 0.8)), segs=14, rings=8,
                  rotation_z=r.uniform(0, 6.3), lumps=0.25, seed=k)
    mesh_object("stones", bm, [stone])
    ground_cover(moss_mat, glow)

    # Tiny glowing pins on hair-thin stalks, scattered close by.
    bm = bmesh.new()
    stems = []
    for k in range(26):
        x, y = clearing_spot(r, 1.8, 4.5, front_clear=18)
        for j in range(r.randint(3, 8)):
            px, py = x + r.gauss(0, 0.12), y + r.gauss(0, 0.12)
            h = r.uniform(0.06, 0.22)
            gz = ground_z(px, py)
            stems.append([(px, py, gz - 0.01, 0.003), (px + r.uniform(-0.02, 0.02), py + r.uniform(-0.02, 0.02), gz + h, 0.002)])
            ellipsoid(bm, (stems[-1][-1][0], stems[-1][-1][1], gz + h + 0.008), (0.009, 0.009, 0.012), segs=6, rings=4)
    curve_object("pin stalks", [pts + [pts[-1]] for pts in stems], A.material("pin stalk", (0.08, 0.12, 0.1), roughness=0.6),
                 resolution=1, bevel_resolution=0)
    mesh_object("glow pins", bm, [no_light_sampling(glow_material("glow pin", (0.3, 1.0, 0.85), 4.0, pale=0.3))], coll=glow.layer)


def undergrowth(glow, stalk, fern_mat, leaf_mat, bark):
    r = random.Random(42)
    near_ground(bark, A.material("moss", (0.025, 0.07, 0.05), roughness=0.95, sheen=0.3), glow)
    tufts = [tuft_mesh(f"tuft {i}", fern_mat, 500 + i) for i in range(3)]
    for _ in range(420):
        x, y = clearing_spot(r, 1.9, 18, front_clear=24)
        instance(r.choice(tufts), (x, y, ground_z(x, y) - 0.02), (0, 0, r.uniform(0, 6.3)), r.uniform(0.7, 1.4))
    for _ in range(40):  # along the pool's near shore, low and sparse
        a = r.uniform(-1, 1) * 2.4
        px, py, rx, ry = POOL
        x, y = px + (rx + r.uniform(0.3, 1.2)) * math.sin(a), py - (ry + r.uniform(0.3, 1.2)) * math.cos(a)
        instance(r.choice(tufts), (x, y, ground_z(x, y) - 0.02), (0, 0, r.uniform(0, 6.3)), r.uniform(0.5, 0.9))
    fallen_log(6.2, -3.4, math.radians(62), 7.5, 0.55, bark, glow)
    fallen_log(-7.4, -1.2, math.radians(-75), 6.0, 0.45, bark, glow)
    ferns = [fern_mesh(f"fern {i}", fern_mat, 7 + i, 900 + i) for i in range(3)]
    leaves = [leaf_mesh(f"leaf {i}", leaf_mat, 300 + i) for i in range(2)]

    # Ferns: a few near the seat (but not within reach), many along the clearing's edge.
    for _ in range(240):
        x, y = clearing_spot(r, 2.6, 16, front_clear=30)
        s = r.uniform(0.6, 1.3) * (1 + 0.04 * math.hypot(x, y))
        instance(r.choice(ferns), (x, y, ground_z(x, y) - 0.03), (0, 0, r.uniform(0, 6.3)), s)
    for _ in range(90):  # beyond the trees
        x, y = clearing_spot(r, 16, 36, front_clear=20)
        instance(r.choice(ferns), (x, y, ground_z(x, y) - 0.05), (0, 0, r.uniform(0, 6.3)), r.uniform(1.3, 2.4))
    # Big leaves, clumps of three to six.
    for _ in range(28):
        x, y = clearing_spot(r, 4.0, 15, front_clear=36)
        base = r.uniform(0, 6.3)
        for k in range(r.randint(3, 6)):
            instance(r.choice(leaves), (x, y, ground_z(x, y) - 0.05),
                     (r.uniform(-0.1, 0.1), r.uniform(-0.25, 0.05), base + k * r.uniform(0.9, 1.5)), r.uniform(0.9, 1.8))

    # Bulb plants: slender stalks arching over, a glowing bulb hanging from each.
    stalks = []
    for _ in range(26):
        x, y = clearing_spot(r, 3.2, 14, front_clear=33)
        color = r.choice(("cyan", "cyan", "violet", "magenta", "aqua"))
        for k in range(r.randint(3, 7)):
            a = r.uniform(0, 6.3)
            h = r.uniform(0.5, 1.6)
            reach = r.uniform(0.2, 0.6) * h
            bx, by = x + r.uniform(-0.3, 0.3), y + r.uniform(-0.3, 0.3)
            gz = ground_z(bx, by)
            ca, sa = math.cos(a), math.sin(a)
            pts = [(bx, by, gz - 0.05, 0.018), (bx + ca * reach * 0.15, by + sa * reach * 0.15, gz + h * 0.55, 0.014),
                   (bx + ca * reach * 0.6, by + sa * reach * 0.6, gz + h, 0.011),
                   (bx + ca * reach, by + sa * reach, gz + h * 0.93, 0.009)]
            stalks.append(pts)
            s = r.uniform(0.05, 0.1) * (0.7 + 0.3 * h)
            instance(glow.bulbs[color], (pts[-1][0], pts[-1][1], pts[-1][2] - s * 0.9), (0, 0, 0), s, coll=glow.layer)
        glow.light(x, y, ground_z(x, y) + 1.0, color, 45, radius=0.5)
    curve_object("bulb stalks", stalks, stalk, resolution=5, bevel_resolution=1)

    # Curled glowing fronds rising from the moss.
    fronds = {}
    for _ in range(22):
        x, y = clearing_spot(r, 3.0, 13, front_clear=34)
        color = r.choice(("turquoise", "cyan", "turquoise", "violet"))
        for k in range(r.randint(7, 14)):
            a = r.uniform(0, 6.3)
            bx, by = x + r.gauss(0, 0.18), y + r.gauss(0, 0.18)
            fronds.setdefault(color, []).append(fiddlehead(bx, by, ground_z(bx, by), a, r.uniform(0.25, 0.8)))
        glow.light(x, y, ground_z(x, y) + 0.6, color, 25, radius=0.4)
    for color, splines in fronds.items():
        curve_object(f"fronds {color}", splines, glow.frond[color], coll=glow.layer, resolution=4, bevel_resolution=1)

    # Small mushrooms scattered through the moss, and two near the pool's edge.
    for _ in range(26):
        x, y = clearing_spot(r, 3.0, 14, front_clear=30)
        glow.mushroom_cluster(x, y, r.uniform(0.06, 0.16), r.choice(("violet", "magenta", "cyan", "turquoise")),
                              r.randint(4, 10), light=r.random() < 0.5)
    for x, y in ((-3.6, 4.6), (4.2, 5.0)):
        glow.mushroom_cluster(x, y, 0.09, "magenta" if x < 0 else "cyan", 7)

    # Glowing moss: patches all over the clearing, thicker towards its edge.
    for i in range(46):
        x, y = clearing_spot(r, 2.4, 18, front_clear=0)
        patch(x, y, r.uniform(0.8, 2.6), glow.moss[r.choice(("turquoise", "turquoise", "cyan", "violet"))], glow.layer)


def fiddlehead(x, y, gz, a, height):
    """A frond rising from the ground and rolling into a spiral at its tip."""
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for i in range(10):
        s = i / 9
        pts.append((x + ca * 0.22 * height * s * s, y + sa * 0.22 * height * s * s, gz - 0.02 + height * s, 0.006 * height + 0.0025))
    # The curl: a shrinking spiral forward and down from the top.
    top = Vector(pts[-1][:3])
    r0 = 0.085 * height
    for i in range(1, 16):
        th = i / 15 * 1.75 * 2 * math.pi
        rr = r0 * (1 - i / 16.5)
        fwd = rr * math.sin(th)
        up = rr * (math.cos(th) - 1)
        pts.append((top.x + ca * fwd, top.y + sa * fwd, top.z + up, (0.006 * height + 0.0025) * (1 - i / 18)))
    return pts


def patch(x, y, radius, mat, coll):
    bm = bmesh.new()
    segs, rings = 24, 6
    centre = bm.verts.new((0, 0, ground_z(x, y) + 0.015))
    verts = []
    for i in range(1, rings + 1):
        rr = radius * i / rings
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            px, py = rr * math.cos(a), rr * math.sin(a)
            row.append(bm.verts.new((px, py, ground_z(x + px, y + py) + 0.015)))
        verts.append(row)
    for j in range(segs):
        bm.faces.new((centre, verts[0][j], verts[0][(j + 1) % segs]))
    for i in range(rings - 1):
        for j in range(segs):
            bm.faces.new((verts[i][j], verts[i][(j + 1) % segs], verts[i + 1][(j + 1) % segs], verts[i + 1][j]))
    obj = mesh_object("moss glow", bm, [mat], coll=coll, location=(x, y, 0), up=True)
    # Object space spans the patch's radius as 1, for the material's edge falloff.
    obj.data.transform(Matrix.Diagonal((1 / radius, 1 / radius, 1, 1)))
    obj.scale = (radius, radius, 1)
    return obj


def vines(trees, vine_mat, glow):
    """Vines hanging from the canopy around the clearing, a few with glowing pods along them."""
    r = random.Random(77)
    splines = []
    bm = bmesh.new()
    for _ in range(110):
        d = r.uniform(7, 26)
        az = r.uniform(-180, 180)
        if abs(az) < 28 and d < 20:
            continue
        x, y = d * math.sin(math.radians(az)), d * math.cos(math.radians(az))
        top = CANOPY_Z[0] + r.uniform(-1, 3)
        bottom = r.uniform(3.5, 14)
        sway = Vector((r.uniform(-1, 1), r.uniform(-1, 1), 0)) * r.uniform(0.3, 1.2)
        pts = []
        for i in range(9):
            s = i / 8
            p = Vector((x, y, top + (bottom - top) * s)) + sway * math.sin(math.pi * s * 0.9)
            pts.append((p.x, p.y, p.z, r.uniform(0.025, 0.045) * (1 - 0.5 * s)))
        splines.append(pts)
        if r.random() < 0.3:
            # Glowing pods at the tip.
            for k in range(r.randint(1, 3)):
                s = 1 - k * 0.025
                p = Vector((x, y, top + (bottom - top) * s)) + sway * math.sin(math.pi * s * 0.9)
                ellipsoid(bm, p, (0.035, 0.035, 0.06), segs=8, rings=5)
    curve_object("vines", splines, vine_mat, resolution=4, bevel_resolution=1)
    mesh_object("vine pods", bm, [no_light_sampling(glow_material("vine pod", AQUA, 3.0, pale=0.2))], coll=glow.layer)


def motes():
    """Spores drifting in the air, near and far, in their own layer for the app to shimmer."""
    r = random.Random(2024)
    layer = A.layer("motes")
    mats = [no_light_sampling(glow_material("mote cyan", (0.3, 1.0, 0.95), 9.0, pale=0.25)),
            no_light_sampling(glow_material("mote violet", (0.7, 0.45, 1.0), 9.0, pale=0.25)),
            no_light_sampling(glow_material("mote green", (0.5, 1.0, 0.65), 8.0, pale=0.25))]
    bm = bmesh.new()
    count = 0
    while count < 1000:
        if count < 450 and GLOW_SPOTS:
            gx, gy = r.choice(GLOW_SPOTS)
            x, y = gx + r.gauss(0, 1.2), gy + r.gauss(0, 1.2)
            d = math.hypot(x, y)
            if d < 2.8:
                continue
            z = ground_z(x, y) + 0.1 + r.expovariate(1 / 0.9)
        else:
            d = 2.8 + r.expovariate(1 / 8.0)
            if d > 40:
                continue
            az = r.uniform(-180, 180)
            x, y = d * math.sin(math.radians(az)), d * math.cos(math.radians(az))
            z = ground_z(x, y) + 0.15 + r.expovariate(1 / 1.8)
            if z > 12:
                continue
        size = r.uniform(0.006, 0.016) * (1 + d * 0.03)
        idx = r.choices((0, 1, 2), weights=(6, 2, 2))[0]
        ellipsoid(bm, (x, y, z), (size, size, size), segs=6, rings=4, mat_index=idx)
        count += 1
    mesh_object("motes", bm, mats, coll=layer)


# ---------------------------------------------------------------- the viewer's seat


SEAT_RX, SEAT_RY, SEAT_CY, SEAT_Z = 0.52, 0.5, -0.06, 0.44


def seat_shape(x, y):
    """The top of the mushroom cap: a soft dish, rising into a backrest behind and low arms at the sides."""
    u, v = x / SEAT_RX, (y - SEAT_CY) / SEAT_RY
    dish = -0.05 * max(0.0, 1 - u * u - v * v)
    back = 0.62 * smooth(-0.1, -1.0, v) ** 1.5
    arms = 0.09 * smooth(0.5, 1.0, abs(u)) * smooth(0.7, -0.3, v)
    lip = -0.04 * smooth(0.55, 1.0, v)
    return dish + back + arms + lip


def build_seat():
    """The viewer's seat: the broad, curled cap of a giant mushroom, mossy on top, its gills glowing
    faintly underneath, on a patch of moss with a few small glowing plants at its foot."""
    seat = "seat"
    moss = A.material("seat moss", (0.03, 0.075, 0.05), roughness=1.0, sheen=1.0)
    cap = A.material("seat cap", (0.13, 0.1, 0.17), roughness=0.62)
    gills = A.material("seat gills", (0.2, 0.3, 0.33), roughness=0.7, emission=(0.2, 0.85, 0.8), strength=0.45)
    stem = A.material("seat stem", (0.32, 0.29, 0.36), roughness=0.75)
    ground = A.material("seat ground", (0.022, 0.045, 0.036), roughness=1.0, sheen=0.6)
    speckle = A.material("seat speckle", (0.35, 0.6, 0.6), roughness=0.5, emission=(0.3, 0.95, 0.9), strength=1.2)

    def wobble(phi):
        """The cap's margin: gently waved, never a perfect ellipse."""
        return 1 + 0.035 * math.sin(7 * phi + 0.5) + 0.02 * math.sin(12 * phi + 1.3)

    # The cap: a profile swept around, then shaped by seat_shape. Parts: 0 moss, 1 cap, 2 gills.
    profile = [(0.0, 0.0, 0), (0.2, 0.0, 0), (0.4, 0.0, 0), (0.6, 0.0, 0), (0.75, 0.0, 0), (0.86, -0.004, 0), (0.93, -0.012, 0),
               (0.99, -0.03, 1), (1.04, -0.06, 1), (1.065, -0.1, 1), (1.06, -0.145, 1), (1.02, -0.185, 1), (0.95, -0.205, 2),
               (0.85, -0.21, 2), (0.72, -0.215, 2), (0.6, -0.225, 2), (0.48, -0.24, 2)]
    segs = 80
    bm = bmesh.new()
    rings = []
    for s, dz, part in profile:
        if s == 0:
            rings.append([bm.verts.new((0, SEAT_CY, SEAT_Z + seat_shape(0, SEAT_CY)))])
            continue
        ring = []
        for j in range(segs):
            phi = 2 * math.pi * j / segs
            w = wobble(phi) if s > 0.8 else 1 + (wobble(phi) - 1) * s / 0.8
            x, y = s * w * SEAT_RX * math.cos(phi), SEAT_CY + s * w * SEAT_RY * math.sin(phi)
            edge = min(s, 1.0)
            ex, ey = edge * SEAT_RX * math.cos(phi), SEAT_CY + edge * SEAT_RY * math.sin(phi)
            weight = 1.0 if part < 2 else smooth(0.45, 0.9, s)
            back = smooth(-0.1, -1.0, math.sin(phi))
            thick = 1 + 1.4 * back if part > 0 else 1.0
            z = SEAT_Z + dz * thick + seat_shape(ex, ey) * weight
            if part == 0:  # soft lumps in the moss
                z += 0.012 * noise.noise(Vector((x * 9, y * 9, 0.5))) * smooth(0.0, 0.4, s)
            if part == 2:  # the gills: fine radial ridges
                z += 0.008 * math.cos(64 * phi) * smooth(0.5, 0.75, s) * (1 - smooth(0.9, 1.0, s))
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        part = profile[i + 1][2]
        for j in range(segs):
            if len(a) == 1:
                f = bm.faces.new((a[0], b[j], b[(j + 1) % segs]))
            else:
                f = bm.faces.new((a[j], b[j], b[(j + 1) % segs], a[(j + 1) % segs]))
            f.material_index = part
    cap_obj = mesh_object("seat cap", bm, [moss, cap, gills], coll=seat)
    sub = cap_obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = sub.render_levels = 1

    # Glowing speckles scattered over the outside of the cap's curled back.
    bm = bmesh.new()
    r = random.Random(21)
    for k in range(38):
        phi = r.uniform(-math.pi * 0.95, -math.pi * 0.05)
        s = 1.045
        w = wobble(phi)
        x, y = s * w * SEAT_RX * math.cos(phi), SEAT_CY + s * w * SEAT_RY * math.sin(phi)
        back = smooth(-0.1, -1.0, math.sin(phi))
        z = SEAT_Z + r.uniform(-0.14, -0.04) * (1 + 1.4 * back) + seat_shape(SEAT_RX * math.cos(phi), SEAT_CY + SEAT_RY * math.sin(phi))
        sz = r.uniform(0.006, 0.014)
        ellipsoid(bm, (x, y, z), (sz, sz, sz * 0.6), segs=6, rings=4)
    mesh_object("seat speckles", bm, [speckle], coll=seat)

    # The stem: thick and pale, a torn skirt just under the cap, flaring into root lobes on the moss.
    bm = bmesh.new()
    prof = [(0.46, -0.03), (0.4, 0.0), (0.31, 0.04), (0.255, 0.1), (0.235, 0.16), (0.24, 0.22), (0.26, 0.28)]

    def lobes(phi, i):
        flare = max(0.0, 1 - i / 3)
        return 1 + flare * (0.2 * math.cos(5 * phi + 0.4) + 0.08 * math.cos(9 * phi)) + 0.02 * math.cos(13 * phi)

    lathe(bm, prof, 48, origin=(0, SEAT_CY, 0), radial=lobes)
    skirt = [(0.25, 0.25), (0.31, 0.215), (0.34, 0.19)]
    lathe(bm, skirt, 48, origin=(0, SEAT_CY, 0), radial=lambda phi, i: 1 + (0.08 * math.sin(11 * phi) if i == 2 else 0))
    stem_obj = mesh_object("seat stem", bm, [stem], coll=seat)
    sub = stem_obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = sub.render_levels = 1

    # The mossy ground patch, gently lumpy, its edge ragged and sinking to meet the floor beyond.
    bm = bmesh.new()
    segs, nr = 72, 14
    centre = bm.verts.new((0, 0, 0.012))
    rows = []
    for i in range(1, nr + 1):
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            edge = 1.5 + 0.08 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, 9.1)))
            rr = edge * i / nr
            x, y = rr * math.cos(a), rr * math.sin(a)
            f = i / nr
            z = 0.012 + 0.025 * noise.noise(Vector((x * 2.2, y * 2.2, 3.3))) * (1 - f ** 4) - 0.035 * f ** 6
            row.append(bm.verts.new((x, y, z)))
        rows.append(row)
    for j in range(segs):
        bm.faces.new((centre, rows[0][j], rows[0][(j + 1) % segs]))
    for i in range(nr - 1):
        for j in range(segs):
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][(j + 1) % segs], rows[i][(j + 1) % segs]))
    mesh_object("seat ground", bm, [ground], coll=seat, up=True)

    # Moss cushions and fallen leaves around the stem's foot.
    bm = bmesh.new()
    for k in range(22):
        a = r.uniform(0, 2 * math.pi)
        d = r.uniform(0.5, 1.4)
        sz = r.uniform(0.06, 0.15)
        ellipsoid(bm, (d * math.cos(a), d * math.sin(a), 0.0), (sz * 1.4, sz, sz * 0.42), segs=10, rings=5,
                  rotation_z=a, lumps=0.25, seed=k)
    mesh_object("seat moss tufts", bm, [moss], coll=seat)
    bm = bmesh.new()
    for k in range(40):
        a, d = r.uniform(0, 6.3), r.uniform(0.45, 1.45)
        x, y = d * math.cos(a), d * math.sin(a)
        rot = r.uniform(0, 6.3)
        ln, w = r.uniform(0.07, 0.12), r.uniform(0.025, 0.04)
        dv, sv = Vector((math.cos(rot), math.sin(rot), 0)), Vector((-math.sin(rot), math.cos(rot), 0))
        prev = None
        for i in range(5):
            t = i / 4
            p = Vector((x, y, 0.02)) + dv * (ln * (t - 0.5)) + Vector((0, 0, 0.01 * (2 * t - 1) ** 2))
            ww = w * math.sin(math.pi * min(0.98, max(0.02, t)))
            pair = (bm.verts.new(p - sv * ww), bm.verts.new(p + sv * ww))
            if prev:
                bm.faces.new((prev[0], pair[0], pair[1], prev[1]))
            prev = pair
    mesh_object("seat leaves", bm, [A.material("seat leaf", (0.06, 0.035, 0.05), roughness=0.7)], coll=seat, up=True)

    # Small glowing plants at its foot: mushrooms, bulbs on stalks and curled fronds.
    glow_cyan = A.material("seat glow cyan", (0.02, 0.2, 0.25), roughness=0.4, emission=CYAN, strength=2.4)
    glow_magenta = A.material("seat glow magenta", (0.25, 0.02, 0.15), roughness=0.4, emission=MAGENTA, strength=2.2)
    glow_turq = A.material("seat glow turquoise", (0.02, 0.2, 0.12), roughness=0.4, emission=TURQUOISE, strength=1.8)
    glow_violet = A.material("seat glow violet", (0.12, 0.06, 0.3), roughness=0.4, emission=VIOLET, strength=2.6)
    pale = A.material("seat glow stem", (0.45, 0.42, 0.55), roughness=0.5, emission=(0.5, 0.45, 1.0), strength=0.25)
    stalk = A.material("seat stalk", (0.04, 0.08, 0.06), roughness=0.6)
    bm = bmesh.new()
    clusters = ((-0.72, 0.42, 1), (0.8, 0.32, 4), (-0.98, -0.35, 2), (0.66, -0.8, 1), (0.22, 1.08, 4), (-0.32, -1.12, 2))
    for cx, cy, color in clusters:
        for k in range(r.randint(4, 7)):
            a, d = r.uniform(0, 6.3), r.uniform(0, 0.14)
            x, y = cx + d * math.cos(a), cy + d * math.sin(a)
            sz = r.uniform(0.022, 0.06)
            sh = sz * r.uniform(1.2, 2.6)
            tilt = Vector((r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), 1)).normalized() * sh
            tube(bm, [(x, y, 0.0, sz * 0.2), (x + tilt.x * 0.6, y + tilt.y * 0.6, tilt.z * 0.6, sz * 0.16), (x + tilt.x, y + tilt.y, tilt.z, sz * 0.14)],
                 sides=6, mat_index=0)
            ellipsoid(bm, (x + tilt.x, y + tilt.y, tilt.z), (sz, sz, sz * 0.42), segs=10, rings=5, mat_index=color)
    for cx, cy in ((-0.55, 0.88), (0.98, -0.08), (-1.12, 0.22)):
        for k in range(r.randint(5, 8)):
            a = r.uniform(0, 6.3)
            bx, by = cx + r.gauss(0, 0.06), cy + r.gauss(0, 0.06)
            pts = fiddlehead(bx, by, 0.0, a, r.uniform(0.16, 0.34))
            tube(bm, [(x, y, z, rad * 0.7) for x, y, z, rad in pts[::2] + [pts[-1]]], sides=4, mat_index=3)
    for cx, cy in ((0.45, 0.72), (-0.86, -0.86)):
        for k in range(r.randint(3, 5)):
            a = r.uniform(0, 6.3)
            h = r.uniform(0.25, 0.5)
            reach = 0.35 * h
            ca, sa = math.cos(a), math.sin(a)
            pts = [(cx, cy, 0.0, 0.007), (cx + ca * reach * 0.2, cy + sa * reach * 0.2, h * 0.6, 0.005),
                   (cx + ca * reach * 0.7, cy + sa * reach * 0.7, h, 0.004), (cx + ca * reach, cy + sa * reach, h * 0.9, 0.0035)]
            tube(bm, pts, sides=5, mat_index=5)
            ellipsoid(bm, (pts[-1][0], pts[-1][1], pts[-1][2] - 0.03), (0.022, 0.022, 0.034), segs=10, rings=6, mat_index=1)
    mesh_object("seat glow plants", bm, [pale, glow_cyan, glow_magenta, glow_turq, glow_violet, stalk], coll=seat)
