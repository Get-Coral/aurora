"""
Orbital Deck: the observation lounge of a vast orbital station.

The front half of a domed room is one huge curved window onto deep space: a
violet and teal nebula, dense stars, and a large ocean planet whose lit limb
curves towards the screen, its atmosphere glowing where the distant sun hits
it. Metal ribs arc overhead and meet in a crown above the viewer. The viewer
sits in a command chair on a raised dais; the deck steps down around it, to
lounge chairs by the glass and, behind, under a low overhang, a ring of
consoles with holographic displays and a holographic globe.

Light layers:
- deck: the light lines in the ribs, floor and overhang, and the ceiling
  wash. Up while the film isn't playing, nearly out while it plays.
- holo: the consoles, the holograms and their glow. Stays mostly on; the
  app shimmers it.
The faint floor guide lines belong to the base, so the deck stays readable in
the dark by the light of the nebula and the planet.
"""

import math

import bmesh
import bpy
from mathutils import Vector

import aurora_scene as A

SAMPLES = 160

# The dome: an ellipsoid around C, its centre behind the viewer so the window ahead
# is nearer than the hull behind, and flattened so it doesn't tower.
C = Vector((0.0, -2.2, 0.2))
DOME_A = 13.4  # horizontal radius
DOME_C = 9.0  # height
R = DOME_A
DECK_Z = -0.6  # the deck around the dais
DAIS_R = 2.3  # the viewer's raised command dais, top at z = 0
OVERHANG_Z = 3.0  # the low ceiling over the rear console ring
OVERHANG_R = 5.6  # its front edge
CROWN = 80  # degrees: where the window's ribs meet the crown ring
RIBS = (-72, -50, -28, 28, 50, 72)  # the window's ribs (azimuths around C), clear of the screen
BULKHEAD_R = 12.0  # the wall closing the rear console area

# Light levels.
LINE = 5.0  # the deck's light lines
GUIDE = 1.5  # the floor guide lines that stay on
NIGHT = 25  # the dim night lights under the overhang that stay on
SPILL = 25  # the film's light on the deck
CROWN_WASH = 1200
SPACE_FILL = 400  # the nebula's and the planet's light through the window

BLUE = (0.25, 0.6, 1.0)  # deck light lines
CYAN = (0.2, 0.85, 1.0)  # holograms
WHITE = (0.85, 0.9, 1.0)

# Where the distant sun is (from the viewer), and the planet and its moon.
SUN = Vector((math.sin(math.radians(14)) * math.cos(math.radians(32)),
              math.cos(math.radians(14)) * math.cos(math.radians(32)),
              math.sin(math.radians(32))))


def direction(az, el):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))


# ---- Node helpers ----


def _in(links, value, socket):
    if isinstance(value, (int, float)):
        socket.default_value = value
    elif isinstance(value, (tuple, list, Vector)):
        socket.default_value = tuple(value)
    else:
        links.new(value, socket)


def M(nodes, links, op, a, b=None, c=None, clamp=False):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b, c)):
        if v is not None:
            _in(links, v, n.inputs[i])
    return n.outputs[0]


def V(nodes, links, op, a, b=None, scale=None):
    n = nodes.new("ShaderNodeVectorMath")
    n.operation = op
    _in(links, a, n.inputs[0])
    if b is not None:
        _in(links, b, n.inputs[1])
    if scale is not None:
        _in(links, scale, n.inputs["Scale"])
    return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]


def xyz(nodes, links, vec):
    n = nodes.new("ShaderNodeSeparateXYZ")
    links.new(vec, n.inputs[0])
    return n.outputs[0], n.outputs[1], n.outputs[2]


def combine(nodes, links, x, y, z):
    n = nodes.new("ShaderNodeCombineXYZ")
    for i, v in enumerate((x, y, z)):
        _in(links, v, n.inputs[i])
    return n.outputs[0]


def noise(nodes, links, vec, scale, detail=4.0, rough=0.5, distortion=0.0):
    n = nodes.new("ShaderNodeTexNoise")
    n.noise_dimensions = "3D"
    links.new(vec, n.inputs["Vector"])
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    n.inputs["Distortion"].default_value = distortion
    return n


def ramp(nodes, links, fac, stops):
    n = nodes.new("ShaderNodeValToRGB")
    els = n.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = (*col, 1) if len(col) == 3 else col
    _in(links, fac, n.inputs["Fac"])
    return n.outputs["Color"]


def mix_rgb(nodes, links, fac, a, b, blend="MIX"):
    n = nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    _in(links, fac, n.inputs["Factor"])
    _in(links, a, n.inputs[6])
    _in(links, b, n.inputs[7])
    return n.outputs[2]


def smooth(nodes, links, value, lo, hi):
    n = nodes.new("ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP"
    _in(links, value, n.inputs["Value"])
    n.inputs["From Min"].default_value = lo
    n.inputs["From Max"].default_value = hi
    return n.outputs["Result"]


def seam(nodes, links, value, step, scale, width):
    """Seams every `step` along `value`: (1 on a seam `width` metres wide, the panel's index).
    `scale` (a number or a socket) turns units of `value` into metres."""
    k = M(nodes, links, "DIVIDE", value, step)
    d = M(nodes, links, "ABSOLUTE", M(nodes, links, "SUBTRACT", k, M(nodes, links, "ROUND", k)))
    d = M(nodes, links, "MULTIPLY", M(nodes, links, "MULTIPLY", d, step), scale)
    return M(nodes, links, "LESS_THAN", d, width), M(nodes, links, "FLOOR", k)


# ---- Geometry helpers ----


def _object(name, mesh, mat, coll, smooth_shade=True):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if smooth_shade:
        for p in mesh.polygons:
            p.use_smooth = True
    return A._place(obj, coll, mat, (0, 0, 0), (0, 0, 0))


def surface(name, fn, nu, nv, mat, coll="base", smooth_shade=True):
    """A grid surface through fn(u, v) -> Vector, u and v in 0..1."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    grid = [[bm.verts.new(fn(i / nu, j / nv)) for i in range(nu + 1)] for j in range(nv + 1)]
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.to_mesh(mesh)
    bm.free()
    return _object(name, mesh, mat, coll, smooth_shade)


def sweep(name, frames, width, depth, mat, coll="base", bevel=0.0):
    """A beam of rectangular section along frames [(point, inward, side)]: `depth` from
    the point inwards, `width` across."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for p, n, s in frames:
        rings.append([bm.verts.new(p + s * (a * width / 2) + n * (b * depth))
                      for a, b in ((-1, 0), (1, 0), (1, 1), (-1, 1))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(4):
            bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = _object(name, mesh, mat, coll, smooth_shade=False)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return obj


def dome(phi, theta, inset=0.0):
    """A point on the dome (an ellipsoid around C) at azimuth phi and elevation theta
    (degrees, around C), moved `inset` metres inwards, and the inward normal there."""
    p, t = math.radians(phi), math.radians(theta)
    point = C + Vector((DOME_A * math.cos(t) * math.sin(p), DOME_A * math.cos(t) * math.cos(p), DOME_C * math.sin(t)))
    rel = point - C
    inward = -Vector((rel.x / DOME_A ** 2, rel.y / DOME_A ** 2, rel.z / DOME_C ** 2)).normalized()
    return point + inward * inset, inward


def meridian(phi, t0, t1, steps=60, inset=0.0):
    p = math.radians(phi)
    side = Vector((math.cos(p), -math.sin(p), 0))
    return [(*dome(phi, t0 + (t1 - t0) * i / steps, inset), side) for i in range(steps + 1)]


def parallel(theta, p0, p1, steps=120, inset=0.0):
    t = math.radians(theta)
    out = []
    for i in range(steps + 1):
        phi = p0 + (p1 - p0) * i / steps
        p = math.radians(phi)
        point, inward = dome(phi, theta, inset)
        side = Vector((-DOME_A * math.sin(t) * math.sin(p), -DOME_A * math.sin(t) * math.cos(p), DOME_C * math.cos(t))).normalized()
        out.append((point, inward, side))
    return out


def ring(name, r0, r1, z, mat, coll="base", p0=0, p1=360, steps=128, centre=(0, 0)):
    """A flat annulus (or a sector of one) at height z."""
    def fn(u, v):
        a = math.radians(p0 + (p1 - p0) * u)
        r = r0 + (r1 - r0) * v
        return Vector((centre[0] + r * math.sin(a), centre[1] + r * math.cos(a), z))
    return surface(name, fn, steps, 1, mat, coll)


def band(name, r, z0, z1, mat, coll="base", p0=0, p1=360, steps=128, centre=(0, 0)):
    """A vertical cylindrical band of radius r between z0 and z1."""
    def fn(u, v):
        a = math.radians(p0 + (p1 - p0) * u)
        return Vector((centre[0] + r * math.sin(a), centre[1] + r * math.cos(a), z0 + (z1 - z0) * v))
    return surface(name, fn, steps, 1, mat, coll)


def polar(r, phi, z):
    a = math.radians(phi)
    return (r * math.sin(a), r * math.cos(a), z)


# ---- Materials ----


def floor_material(name, rough_lo, rough_hi, radial_deg=10, ring_step=1.4, dark=1.0):
    """Dark brushed metal in radial panels, each a slightly different tone."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    x, y, _ = xyz(nodes, links, coord)
    r = V(nodes, links, "LENGTH", combine(nodes, links, x, y, 0))
    a = M(nodes, links, "ARCTAN2", x, y)
    ring_seam, ring_id = seam(nodes, links, r, ring_step, 1.0, 0.008)
    radial_seam, radial_id = seam(nodes, links, a, math.radians(radial_deg), r, 0.008)
    seams = M(nodes, links, "MAXIMUM", ring_seam, radial_seam)
    cell = nodes.new("ShaderNodeTexWhiteNoise")
    cell.noise_dimensions = "3D"
    links.new(combine(nodes, links, ring_id, radial_id, 0), cell.inputs["Vector"])
    tone = ramp(nodes, links, cell.outputs["Value"], [(0, tuple(c * dark for c in (0.028, 0.031, 0.038))), (1, tuple(c * dark for c in (0.05, 0.054, 0.064)))])
    brushed = noise(nodes, links, V(nodes, links, "MULTIPLY", coord, (1.0, 1.0, 40.0)), 18, 6, 0.6)
    colour = mix_rgb(nodes, links, 0.25, tone, brushed.outputs["Color"], "MULTIPLY")
    colour = mix_rgb(nodes, links, seams, colour, (0.005, 0.005, 0.006, 1))
    links.new(colour, bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.85
    links.new(ramp(nodes, links, noise(nodes, links, coord, 1.2, 3).outputs["Fac"],
                   [(0.3, (rough_lo,) * 3), (0.7, (rough_hi,) * 3)]), bsdf.inputs["Roughness"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.004
    links.new(M(nodes, links, "SUBTRACT", 1.0, seams), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def hull_material(name, color, az_step=6.0, el_step=5.0):
    """Panelled hull plating on the dome (seams along azimuth and elevation)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    v = V(nodes, links, "SUBTRACT", coord, tuple(C))
    x, y, z = xyz(nodes, links, v)
    horiz = V(nodes, links, "LENGTH", combine(nodes, links, x, y, 0))
    az = M(nodes, links, "ARCTAN2", x, y)
    el = M(nodes, links, "ARCTAN2", z, horiz)
    s_az, id_az = seam(nodes, links, az, math.radians(az_step), horiz, 0.012)
    s_el, id_el = seam(nodes, links, el, math.radians(el_step), R, 0.012)
    seams = M(nodes, links, "MAXIMUM", s_az, s_el)
    cell = nodes.new("ShaderNodeTexWhiteNoise")
    cell.noise_dimensions = "3D"
    links.new(combine(nodes, links, id_az, id_el, 3.0), cell.inputs["Vector"])
    lo = tuple(c * 0.7 for c in color)
    hi = tuple(c * 1.3 for c in color)
    tone = ramp(nodes, links, cell.outputs["Value"], [(0, lo), (1, hi)])
    grime = noise(nodes, links, coord, 0.9, 6, 0.6)
    tone = mix_rgb(nodes, links, 0.3, tone, grime.outputs["Color"], "MULTIPLY")
    colour = mix_rgb(nodes, links, seams, tone, (0.004, 0.004, 0.005, 1))
    links.new(colour, bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.8
    bsdf.inputs["Roughness"].default_value = 0.42
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.01
    links.new(M(nodes, links, "SUBTRACT", 1.0, seams), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def holo_material(name, color, strength, opaque=False, density=4.0):
    """A holographic display: data blocks, a bright border and scanlines, see-through
    unless `opaque` (a console screen)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    uv = nodes.new("ShaderNodeTexCoord").outputs["UV"]
    u, v, _ = xyz(nodes, links, uv)
    edge_u = M(nodes, links, "MINIMUM", u, M(nodes, links, "SUBTRACT", 1.0, u))
    edge_v = M(nodes, links, "MINIMUM", v, M(nodes, links, "SUBTRACT", 1.0, v))
    border = M(nodes, links, "LESS_THAN", M(nodes, links, "MINIMUM", edge_u, edge_v), 0.025)
    brick = nodes.new("ShaderNodeTexBrick")
    links.new(uv, brick.inputs["Vector"])
    brick.inputs["Scale"].default_value = density
    brick.inputs["Color1"].default_value = (0.55, 0.55, 0.55, 1)
    brick.inputs["Color2"].default_value = (0.08, 0.08, 0.08, 1)
    brick.inputs["Mortar"].default_value = (0, 0, 0, 1)
    brick.inputs["Mortar Size"].default_value = 0.04
    brick.inputs["Brick Width"].default_value = 0.8
    brick.inputs["Row Height"].default_value = 0.2
    brick.offset = 0.37
    brick.squash = 1.6
    gray = nodes.new("ShaderNodeRGBToBW")
    links.new(brick.outputs["Color"], gray.inputs[0])
    blocks = gray.outputs[0]
    scan = M(nodes, links, "ADD", 0.8, M(nodes, links, "MULTIPLY", 0.2, M(nodes, links, "SINE", M(nodes, links, "MULTIPLY", v, 520.0))))
    level = M(nodes, links, "MULTIPLY", M(nodes, links, "ADD", 0.12, blocks), scan)
    level = M(nodes, links, "MAXIMUM", level, border)
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    links.new(M(nodes, links, "MULTIPLY", level, strength), emit.inputs["Strength"])
    add = nodes.new("ShaderNodeAddShader")
    if opaque:
        back = nodes.new("ShaderNodeBsdfPrincipled")
        back.inputs["Base Color"].default_value = (0.004, 0.006, 0.01, 1)
        back.inputs["Roughness"].default_value = 0.15
    else:
        back = nodes.new("ShaderNodeBsdfTransparent")
    links.new(back.outputs[0], add.inputs[0])
    links.new(emit.outputs[0], add.inputs[1])
    links.new(add.outputs[0], out.inputs[0])
    return mat


def glow_material(name, color, strength):
    """A see-through glow (holographic wireframes and rings)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    emit.inputs["Strength"].default_value = strength
    add = nodes.new("ShaderNodeAddShader")
    links.new(nodes.new("ShaderNodeBsdfTransparent").outputs[0], add.inputs[0])
    links.new(emit.outputs[0], add.inputs[1])
    links.new(add.outputs[0], out.inputs[0])
    return mat


def glass_material():
    """The window: clear, with a faint reflection of the deck."""
    mat = bpy.data.materials.new("window glass")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")
    fresnel = nodes.new("ShaderNodeLayerWeight")
    fresnel.inputs["Blend"].default_value = 0.08
    links.new(fresnel.outputs["Fresnel"], mix.inputs[0])
    links.new(nodes.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
    gloss = nodes.new("ShaderNodeBsdfGlossy")
    gloss.inputs["Roughness"].default_value = 0.03
    links.new(gloss.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    return mat


# ---- Space: the nebula and stars (world), the planet and its moon ----


def space(nodes, links):
    d = nodes.new("ShaderNodeTexCoord").outputs["Generated"]

    # The nebula follows a broad band across the sky, rising behind the screen to the right.
    band_n = Vector((0.5, -0.22, 0.84)).normalized()
    across = V(nodes, links, "DOT_PRODUCT", d, tuple(band_n))
    in_band = M(nodes, links, "EXPONENT", M(nodes, links, "MULTIPLY", M(nodes, links, "MULTIPLY", across, across), -7.0))
    warp = noise(nodes, links, d, 1.3, 4, 0.5)
    dw = V(nodes, links, "ADD", d, V(nodes, links, "SCALE", warp.outputs["Color"], scale=0.35))
    cloud = noise(nodes, links, dw, 2.2, 12, 0.62, 0.4)
    wisps = noise(nodes, links, dw, 6.5, 10, 0.68, 1.1)
    density = M(nodes, links, "MULTIPLY", smooth(nodes, links, cloud.outputs["Fac"], 0.42, 0.78), in_band)
    density = M(nodes, links, "MULTIPLY", density, M(nodes, links, "ADD", 0.35, smooth(nodes, links, wisps.outputs["Fac"], 0.35, 0.75)))
    # Dark dust lanes cut through it.
    dust = noise(nodes, links, dw, 4.0, 8, 0.6, 0.6)
    lanes = smooth(nodes, links, dust.outputs["Fac"], 0.52, 0.62)
    density = M(nodes, links, "MULTIPLY", density, M(nodes, links, "SUBTRACT", 1.0, M(nodes, links, "MULTIPLY", lanes, 0.85)))
    hue = noise(nodes, links, dw, 1.6, 3, 0.5)
    colour = ramp(nodes, links, hue.outputs["Fac"], [
        (0.30, (0.30, 0.06, 0.55)),
        (0.45, (0.55, 0.12, 0.50)),
        (0.58, (0.10, 0.20, 0.70)),
        (0.72, (0.04, 0.55, 0.62)),
    ])
    nebula = V(nodes, links, "SCALE", colour, scale=M(nodes, links, "MULTIPLY", density, 0.85))
    # A brighter heart above and right of the screen.
    heart_dir = direction(34, 38)
    near = M(nodes, links, "SUBTRACT", 1.0, V(nodes, links, "DOT_PRODUCT", d, tuple(heart_dir)))
    heart = M(nodes, links, "EXPONENT", M(nodes, links, "MULTIPLY", near, -9.0))
    heart = M(nodes, links, "MULTIPLY", heart, M(nodes, links, "ADD", 0.25, smooth(nodes, links, cloud.outputs["Fac"], 0.4, 0.8)))
    nebula = V(nodes, links, "ADD", nebula, V(nodes, links, "SCALE", (0.85, 0.45, 0.95), scale=M(nodes, links, "MULTIPLY", heart, 0.45)))
    # A faint deep-blue haze everywhere, so space isn't flat black.
    nebula = V(nodes, links, "ADD", nebula, (0.0025, 0.003, 0.008))

    # Stars: two scales of voronoi points, sparse bright ones and a dense faint field.
    def stars(scale, size, keep, power, gain):
        vor = nodes.new("ShaderNodeTexVoronoi")
        vor.voronoi_dimensions = "3D"
        links.new(d, vor.inputs["Vector"])
        vor.inputs["Scale"].default_value = scale
        vor.inputs["Randomness"].default_value = 1.0
        rnd = nodes.new("ShaderNodeRGBToBW")
        links.new(vor.outputs["Color"], rnd.inputs[0])
        r = rnd.outputs[0]
        on = M(nodes, links, "GREATER_THAN", r, keep)
        core = M(nodes, links, "LESS_THAN", vor.outputs["Distance"], size)
        bright = M(nodes, links, "POWER", M(nodes, links, "DIVIDE", M(nodes, links, "SUBTRACT", r, keep), 1.0 - keep), power)
        level = M(nodes, links, "MULTIPLY", M(nodes, links, "MULTIPLY", on, core), M(nodes, links, "MULTIPLY", bright, gain))
        tint = ramp(nodes, links, vor.outputs["Color"], [(0.0, (0.65, 0.78, 1.0)), (0.5, (1.0, 1.0, 1.0)), (1.0, (1.0, 0.82, 0.62))])
        return V(nodes, links, "SCALE", tint, scale=level)

    field = V(nodes, links, "ADD", stars(260, 0.14, 0.55, 3.0, 6.0), stars(90, 0.075, 0.6, 2.0, 40.0))
    # More stars where the nebula band runs, like a galaxy's plane.
    field = V(nodes, links, "SCALE", field, scale=M(nodes, links, "ADD", 0.45, M(nodes, links, "MULTIPLY", in_band, 1.2)))
    return V(nodes, links, "ADD", nebula, field)


def planet_material(radius):
    """An ocean world lit from behind and to the right: shaded in the shader itself."""
    mat = bpy.data.materials.new("planet")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    p = V(nodes, links, "SCALE", nodes.new("ShaderNodeTexCoord").outputs["Object"], scale=1.0 / radius)
    lit = V(nodes, links, "DOT_PRODUCT", V(nodes, links, "NORMALIZE", p), tuple(SUN))
    day = smooth(nodes, links, lit, -0.06, 0.45)
    # Oceans, a few continents, and banks of cloud swept along the latitudes.
    land = noise(nodes, links, p, 1.4, 8, 0.55, 0.3)
    is_land = smooth(nodes, links, land.outputs["Fac"], 0.6, 0.63)
    ground = mix_rgb(nodes, links, is_land, (0.008, 0.035, 0.08, 1), (0.05, 0.055, 0.045, 1))
    swirl = V(nodes, links, "MULTIPLY", p, (1.0, 1.0, 3.2))
    clouds = noise(nodes, links, swirl, 2.6, 10, 0.62, 1.6)
    cover = smooth(nodes, links, clouds.outputs["Fac"], 0.46, 0.7)
    surface_col = mix_rgb(nodes, links, cover, ground, (0.75, 0.8, 0.86, 1))
    # Haze thickens towards the limb.
    facing = nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    rim = M(nodes, links, "POWER", facing.outputs["Facing"], 3.5)
    surface_col = mix_rgb(nodes, links, M(nodes, links, "MULTIPLY", rim, 0.8), surface_col, (0.12, 0.35, 0.9, 1))
    # A warm touch along the terminator.
    dusk = M(nodes, links, "MULTIPLY", smooth(nodes, links, lit, -0.06, 0.03), smooth(nodes, links, lit, 0.12, 0.03))
    surface_col = mix_rgb(nodes, links, M(nodes, links, "MULTIPLY", dusk, 0.18), surface_col, (1.0, 0.55, 0.35, 1))
    emit = nodes.new("ShaderNodeEmission")
    links.new(surface_col, emit.inputs["Color"])
    links.new(M(nodes, links, "MULTIPLY", day, 2.4), emit.inputs["Strength"])
    links.new(emit.outputs[0], out.inputs[0])
    return mat


def atmosphere_material():
    mat = bpy.data.materials.new("atmosphere")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    geo = nodes.new("ShaderNodeNewGeometry")
    normal = V(nodes, links, "NORMALIZE", nodes.new("ShaderNodeTexCoord").outputs["Object"])
    lit = V(nodes, links, "DOT_PRODUCT", normal, tuple(SUN))
    # Lit where the sun reaches, plus a thin backlit glow all round the limb.
    wrap = M(nodes, links, "ADD", smooth(nodes, links, lit, -0.3, 0.5), 0.06)
    facing = nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    rim = M(nodes, links, "POWER", facing.outputs["Facing"], 5.0)
    # Fades out right at the very edge, so the glow has a soft outer falloff.
    edge = smooth(nodes, links, facing.outputs["Facing"], 1.0, 0.9)
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.3, 0.62, 1.0, 1)
    front = M(nodes, links, "SUBTRACT", 1.0, geo.outputs["Backfacing"])
    strength = M(nodes, links, "MULTIPLY", M(nodes, links, "MULTIPLY", rim, wrap), M(nodes, links, "MULTIPLY", edge, 16.0))
    strength = M(nodes, links, "MULTIPLY", strength, front)
    links.new(strength, emit.inputs["Strength"])
    add = nodes.new("ShaderNodeAddShader")
    links.new(nodes.new("ShaderNodeBsdfTransparent").outputs[0], add.inputs[0])
    links.new(emit.outputs[0], add.inputs[1])
    links.new(add.outputs[0], out.inputs[0])
    return mat


def moon_material(radius):
    mat = bpy.data.materials.new("moon")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    geo = nodes.new("ShaderNodeNewGeometry")
    p = V(nodes, links, "SCALE", nodes.new("ShaderNodeTexCoord").outputs["Object"], scale=1.0 / radius)
    day = smooth(nodes, links, V(nodes, links, "DOT_PRODUCT", V(nodes, links, "NORMALIZE", p), tuple(SUN)), -0.02, 0.35)
    rock = noise(nodes, links, p, 3.0, 8, 0.6)
    col = ramp(nodes, links, rock.outputs["Fac"], [(0.35, (0.25, 0.23, 0.22)), (0.65, (0.5, 0.48, 0.46))])
    emit = nodes.new("ShaderNodeEmission")
    links.new(col, emit.inputs["Color"])
    links.new(M(nodes, links, "MULTIPLY", day, 2.2), emit.inputs["Strength"])
    links.new(emit.outputs[0], out.inputs[0])
    return mat


def build_space():
    A.world(strength=1.0, shader=space)
    bpy.context.scene.camera.data.clip_end = 5000
    eye = Vector((0, 0, A.EYE_HEIGHT))
    dist = 1500.0
    pr = dist * math.sin(math.radians(21))
    centre = eye + direction(-60, 6) * dist
    A.sphere(pr, tuple(centre), planet_material(pr), name="planet", segments=96)
    A.sphere(pr * 1.022, tuple(centre), atmosphere_material(), name="atmosphere", segments=96)
    mr = dist * math.sin(math.radians(2.2))
    A.sphere(mr, tuple(eye + direction(70, 16) * dist), moon_material(mr), name="moon", segments=48)


# ---- The room ----


def build():
    build_space()

    floor = floor_material("deck floor", 0.22, 0.4)
    dais_floor = floor_material("dais floor", 0.5, 0.65, radial_deg=30, ring_step=0.75, dark=0.55)
    hull = hull_material("hull", (0.05, 0.055, 0.066))
    under = hull_material("overhang", (0.04, 0.043, 0.05), az_step=4.0, el_step=3.0)
    wall = hull_material("bulkhead", (0.045, 0.048, 0.056), az_step=2.0, el_step=9.0)
    rib = A.material("rib", (0.07, 0.075, 0.085), roughness=0.32, metallic=0.9)
    trim = A.material("trim", (0.32, 0.34, 0.38), roughness=0.22, metallic=1.0)
    dark = A.material("dark metal", (0.02, 0.022, 0.026), roughness=0.4, metallic=0.8)
    leather = A.material("crew seat", (0.03, 0.032, 0.038), roughness=0.55, coat=0.3)
    deck = A.layer("deck")
    holo = A.layer("holo")
    line = A.emissive("deck line", BLUE, LINE)
    guide = A.emissive("guide line", BLUE, GUIDE)
    cx = (C.x, C.y)

    # ---- Floor: the dais, one step, the deck ----
    A.cylinder(DOME_A + 0.6, 0.4, (C.x, C.y, DECK_Z - 0.2), floor, vertices=160, name="deck floor")
    A.cylinder(DAIS_R, 0.6, (0, 0, -0.3), dais_floor, vertices=128, name="dais")
    A.cylinder(DAIS_R + 0.55, 0.3, (0, 0, DECK_Z + 0.15), dais_floor, vertices=128, name="dais step")
    band("dais edge", DAIS_R + 0.002, -0.06, -0.01, trim)
    band("dais glow", DAIS_R + 0.006, -0.16, -0.12, guide)
    band("dais glow lit", DAIS_R + 0.01, -0.16, -0.12, line, deck)
    band("step glow", DAIS_R + 0.556, DECK_Z + 0.22, DECK_Z + 0.25, guide)
    band("step glow lit", DAIS_R + 0.56, DECK_Z + 0.22, DECK_Z + 0.25, line, deck)
    # Light inlays in the deck: rings round the dais, and spokes out to the ribs.
    for r in (4.6, 9.0):
        ring("inlay", r - 0.02, r + 0.02, DECK_Z + 0.002, guide)
        ring("inlay lit", r - 0.02, r + 0.02, DECK_Z + 0.004, line, deck)
    for phi in RIBS:
        foot = dome(phi, 0.3, 0.6)[0]
        az = math.degrees(math.atan2(foot.x, foot.y))
        length = math.hypot(foot.x, foot.y) - 3.2
        for mat, coll, z in ((guide, "base", 0.002), (line, deck, 0.004)):
            A.plane((0.04, length), polar(3.2 + length / 2, az, DECK_Z + z), mat, coll=coll,
                    rotation=(0, 0, -az), name="spoke")

    # ---- The window: glass, sill and ribs ----
    bottom = -4.0
    surface("glass", lambda u, v: dome(-90 + 180 * u, bottom + (CROWN - bottom) * v, -0.02)[0],
            96, 48, glass_material())
    band("sill wall", DOME_A - 0.5, DECK_Z, 0.25, hull, p0=-92, p1=92, centre=cx)
    ring("sill ledge", DOME_A - 0.8, DOME_A + 0.1, 0.25, trim, p0=-92, p1=92, centre=cx)
    band("sill light", DOME_A - 0.82, 0.12, 0.2, line, deck, p0=-90, p1=90, centre=cx)
    band("sill glow", DOME_A - 0.53, DECK_Z + 0.02, DECK_Z + 0.06, guide, p0=-90, p1=90, centre=cx)
    for phi in RIBS:
        sweep("rib", meridian(phi, bottom, CROWN), 0.32, 0.55, rib, bevel=0.03)
        sweep("rib light", meridian(phi, 2, CROWN - 2, inset=0.56), 0.05, 0.012, line, deck)
    # The great arch across the zenith, between the window and the hull behind.
    for phi in (90, -90):
        sweep("arch", meridian(phi, -8, 90, steps=90), 1.1, 1.1, rib, bevel=0.05)
        for off in (-0.42, 0.42):
            frames = [(p + s * off, n, s) for p, n, s in meridian(phi, 0, 90, steps=90, inset=1.11)]
            sweep("arch light", frames, 0.06, 0.012, line, deck)
    # Rings across the window, and the crown where the ribs meet.
    for theta in (36, 60):
        sweep("ring", parallel(theta, -90, 90), 0.24, 0.42, rib, bevel=0.025)
    sweep("crown", parallel(CROWN, -90, 270, steps=180), 0.7, 0.9, rib, bevel=0.04)
    surface("crown cap", lambda u, v: dome(-90 + 360 * u, CROWN + (90 - CROWN) * v, 0.3)[0], 96, 6, hull)
    sweep("crown light", parallel(CROWN - 1.9, -90, 270, steps=180, inset=0.91), 0.08, 0.01, line, deck)
    sweep("sill beam", parallel(bottom, -92, 92), 0.4, 0.6, rib, bevel=0.03)

    # ---- The hull behind: plating, ribs and rings ----
    surface("hull", lambda u, v: dome(90 + 180 * u, -6 + (CROWN + 1 - -6) * v)[0], 120, 60, hull)
    for theta in (36, 60):
        sweep("hull ring", parallel(theta, 90, 270), 0.24, 0.42, rib, bevel=0.025)
        sweep("hull ring light", parallel(theta - 1.4, 90, 270, inset=0.43), 0.06, 0.01, line, deck)
    for phi in (112, 134, 156, 180, 204, 226, 248):
        sweep("hull rib", meridian(phi, 18, CROWN), 0.32, 0.55, rib, bevel=0.03)

    # ---- The rear: a low overhang over a ring of consoles, closed by a bulkhead ----
    p0, p1 = 104, 256
    far = 15.5  # past the hull; the hull hides the rest
    ring("overhang", OVERHANG_R, far, OVERHANG_Z, under, p0=p0, p1=p1)
    ring("overhang top", OVERHANG_R, far, OVERHANG_Z + 0.45, hull, p0=p0, p1=p1)
    band("overhang fascia", OVERHANG_R, OVERHANG_Z, OVERHANG_Z + 0.45, rib, p0=p0, p1=p1)
    band("fascia light", OVERHANG_R - 0.005, OVERHANG_Z + 0.04, OVERHANG_Z + 0.08, line, deck, p0=p0, p1=p1)
    band("fascia glow", OVERHANG_R - 0.003, OVERHANG_Z + 0.04, OVERHANG_Z + 0.08, guide, p0=p0, p1=p1)
    for phi in (p0, p1):
        A.box((0.3, far - OVERHANG_R, 0.5), polar((far + OVERHANG_R) / 2, phi, OVERHANG_Z + 0.22), rib,
              rotation=(0, 0, -phi), bevel=0.02, name="overhang end")
    bulkhead = BULKHEAD_R
    band("bulkhead", bulkhead, DECK_Z, OVERHANG_Z, wall, p0=p0 - 6, p1=p1 + 6)
    band("bulkhead light", bulkhead - 0.01, 2.2, 2.26, line, deck, p0=p0, p1=p1)
    band("bulkhead glow", bulkhead - 0.005, DECK_Z + 0.08, DECK_Z + 0.11, guide, p0=p0, p1=p1)
    for phi in range(p0 + 4, p1, 8):
        A.box((0.16, 0.12, OVERHANG_Z - DECK_Z), polar(bulkhead - 0.06, phi, (OVERHANG_Z + DECK_Z) / 2), rib,
              rotation=(0, 0, -phi), bevel=0.02, name="bulkhead rib")
    for phi in range(p0 + 8, p1 - 4, 24):
        A.cylinder(0.12, OVERHANG_Z - DECK_Z, polar(OVERHANG_R + 0.15, phi, (OVERHANG_Z + DECK_Z) / 2), rib,
                   vertices=24, name="pillar")
        A.cylinder(0.125, 0.03, polar(OVERHANG_R + 0.15, phi, 1.6), A.emissive("pillar ring", BLUE, 6.0),
                   coll=deck, vertices=24, name="pillar light")
    # Uplights on top of the overhang, washing the hull plating above it.
    for phi in range(p0 + 16, p1 - 6, 24):
        A.area_light((2.0, 0.6), polar(9.0, phi, OVERHANG_Z + 0.6), (180, 0, -phi), (0.5, 0.68, 1.0), 220,
                     coll=deck, name="hull uplight")
    # Downlights under the overhang, and a dim night light there that stays on.
    for phi in range(p0 + 14, p1 - 6, 16):
        for r in (7.0, 9.8):
            A.cylinder(0.14, 0.02, polar(r, phi, OVERHANG_Z - 0.005), A.emissive("downlight", WHITE, 10.0),
                       coll=deck, vertices=20, name="downlight")
    for phi in range(p0 + 16, p1 - 6, 32):
        A.area_light((1.5, 1.5), polar(8.6, phi, OVERHANG_Z - 0.1), (0, 0, 0), WHITE, 260, coll=deck, name="overhang wash")
        A.area_light((1.5, 1.5), polar(10.0, phi, OVERHANG_Z - 0.1), (0, 0, 0), BLUE, NIGHT, name="night light")

    # ---- Consoles in a ring at the back, each with a crew seat and a holo panel ----
    screen = holo_material("console screen", CYAN, 3.0, opaque=True, density=5.0)
    panel = holo_material("holo panel", CYAN, 1.6, density=3.0)
    for phi in (128, 150, 172, 188, 210, 232):
        console(phi, dark, trim, screen, panel, leather, holo)
    holo_table(dark, trim, holo)

    # ---- Lounge chairs by the window, out to the sides ----
    for phi in (-64, -78, 64, 78):
        lounge_chair(10.2, phi, leather, trim)
    for phi in (-71, 71):
        A.cylinder(0.3, 0.04, polar(10.3, phi, DECK_Z + 0.48), dark, vertices=32, name="side table")
        A.cylinder(0.04, 0.46, polar(10.3, phi, DECK_Z + 0.23), trim, vertices=12, name="side table leg")
        A.cylinder(0.05, 0.08, polar(10.3, phi, DECK_Z + 0.54), A.emissive("table lamp", (0.6, 0.8, 1.0), 12.0),
                   coll=deck, vertices=16, name="table lamp")
        A.point_light(polar(10.3, phi, DECK_Z + 0.75), (0.6, 0.8, 1.0), 12, radius=0.05, coll=deck, name="table lamp")

    # ---- Lights ----
    # The ceiling wash from the crown, and soft fill along the sill (lights up).
    A.area_light((4.0, 4.0), (C.x, C.y, C.z + DOME_C - 1.5), (0, 0, 0), WHITE, CROWN_WASH, coll=deck, name="crown wash")
    for phi in (-60, 0, 60):
        p = dome(phi, 3, 1.4)[0]
        A.area_light((3.0, 1.0), (p.x, p.y, 0.6), (0, 0, -phi), BLUE, 300, coll=deck, name="sill wash")
    # Light from space: the nebula's violet glow from ahead and above, the planet's blue from the left.
    A.area_light((24.0, 10.0), (0, 16.0, 9.0), (-65, 0, 0), (0.55, 0.45, 1.0), SPACE_FILL, name="nebula glow")
    p = Vector((0, 0, A.EYE_HEIGHT)) + direction(-60, 6) * 17
    A.area_light((12.0, 12.0), tuple(p), (90, 0, 180 + 60), (0.45, 0.65, 1.0), SPACE_FILL * 0.6, name="planet shine")
    # A faint cool spill from the film's panel: how the deck looks while a film plays.
    half, low, top = A.screen_rect(5.0)
    A.area_light((2 * half, top - low), (0, 5.0, (top + low) / 2), (90, 0, 180), (0.7, 0.78, 1.0), SPILL,
                 name="screen spill")

    build_seat()


def console(phi, dark, trim, screen, panel, leather, holo):
    """A crew console at the back, facing the dais: desk, slanted screen, holo panel and seat."""
    r = 7.8
    def at(dr, z):
        return polar(r + dr, phi, z)
    A.box((1.5, 0.7, 0.85), at(0.0, DECK_Z + 0.425), dark, rotation=(0, 0, -phi), bevel=0.03, name="console")
    A.box((1.56, 0.76, 0.05), at(0.0, DECK_Z + 0.87), trim, rotation=(0, 0, -phi), bevel=0.01, name="console top")
    # Slanted screen at the back of the desk, facing in.
    A.box((1.4, 0.04, 0.6), at(0.3, DECK_Z + 1.2), dark, rotation=(-20, 0, -phi), bevel=0.01, name="screen bezel")
    A.plane((1.3, 0.52), at(0.27, DECK_Z + 1.21), screen, coll=holo, rotation=(70, 0, -phi), name="console screen")
    # Inset deck panel glowing on the desk.
    A.plane((1.2, 0.35), at(-0.05, DECK_Z + 0.9), screen, coll=holo, rotation=(0, 0, -phi), name="desk display")
    # A floating holo panel above it.
    A.plane((1.2, 0.7), at(0.1, DECK_Z + 2.15), panel, coll=holo, rotation=(80, 0, -phi), name="holo panel")
    A.point_light(at(-0.6, DECK_Z + 1.4), CYAN, 40, radius=0.3, coll=holo, name="console glow")
    # The crew seat in front of it, its back to the viewer.
    crew_seat(r - 1.05, phi, leather, trim)


def crew_seat(r, phi, leather, trim):
    def at(dr, z):
        return polar(r + dr, phi, z)
    A.cylinder(0.05, 0.4, at(0, DECK_Z + 0.2), trim, vertices=12, name="crew pedestal")
    A.box((0.5, 0.48, 0.1), at(0, DECK_Z + 0.46), leather, rotation=(0, 0, -phi), bevel=0.03, name="crew seat")
    A.box((0.48, 0.1, 0.6), at(-0.24, DECK_Z + 0.82), leather, rotation=(8, 0, -phi), bevel=0.04, name="crew back")


def holo_table(dark, trim, holo):
    """A round holo table behind the dais, with a wireframe globe over it."""
    centre = polar(5.6, 180, 0)
    x, y, _ = centre
    A.cylinder(0.9, 0.85, (x, y, DECK_Z + 0.425), dark, vertices=64, name="holo table")
    A.cylinder(0.95, 0.05, (x, y, DECK_Z + 0.87), trim, vertices=64, name="holo table rim")
    A.cylinder(0.82, 0.01, (x, y, DECK_Z + 0.9), A.emissive("holo table top", CYAN, 3.0), coll=holo, vertices=64, name="holo table top")
    globe = A.sphere(0.55, (x, y, DECK_Z + 1.75), glow_material("holo globe", CYAN, 2.2), coll=holo, name="holo globe", segments=24)
    mod = globe.modifiers.new("wire", "WIREFRAME")
    mod.thickness = 0.008
    A.sphere(0.53, (x, y, DECK_Z + 1.75), glow_material("holo haze", CYAN, 0.15), coll=holo, name="holo haze", segments=32)
    for z, rr in ((DECK_Z + 1.75, 0.8), (DECK_Z + 1.1, 0.7)):
        orbit = ring("holo orbit", rr - 0.008, rr + 0.008, 0, glow_material("holo orbit", CYAN, 4.0), coll=holo, steps=96)
        orbit.location = (x, y, z)
        orbit.rotation_euler = (math.radians(14), 0, 0) if z > 1 else (0, 0, 0)
    A.point_light((x, y, DECK_Z + 1.75), CYAN, 120, radius=0.5, coll=holo, name="globe glow")


def lounge_chair(r, phi, leather, trim):
    """A low lounge chair facing out of the window."""
    rot = -phi
    def at(dr, z):
        return polar(r + dr, phi, z)
    A.box((0.75, 0.75, 0.3), at(0, DECK_Z + 0.25), leather, rotation=(0, 0, rot), bevel=0.06, name="lounge seat")
    A.box((0.75, 0.2, 0.6), at(-0.36, DECK_Z + 0.55), leather, rotation=(15, 0, rot), bevel=0.07, name="lounge back")
    A.box((0.6, 0.6, 0.06), at(0, DECK_Z + 0.06), trim, rotation=(0, 0, rot), bevel=0.02, name="lounge base")


# ---- The viewer's command chair (a 3D model in the app) ----


def build_seat():
    seat = "seat"
    plate = A.material("plate", (0.045, 0.05, 0.06), roughness=0.32, metallic=0.85)
    groove = A.material("plate groove", (0.012, 0.013, 0.016), roughness=0.5, metallic=0.6)
    shell = A.material("chair shell", (0.06, 0.064, 0.072), roughness=0.3, metallic=0.9)
    upholstery = A.material("chair upholstery", (0.028, 0.03, 0.035), roughness=0.6, coat=0.2)
    steel = A.material("chair steel", (0.38, 0.4, 0.44), roughness=0.22, metallic=1.0)
    accent = A.material("chair accent", (0.0, 0.0, 0.0), roughness=0.4, emission=BLUE, strength=4.0)
    ring_glow = A.material("plate ring", (0.0, 0.0, 0.0), roughness=0.4, emission=BLUE, strength=2.5)
    button = A.material("chair button", (0.0, 0.0, 0.0), roughness=0.4, emission=CYAN, strength=3.0)
    amber = A.material("chair indicator", (0.0, 0.0, 0.0), roughness=0.4, emission=(1.0, 0.55, 0.2), strength=3.0)

    # The floor plate, with a glowing ring and a groove.
    A.cylinder(1.5, 0.03, (0, 0, 0.015), plate, coll=seat, vertices=96, name="floor plate")
    ring("plate ring", 1.33, 1.36, 0.031, ring_glow, coll=seat, steps=96)
    ring("plate groove", 1.42, 1.44, 0.031, groove, coll=seat, steps=96)
    ring("plate groove", 0.62, 0.64, 0.031, groove, coll=seat, steps=64)
    # Pedestal.
    A.cylinder(0.36, 0.05, (0, -0.02, 0.055), shell, coll=seat, vertices=48, name="pedestal base")
    A.cylinder(0.13, 0.26, (0, -0.02, 0.2), steel, coll=seat, vertices=32, name="pedestal")
    A.cylinder(0.135, 0.015, (0, -0.02, 0.12), accent, coll=seat, vertices=32, name="pedestal ring")
    # Seat, back and headrest, in a dark shell.
    A.box((0.64, 0.6, 0.08), (0, 0.0, 0.34), shell, coll=seat, bevel=0.03, name="seat shell")
    A.box((0.58, 0.56, 0.1), (0, 0.01, 0.42), upholstery, coll=seat, bevel=0.04, name="seat cushion")
    A.box((0.66, 0.14, 0.86), (0, -0.36, 0.86), shell, coll=seat, rotation=(12, 0, 0), bevel=0.04, name="back shell")
    A.box((0.56, 0.08, 0.78), (0, -0.29, 0.87), upholstery, coll=seat, rotation=(12, 0, 0), bevel=0.035, name="back cushion")
    A.box((0.12, 0.06, 0.16), (0, -0.47, 1.3), steel, coll=seat, rotation=(12, 0, 0), bevel=0.01, name="headrest stem")
    A.box((0.38, 0.12, 0.2), (0, -0.48, 1.42), shell, coll=seat, rotation=(12, 0, 0), bevel=0.05, name="headrest")
    for side in (-1, 1):
        A.box((0.015, 0.05, 0.78), (side * 0.335, -0.39, 0.86), accent, coll=seat, rotation=(12, 0, 0), name="back accent")
        # Armrests, with a control pad at the front.
        A.box((0.1, 0.26, 0.24), (side * 0.37, -0.06, 0.48), shell, coll=seat, bevel=0.02, name="arm post")
        A.box((0.13, 0.58, 0.06), (side * 0.38, 0.02, 0.63), shell, coll=seat, bevel=0.02, name="armrest")
        A.box((0.11, 0.42, 0.025), (side * 0.38, -0.04, 0.665), upholstery, coll=seat, bevel=0.01, name="arm pad")
        A.box((0.006, 0.5, 0.012), (side * 0.448, 0.02, 0.63), accent, coll=seat, name="arm accent")
        A.box((0.12, 0.13, 0.02), (side * 0.38, 0.24, 0.67), A.material("pad glass", (0.01, 0.012, 0.016), roughness=0.1),
              coll=seat, rotation=(8, 0, 0), bevel=0.005, name="control pad")
        for i in range(3):
            A.box((0.022, 0.022, 0.008), (side * 0.38 + (i - 1) * 0.032, 0.25, 0.682), button if i != 1 or side < 0 else amber,
                  coll=seat, rotation=(8, 0, 0), name="button")
