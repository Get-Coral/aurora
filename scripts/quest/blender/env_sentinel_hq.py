"""
Sentinel HQ: a sky-tower penthouse command lounge at night.

Floor-to-ceiling glass on the front and sides looks out over a vast city far
below: thousands of towers with warm and cool lit windows, glowing street
grids, a hazy night sky and a low moon. Inside, a polished dark stone floor
reflects it all; slim brushed-metal pillars, a ceiling coffer with light
lines running towards the front, wall-sized tactical displays on either side,
a long tactical table with a holographic relief map, and the film's panel
framed by a slim display rig as the room's mega display. All original.

Light layers:
- room: the ceiling light lines and coves, the rig's edge glow, the lights
  at the back. Up while the film isn't playing, nearly off while it plays.
- displays: the tactical walls, the console screens and the table's map.
  Mostly on all the time; the app gives them a faint shimmer.
The city, the sky and the moon are the base: they're out there either way.
"""

import math
import random

import bmesh
import bpy

import aurora_scene as A

SAMPLES = 128

WALL_X = 10.0
FRONT_Y = 9.0
BACK_Y = -6.0
CEIL_Z = 4.4
COFFER_Z = 4.95
COFFER_X = 6.5
COFFER_Y = (-4.6, 7.4)
SIDE_GLASS_Y = 2.6  # the side walls are glass from here to the front
RIG_Y = 5.8
CITY_Z = -190.0
BLOCK = 90.0

WARM = (1.0, 0.86, 0.7)
CYAN = (0.12, 0.62, 1.0)
AMBER = (1.0, 0.5, 0.12)
HORIZON = (0.03, 0.034, 0.055)
ZENITH = (0.004, 0.006, 0.016)
MOON_DIR = (-0.575, 0.791, 0.208)  # 36 degrees left of ahead, 12 degrees up


# ---- A small node-building toolkit ----


class G:
    def __init__(self, nodes, links):
        self.nodes, self.links = nodes, links

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        for key, value in props.items():
            setattr(n, key, value)
        return n

    def link(self, sock, val):
        if val is None:
            return
        if isinstance(val, bpy.types.NodeSocket):
            self.links.new(val, sock)
            return
        if sock.type in ("VECTOR", "RGBA") and isinstance(val, (int, float)):
            val = (val, val, val)
        if sock.type == "RGBA" and len(val) == 3:
            val = (*val, 1.0)
        sock.default_value = val

    def m(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        for sock, val in zip(n.inputs, (a, b, c)):
            self.link(sock, val)
        return n.outputs[0]

    def v(self, op, a, b=None, scale=None):
        n = self.node("ShaderNodeVectorMath", operation=op)
        self.link(n.inputs[0], a)
        if b is not None:
            self.link(n.inputs[1], b)
        if scale is not None:
            self.link(n.inputs["Scale"], scale)
        return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]

    def add(self, a, b):
        return self.m("ADD", a, b)

    def mul(self, a, b):
        return self.m("MULTIPLY", a, b)

    def sub(self, a, b):
        return self.m("SUBTRACT", a, b)

    def frac(self, a):
        return self.m("FRACT", a)

    def gt(self, a, b):
        return self.m("GREATER_THAN", a, b)

    def lt(self, a, b):
        return self.m("LESS_THAN", a, b)

    def band(self, x, lo, hi):
        return self.mul(self.gt(x, lo), self.lt(x, hi))

    def xyz(self, x=0.0, y=0.0, z=0.0):
        n = self.node("ShaderNodeCombineXYZ")
        for sock, val in zip(n.inputs, (x, y, z)):
            self.link(sock, val)
        return n.outputs[0]

    def sep(self, vec):
        n = self.node("ShaderNodeSeparateXYZ")
        self.link(n.inputs[0], vec)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def white(self, vec):
        n = self.node("ShaderNodeTexWhiteNoise", noise_dimensions="3D")
        self.link(n.inputs["Vector"], vec)
        return n.outputs["Value"]

    def noise(self, vec, scale=1.0, detail=2.0, rough=0.5, distortion=0.0):
        n = self.node("ShaderNodeTexNoise")
        self.link(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = distortion
        return n.outputs["Fac"]

    def voronoi(self, vec, scale=1.0):
        n = self.node("ShaderNodeTexVoronoi")
        self.link(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        return n.outputs["Distance"]

    def mixc(self, a, b, t):
        return self.v("ADD", a, self.v("MULTIPLY", self.v("SUBTRACT", b, a), t))

    def emission(self, color, strength=1.0):
        n = self.node("ShaderNodeEmission")
        self.link(n.inputs["Color"], color)
        self.link(n.inputs["Strength"], strength)
        return n.outputs[0]

    def principled(self, **inputs):
        n = self.node("ShaderNodeBsdfPrincipled")
        for key, val in inputs.items():
            self.link(n.inputs[key.replace("_", " ")], val)
        return n.outputs[0]

    def mix_shader(self, fac, a, b):
        n = self.node("ShaderNodeMixShader")
        self.link(n.inputs[0], fac)
        self.links.new(a, n.inputs[1])
        self.links.new(b, n.inputs[2])
        return n.outputs[0]

    def add_shader(self, a, b):
        n = self.node("ShaderNodeAddShader")
        self.links.new(a, n.inputs[0])
        self.links.new(b, n.inputs[1])
        return n.outputs[0]

    def coord(self, kind="Object"):
        return self.node("ShaderNodeTexCoord").outputs[kind]


def node_material(name, build, emission_sampling=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    g = G(nt.nodes, nt.links)
    out = g.node("ShaderNodeOutputMaterial")
    nt.links.new(build(g), out.inputs["Surface"])
    if emission_sampling:
        for owner in (mat, getattr(mat, "cycles", None)):
            if owner is not None and hasattr(owner, "emission_sampling"):
                owner.emission_sampling = emission_sampling
    return mat


def hidden_area(size, location, rotation, color, power, coll, name="area"):
    """An area light that lights the room without showing up as a panel itself."""
    obj = A.area_light(size, location, rotation, color, power, coll=coll, name=name)
    obj.visible_camera = False
    obj.visible_glossy = False  # the glowing strips themselves show in the polished floor
    return obj


# ---- Materials ----


def brushed_metal(name, color, roughness=0.3, streak=(1, 1, 70)):
    def build(g):
        co = g.v("MULTIPLY", g.coord(), streak)
        n = g.noise(co, scale=3.0, detail=4)
        bump = g.node("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.04
        g.link(bump.inputs["Height"], n)
        bsdf = g.node("ShaderNodeBsdfPrincipled")
        g.link(bsdf.inputs["Base Color"], color)
        bsdf.inputs["Metallic"].default_value = 1.0
        g.link(bsdf.inputs["Roughness"], g.m("MULTIPLY_ADD", n, 0.12, roughness - 0.06))
        bsdf.inputs["Anisotropic"].default_value = 0.5
        g.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        return bsdf.outputs[0]

    return node_material(name, build)


def stone_floor():
    """Polished black stone in large tiles, faintly veined, mirror-like."""

    def build(g):
        x, y, _ = g.sep(g.coord())
        tx, ty = g.m("DIVIDE", x, 1.5), g.m("DIVIDE", y, 1.5)
        seam = g.m("MAXIMUM", g.band(g.frac(tx), -1, 0.003), g.band(g.frac(ty), -1, 0.003))
        tile = g.white(g.xyz(g.m("FLOOR", tx), g.m("FLOOR", ty), 3.0))
        vein_n = g.noise(g.coord(), scale=0.45, detail=8, rough=0.6, distortion=1.2)
        vein = g.band(g.frac(g.mul(vein_n, 7.0)), 0.0, 0.02)
        base = g.m("MULTIPLY_ADD", tile, 0.005, 0.008)
        val = g.m("MULTIPLY_ADD", vein, 0.008, base)
        val = g.m("MULTIPLY", val, g.m("SUBTRACT", 1.0, g.mul(seam, 0.7)))
        color = g.v("MULTIPLY", (0.9, 0.95, 1.05), val)
        rough_n = g.noise(g.coord(), scale=1.3, detail=3)
        rough = g.m("MULTIPLY_ADD", rough_n, 0.07, 0.04)
        rough = g.m("MAXIMUM", rough, g.mul(seam, 0.6))
        return g.principled(Base_Color=color, Roughness=rough)

    return node_material("stone floor", build)


def fluted(name, color, roughness, pitch=0.06, axis="X"):
    """Wall panels with fine vertical flutes."""

    def build(g):
        x, y, z = g.sep(g.coord())
        h = g.add(x, y)
        wave = g.m("SINE", g.mul(h, 2 * math.pi / pitch))
        bump = g.node("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35
        g.link(bump.inputs["Height"], g.mul(wave, 0.5))
        grain = g.noise(g.v("MULTIPLY", g.coord(), (6, 6, 0.3)), scale=4, detail=5)
        col = g.v("MULTIPLY", color, g.m("MULTIPLY_ADD", grain, 0.5, 0.75))
        bsdf = g.node("ShaderNodeBsdfPrincipled")
        g.link(bsdf.inputs["Base Color"], col)
        bsdf.inputs["Roughness"].default_value = roughness
        g.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        return bsdf.outputs[0]

    return node_material(name, build)


def glass_material():
    """Thin clear glazing: lets the city straight through, reflects the room."""

    def build(g):
        clear = g.node("ShaderNodeBsdfTransparent")
        clear.inputs["Color"].default_value = (0.86, 0.9, 0.93, 1)
        sheen = g.principled(Base_Color=(0, 0, 0), Roughness=0.015, IOR=1.6)
        return g.add_shader(clear.outputs[0], sheen)

    return node_material("glass", build)


def display_material(name, width, height, cols, rows, seed=0.0, strength=4.0):
    """An abstract tactical display: tiles of maps, bar charts, radar rings, data rows and graphs.

    For a plane `width` x `height` (local X and Y, metres)."""

    def build(g):
        x, y, _ = g.sep(g.coord())
        u = g.mul(g.add(x, width / 2), cols / width)
        v = g.mul(g.add(y, height / 2), rows / height)
        ix, iy = g.m("FLOOR", u), g.m("FLOOR", v)
        fu, fv = g.frac(u), g.frac(v)
        tw, th = width / cols, height / rows
        inside = g.mul(g.band(fu, 0.012, 0.988), g.band(fv, 0.018, 0.982))
        r = g.white(g.xyz(ix, iy, seed))
        r2 = g.white(g.xyz(g.add(ix, 7.3), g.add(iy, 3.1), seed + 1.7))
        px, py = g.mul(fu, tw), g.mul(fv, th)

        grid = g.m("MAXIMUM", g.band(g.frac(g.mul(px, 10)), -1, 0.035), g.band(g.frac(g.mul(py, 10)), -1, 0.035))
        # A relief map: contour lines of noise, a few hot spots.
        n = g.noise(g.xyz(px, py, g.mul(r, 10)), scale=1.6, detail=4)
        contour = g.band(g.frac(g.mul(n, 15)), -1, 0.11)
        spots = g.lt(g.voronoi(g.xyz(px, py, g.mul(r, 5)), scale=3.5), 0.025)
        # Bar chart.
        col_i = g.m("FLOOR", g.mul(fu, 18))
        height_ = g.m("MULTIPLY_ADD", g.white(g.xyz(col_i, g.add(ix, g.mul(iy, 5)), seed + 2)), 0.72, 0.1)
        bar = g.mul(g.mul(g.band(g.frac(g.mul(fu, 18)), 0.22, 0.78), g.lt(fv, height_)), g.gt(fv, 0.06))
        cap = g.mul(bar, g.gt(fv, g.sub(height_, 0.025)))
        # Radar: rings, a crosshair, a sweep and blips.
        dx, dy = g.mul(g.sub(fu, 0.5), tw), g.mul(g.sub(fv, 0.5), th)
        d = g.v("LENGTH", g.xyz(dx, dy))
        radius = min(tw, th) * 0.44
        disc = g.lt(d, radius)
        rings = g.band(g.frac(g.mul(d, 5 / radius)), -1, 0.07)
        cross = g.m("MAXIMUM", g.lt(g.m("ABSOLUTE", dx), 0.004), g.lt(g.m("ABSOLUTE", dy), 0.004))
        angle = g.frac(g.add(g.m("DIVIDE", g.m("ARCTAN2", dy, dx), 2 * math.pi), g.add(r, 0.5)))
        sweep = g.mul(g.lt(angle, 0.12), g.sub(1.0, g.m("DIVIDE", angle, 0.12)))
        blips = g.lt(g.voronoi(g.xyz(px, py, r), scale=5.0), 0.03)
        radar = g.mul(disc, g.add(g.add(rings, g.mul(cross, 0.6)), g.mul(sweep, 0.45)))
        # Rows of data: bars of varying length.
        row = g.m("FLOOR", g.mul(fv, 14))
        length = g.m("MULTIPLY_ADD", g.white(g.xyz(row, ix, g.add(iy, seed))), 0.8, 0.12)
        in_row = g.band(g.frac(g.mul(fv, 14)), 0.3, 0.7)
        rows_ = g.mul(g.mul(in_row, g.lt(fu, length)), g.gt(fu, 0.12))
        tag = g.mul(in_row, g.band(fu, 0.04, 0.09))
        # Line graphs over a faint filled area.
        n1 = g.m("MULTIPLY_ADD", g.sub(g.noise(g.xyz(g.mul(fu, 2.5), g.mul(r, 7)), scale=1.0, detail=3), 0.5), 1.8, 0.5)
        n2 = g.m("MULTIPLY_ADD", g.sub(g.noise(g.xyz(g.mul(fu, 3.5), g.add(g.mul(r, 7), 3)), scale=1.0, detail=2), 0.5), 1.5, 0.45)
        line1 = g.lt(g.m("ABSOLUTE", g.sub(fv, n1)), 0.012)
        fill = g.mul(g.lt(fv, n1), 0.12)
        line2 = g.lt(g.m("ABSOLUTE", g.sub(fv, n2)), 0.008)

        is_map = g.lt(r, 0.3)
        is_bars = g.band(r, 0.3, 0.5)
        is_radar = g.band(r, 0.5, 0.64)
        is_rows = g.band(r, 0.64, 0.84)
        is_graph = g.gt(r, 0.84)
        primary = g.mul(grid, 0.18)
        for mask, val in ((is_map, contour), (is_bars, g.add(g.mul(bar, 0.55), cap)), (is_radar, radar),
                          (is_rows, g.mul(rows_, 0.6)), (is_graph, g.add(line1, fill))):
            primary = g.add(primary, g.mul(mask, val))
        accent = g.add(g.add(g.mul(is_map, spots), g.mul(g.mul(is_radar, disc), blips)),
                       g.add(g.mul(is_rows, tag), g.mul(is_graph, line2)))
        amber_tile = g.gt(r2, 0.8)
        prim_col = g.mixc(CYAN, (1.0, 0.72, 0.4), amber_tile)
        level = g.m("MULTIPLY_ADD", r2, 0.5, 0.7)
        col = g.v("ADD", g.v("MULTIPLY", prim_col, primary), g.v("MULTIPLY", AMBER, accent))
        col = g.v("ADD", col, (0.004, 0.018, 0.04))
        col = g.v("MULTIPLY", col, g.mul(inside, level))
        return g.emission(col, strength)

    return node_material(name, build)


def holo_material():
    """A see-through holographic relief: a glowing wire grid and contour lines."""

    def build(g):
        x, y, z = g.sep(g.coord())
        gx = g.band(g.frac(g.mul(x, 5)), -1, 0.05)
        gy = g.band(g.frac(g.mul(y, 5)), -1, 0.05)
        contour = g.band(g.frac(g.mul(z, 14)), -1, 0.1)
        mask = g.m("MINIMUM", g.add(g.add(g.mul(gx, 0.5), g.mul(gy, 0.5)), contour), 1.0)
        col = g.mixc(CYAN, (0.6, 0.9, 1.0), g.m("MULTIPLY", z, 1.4, clamp=True))
        glow = g.emission(col, g.m("MULTIPLY_ADD", mask, 2.6, 0.12))
        clear = g.node("ShaderNodeBsdfTransparent").outputs[0]
        return g.mix_shader(g.m("MULTIPLY_ADD", mask, 0.8, 0.08), clear, glow)

    return node_material("hologram", build)


# ---- The sky and the city ----


def sky(nodes, links):
    g = G(nodes, links)
    d = g.v("NORMALIZE", g.coord("Generated"))
    _, _, ez = g.sep(d)
    up = g.m("MAXIMUM", ez, 0.0)
    t = g.m("POWER", g.m("MINIMUM", g.mul(up, 3.0), 1.0), 0.6)
    col = g.mixc(HORIZON, ZENITH, t)
    # Light pollution: a warm band right on the horizon.
    glow = g.m("EXPONENT", g.mul(g.m("ABSOLUTE", ez), -16.0))
    col = g.v("ADD", col, g.v("MULTIPLY", (0.1, 0.06, 0.04), glow))
    # A thin, high cloud deck catching the city's glow.
    dx, dy, _ = g.sep(d)
    inv = g.m("DIVIDE", 1.0, g.m("MAXIMUM", ez, 0.03))
    cloud_co = g.xyz(g.mul(dx, inv), g.mul(dy, inv))
    cn = g.noise(cloud_co, scale=0.35, detail=6, rough=0.55, distortion=0.4)
    clouds = g.m("MULTIPLY", g.m("SUBTRACT", cn, 0.47), 4.0, clamp=True)
    fade = g.m("MULTIPLY", ez, 12.0, clamp=True)
    col = g.v("ADD", col, g.v("MULTIPLY", (0.035, 0.03, 0.034), g.mul(clouds, fade)))
    # The moon, with faint maria, and its halo.
    cos_a = g.v("DOT_PRODUCT", d, MOON_DIR)
    disc = g.gt(cos_a, math.cos(math.radians(1.0)))
    maria = g.m("MULTIPLY_ADD", g.noise(g.v("SCALE", d, scale=90.0), scale=1.0, detail=3), 0.45, 0.62)
    col = g.v("ADD", col, g.v("MULTIPLY", (1.0, 0.96, 0.88), g.mul(disc, g.mul(maria, 14.0))))
    halo = g.add(g.mul(g.m("POWER", g.m("MAXIMUM", cos_a, 0.0), 3000.0), 0.25),
                 g.mul(g.m("POWER", g.m("MAXIMUM", cos_a, 0.0), 60.0), 0.025))
    col = g.v("ADD", col, g.v("MULTIPLY", (0.7, 0.78, 0.95), halo))
    return col


def with_haze(g, shader, reach):
    """Fade a far surface into the night haze with distance."""
    dist = g.node("ShaderNodeCameraData").outputs["View Distance"]
    fac = g.sub(1.0, g.m("EXPONENT", g.m("DIVIDE", g.m("MULTIPLY", dist, -1.0), reach)))
    haze = g.emission(g.v("ADD", HORIZON, (0.012, 0.006, 0.0)), 1.0)
    return g.mix_shader(fac, shader, haze)


def tower_material():
    """Curtain-wall facades: a grid of windows, some lit warm, some cool, most dark."""

    def build(g):
        x, y, z = g.sep(g.coord())
        _, _, nz = g.sep(g.node("ShaderNodeNewGeometry").outputs["Normal"])
        wall = g.lt(g.m("ABSOLUTE", nz), 0.5)
        u = g.m("DIVIDE", g.add(x, y), 3.1)
        v = g.m("DIVIDE", g.sub(z, CITY_Z), 3.7)
        pane = g.mul(g.band(g.frac(u), 0.14, 0.86), g.band(g.frac(v), 0.22, 0.84))
        building = g.white(g.xyz(g.m("FLOOR", g.m("DIVIDE", x, 23.0)), g.m("FLOOR", g.m("DIVIDE", y, 29.0)), 1.0))
        cell = g.xyz(g.m("FLOOR", u), g.m("FLOOR", v), g.mul(building, 50))
        r = g.white(cell)
        r2 = g.white(g.v("ADD", cell, (3.7, 1.3, 0.0)))
        busy = g.m("MULTIPLY_ADD", building, 0.36, 0.05)  # some towers busy, some asleep
        lit = g.lt(r, busy)
        floors = g.noise(g.xyz(g.mul(x, 0.02), g.mul(y, 0.02), g.mul(v, 0.3)), scale=2.0, detail=1)
        lit = g.mul(lit, g.gt(floors, 0.36))
        cool = g.gt(r2, 0.74)
        tint = g.mixc((1.0, 0.66, 0.36), (0.62, 0.8, 1.0), cool)
        level = g.m("MULTIPLY_ADD", r2, 4.0, 1.0)
        emit = g.mul(g.mul(pane, lit), g.mul(wall, level))
        base = g.mixc((0.012, 0.014, 0.02), (0.02, 0.025, 0.035), pane)
        surface = g.principled(Base_Color=base, Roughness=0.3, Emission_Color=tint, Emission_Strength=emit)
        return with_haze(g, surface, 7000.0)

    return node_material("towers", build, emission_sampling="NONE")


def ground_material():
    """The streets far below: sodium-lit grids, brighter avenues, scattered lights between."""

    def build(g):
        x, y, _ = g.sep(g.coord())

        def to_line(a, pitch):
            return g.mul(g.m("ABSOLUTE", g.sub(g.frac(g.add(g.m("DIVIDE", a, pitch), 0.5)), 0.5)), pitch)

        street = g.m("MAXIMUM", g.lt(to_line(x, BLOCK), 6.0), g.lt(to_line(y, BLOCK), 6.0))
        avenue = g.m("MAXIMUM", g.lt(to_line(x, BLOCK * 5), 9.0), g.lt(to_line(y, BLOCK * 5), 9.0))
        vary = g.noise(g.xyz(g.mul(x, 0.002), g.mul(y, 0.002)), scale=3.0, detail=2)
        sodium = g.v("MULTIPLY", (1.0, 0.48, 0.16), g.mul(street, g.m("MULTIPLY_ADD", vary, 3.0, 0.8)))
        white = g.v("MULTIPLY", (1.0, 0.82, 0.6), g.mul(avenue, 5.0))
        specks = g.lt(g.voronoi(g.xyz(x, y), scale=0.06), 0.06)
        speck_col = g.v("MULTIPLY", (0.9, 0.7, 0.5), g.mul(specks, 2.5))
        col = g.v("ADD", g.v("ADD", sodium, white), speck_col)
        surface = g.principled(Base_Color=(0.01, 0.01, 0.012), Roughness=0.8, Emission_Color=col, Emission_Strength=1.0)
        return with_haze(g, surface, 6000.0)

    return node_material("streets", build, emission_sampling="NONE")


def add_box(bm, x0, x1, y0, y1, z0, z1):
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                    (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])


def mesh_object(bm, name, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return A._place(obj, "base", mat, (0, 0, 0), (0, 0, 0))


def build_city():
    rng = random.Random(11)
    towers, beacons, crowns = bmesh.new(), bmesh.new(), bmesh.new()
    clusters = [((-1500, 2000), 650, 3.4), ((2300, 3100), 850, 2.8), ((300, 5600), 1300, 2.2), ((-3200, 700), 700, 1.8)]
    n = int(5200 / BLOCK)
    for i in range(-n, n):
        for j in range(-2, n):
            cx, cy = (i + 0.5) * BLOCK, (j + 0.5) * BLOCK
            r = math.hypot(cx, cy)
            if r < 150 or r > 5200 or cy < -120:
                continue
            boost = 1 + sum(k * math.exp(-((cx - px) ** 2 + (cy - py) ** 2) / (2 * s * s)) for (px, py), s, k in clusters)
            split = rng.choice((1, 1, 2, 2, 4))
            lots = []
            half = 36.0
            if split == 1:
                lots.append((cx - half, cx + half, cy - half, cy + half))
            elif split == 2:
                if rng.random() < 0.5:
                    lots += [(cx - half, cx - 1, cy - half, cy + half), (cx + 1, cx + half, cy - half, cy + half)]
                else:
                    lots += [(cx - half, cx + half, cy - half, cy - 1), (cx - half, cx + half, cy + 1, cy + half)]
            else:
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        lots.append((cx + min(0, sx) * half + (sx > 0), cx + max(0, sx) * half - (sx < 0),
                                     cy + min(0, sy) * half + (sy > 0), cy + max(0, sy) * half - (sy < 0)))
            for x0, x1, y0, y1 in lots:
                if rng.random() < 0.12:
                    continue  # a plaza or a low roof
                w, d = x1 - x0, y1 - y0
                sw, sd = w * rng.uniform(0.6, 0.95), d * rng.uniform(0.6, 0.95)
                bx = rng.uniform(x0, x1 - sw)
                by = rng.uniform(y0, y1 - sd)
                h = rng.lognormvariate(math.log(28), 0.55) * boost
                if r < 1200:
                    h = min(h, 150 + r * 0.1)  # the nearest neighbours stay around or below us
                h = min(h, 360)
                top = CITY_Z + h
                add_box(towers, bx, bx + sw, by, by + sd, CITY_Z, top)
                if h > 110 and rng.random() < 0.6:
                    inset = rng.uniform(0.15, 0.3)
                    h2 = h * rng.uniform(0.08, 0.2)
                    add_box(towers, bx + sw * inset, bx + sw * (1 - inset), by + sd * inset, by + sd * (1 - inset), top, top + h2)
                    top += h2
                if top > -20 and rng.random() < 0.3:
                    s = 1.0 + r / 3000
                    mx, my = bx + sw / 2, by + sd / 2
                    add_box(beacons, mx - s, mx + s, my - s, my + s, top, top + 2 * s)
                if top > 10 and rng.random() < 0.35:
                    add_box(crowns, bx - 0.3, bx + sw + 0.3, by - 0.3, by + sd + 0.3, top - 6, top - 3)
    # Two tall neighbours close by, seen through the side glass.
    for (mx, my, w, h) in ((-330, 190, 44, 255), (540, 300, 38, 235)):
        add_box(towers, mx - w / 2, mx + w / 2, my - w / 2, my + w / 2, CITY_Z, CITY_Z + h)
        add_box(towers, mx - w / 3, mx + w / 3, my - w / 3, my + w / 3, CITY_Z + h, CITY_Z + h + 18)
        add_box(beacons, mx - 2, mx + 2, my - 2, my + 2, CITY_Z + h + 18, CITY_Z + h + 22)
        add_box(crowns, mx - w / 2 - 0.4, mx + w / 2 + 0.4, my - w / 2 - 0.4, my + w / 2 + 0.4, CITY_Z + h - 4, CITY_Z + h - 1)

    mesh_object(towers, "city towers", tower_material())
    mesh_object(beacons, "city beacons", A.emissive("beacon", (1.0, 0.08, 0.03), 14.0))
    mesh_object(crowns, "city crowns", A.emissive("crown", (0.55, 0.8, 1.0), 6.0))
    A.plane((40000, 40000), (0, 0, CITY_Z), ground_material(), name="streets")


# ---- The room ----


def build():
    bpy.context.scene.camera.data.clip_end = 60000.0  # the city reaches the horizon
    A.world(shader=sky, strength=1.0)
    moon = bpy.data.lights.new("moonlight", "SUN")
    moon.color = (0.72, 0.8, 1.0)
    moon.energy = 0.5
    moon.angle = math.radians(1.7)
    moon_obj = bpy.data.objects.new("moonlight", moon)
    A.collection("base").objects.link(moon_obj)
    # Point the sun's -Z at the room from the moon's direction.
    import mathutils

    moon_obj.rotation_euler = mathutils.Vector(MOON_DIR).to_track_quat("Z", "Y").to_euler()

    build_city()

    floor = stone_floor()
    ceiling = A.material("ceiling", (0.035, 0.037, 0.042), roughness=0.85)
    graphite = A.material("graphite", (0.018, 0.019, 0.022), roughness=0.35, metallic=0.6)
    steel = brushed_metal("brushed steel", (0.55, 0.56, 0.58), roughness=0.28)
    dark_steel = brushed_metal("dark steel", (0.1, 0.105, 0.115), roughness=0.3)
    panel_wall = fluted("graphite flutes", (0.03, 0.032, 0.036), 0.45)
    walnut = fluted("walnut", (0.07, 0.035, 0.018), 0.5, pitch=0.08)
    off_screen = A.material("off screen", (0.003, 0.0035, 0.004), roughness=0.08)
    glass = glass_material()
    concrete = A.material("slab", (0.04, 0.04, 0.042), roughness=0.9)

    room = A.layer("room")
    displays = A.layer("displays")

    depth = FRONT_Y - BACK_Y
    mid_y = (FRONT_Y + BACK_Y) / 2
    A.box((2 * WALL_X + 0.4, depth + 0.4, 0.2), (0, mid_y, -0.1), floor, name="floor")

    # ---- Ceiling: a lower ring around a raised coffer, with cove light and light lines ----
    cx0, cx1 = -COFFER_X, COFFER_X
    cy0, cy1 = COFFER_Y
    t = 0.12
    zc = CEIL_Z + t / 2
    A.box((WALL_X - COFFER_X, depth, t), (-(WALL_X + COFFER_X) / 2, mid_y, zc), ceiling, name="ceiling")
    A.box((WALL_X - COFFER_X, depth, t), ((WALL_X + COFFER_X) / 2, mid_y, zc), ceiling, name="ceiling")
    A.box((2 * COFFER_X, FRONT_Y - cy1, t), (0, (FRONT_Y + cy1) / 2, zc), ceiling, name="ceiling")
    A.box((2 * COFFER_X, cy0 - BACK_Y, t), (0, (cy0 + BACK_Y) / 2, zc), ceiling, name="ceiling")
    lip = 0.45  # the coffer's walls stand back from the opening, hiding the cove lights
    A.box((2 * (COFFER_X + lip), cy1 - cy0 + 2 * lip, 0.1), (0, (cy0 + cy1) / 2, COFFER_Z + 0.05), ceiling, name="coffer")
    rise = COFFER_Z - CEIL_Z - t
    for side in (-1, 1):
        A.box((0.05, cy1 - cy0 + 2 * lip, rise), (side * (COFFER_X + lip), (cy0 + cy1) / 2, CEIL_Z + t + rise / 2), ceiling, name="coffer side")
    for y, sign in ((cy0, -1), (cy1, 1)):
        A.box((2 * (COFFER_X + lip), 0.05, rise), (0, y + sign * lip, CEIL_Z + t + rise / 2), ceiling, name="coffer side")
    cove = A.emissive("cove", WARM, 8.0)
    for side in (-1, 1):
        A.box((0.05, cy1 - cy0, 0.03), (side * (COFFER_X + 0.2), (cy0 + cy1) / 2, CEIL_Z + t + 0.02), cove, coll=room, name="cove")
        hidden_area((0.2, cy1 - cy0), (side * (COFFER_X + 0.25), (cy0 + cy1) / 2, CEIL_Z + t + 0.05), (180, 0, 0),
                    WARM, 260, room, name="cove light")
    for y, sign in ((cy0, -1), (cy1, 1)):
        A.box((2 * COFFER_X, 0.05, 0.03), (0, y + sign * 0.2, CEIL_Z + t + 0.02), cove, coll=room, name="cove")
        hidden_area((2 * COFFER_X, 0.2), (0, y + sign * 0.25, CEIL_Z + t + 0.05), (180, 0, 0), WARM, 220, room, name="cove light")
    # Light lines running towards the front, in slim dark channels.
    line = A.emissive("light line", WARM, 9.0)
    for x in (-4.2, -1.4, 1.4, 4.2):
        A.box((0.09, cy1 - cy0 - 0.8, 0.04), (x, (cy0 + cy1) / 2, COFFER_Z - 0.015), graphite, name="line channel")
        A.box((0.03, cy1 - cy0 - 0.9, 0.01), (x, (cy0 + cy1) / 2, COFFER_Z - 0.04), line, coll=room, name="light line")
        hidden_area((0.3, cy1 - cy0 - 1.0), (x, (cy0 + cy1) / 2, COFFER_Z - 0.08), (0, 0, 0), WARM, 330, room, name="line light")
    # Downlights over the outer ring.
    for side in (-1, 1):
        for y in (-3.5, 0.0, 3.5, 7.0):
            A.cylinder(0.07, 0.02, (side * 8.2, y, CEIL_Z - 0.005), A.emissive("downlight", WARM, 20.0), coll=room, vertices=20, name="downlight")
            hidden_area((0.25, 0.25), (side * 8.2, y, CEIL_Z - 0.05), (0, 0, 0), WARM, 90, room, name="downlight")

    # ---- Glass on the front and the sides ----
    A.plane((2 * WALL_X, CEIL_Z), (0, FRONT_Y, CEIL_Z / 2), glass, rotation=(90, 0, 0), name="front glass")
    side_len = FRONT_Y - SIDE_GLASS_Y
    for side in (-1, 1):
        A.plane((side_len, CEIL_Z), (side * WALL_X, (FRONT_Y + SIDE_GLASS_Y) / 2, CEIL_Z / 2), glass, rotation=(90, 0, 90), name="side glass")
    # Mullions, sill and head.
    mullion = A.box((0.05, 0.2, CEIL_Z), (-WALL_X + 2.0, FRONT_Y - 0.1, CEIL_Z / 2), dark_steel, name="mullion")
    A.array(mullion, 9, (2.0, 0, 0))
    A.box((2 * WALL_X, 0.32, 0.1), (0, FRONT_Y - 0.16, 0.05), graphite, name="sill")
    A.box((2 * WALL_X, 0.3, 0.14), (0, FRONT_Y - 0.15, CEIL_Z - 0.07), dark_steel, name="head")
    sill_led = A.emissive("sill led", WARM, 3.0)
    A.box((2 * WALL_X, 0.02, 0.012), (0, FRONT_Y - 0.33, 0.1), sill_led, coll=room, name="sill led")
    for side in (-1, 1):
        m = A.box((0.2, 0.05, CEIL_Z), (side * (WALL_X - 0.1), SIDE_GLASS_Y + side_len / 3, CEIL_Z / 2), dark_steel, name="mullion")
        A.array(m, 2, (0, side_len / 3, 0))
        A.box((0.32, side_len, 0.1), (side * (WALL_X - 0.16), (FRONT_Y + SIDE_GLASS_Y) / 2, 0.05), graphite, name="sill")
        A.box((0.3, side_len, 0.14), (side * (WALL_X - 0.15), (FRONT_Y + SIDE_GLASS_Y) / 2, CEIL_Z - 0.07), dark_steel, name="head")
        A.box((0.02, side_len, 0.012), (side * (WALL_X - 0.33), (FRONT_Y + SIDE_GLASS_Y) / 2, 0.1), sill_led, coll=room, name="sill led")
        # Corner columns.
        A.box((0.5, 0.5, CEIL_Z), (side * (WALL_X - 0.25), FRONT_Y - 0.25, CEIL_Z / 2), dark_steel, name="corner column")
        A.box((0.5, 0.5, CEIL_Z), (side * (WALL_X - 0.25), SIDE_GLASS_Y, CEIL_Z / 2), dark_steel, name="corner column")
        # Slim structural pillars in from the glass.
        for y in (7.6, -3.6):
            A.cylinder(0.19, CEIL_Z, (side * 6.6, y, CEIL_Z / 2), steel, vertices=48, name="pillar")
            A.cylinder(0.24, 0.06, (side * 6.6, y, 0.03), graphite, vertices=48, name="pillar foot")
            towards = -1 if y > 0 else 1
            A.cylinder(0.035, 0.01, (side * 6.6, y + towards * 0.32, 0.005), A.emissive("uplight", WARM, 12.0), coll=room, vertices=16, name="uplight")
            spot = bpy.data.lights.new("pillar wash", "SPOT")
            spot.color, spot.energy, spot.spot_size, spot.spot_blend, spot.shadow_soft_size = WARM, 45, math.radians(22), 0.6, 0.02
            obj = bpy.data.objects.new("pillar wash", spot)
            room.objects.link(obj)
            obj.location = (side * 6.6, y + towards * 0.32, 0.02)
            obj.rotation_euler = (math.radians(180 - towards * 3), 0, 0)
    # The slab edge outside, just below the glass.
    A.box((2 * WALL_X + 2.4, 1.2, 0.7), (0, FRONT_Y + 0.6, -0.35), concrete, name="slab edge")
    for side in (-1, 1):
        A.box((1.2, side_len + 1.2, 0.7), (side * (WALL_X + 0.6), (FRONT_Y + SIDE_GLASS_Y) / 2, -0.35), concrete, name="slab edge")

    # ---- Solid walls: the sides behind the glass, and the back ----
    solid_len = SIDE_GLASS_Y - BACK_Y
    for side in (-1, 1):
        A.box((0.2, solid_len, CEIL_Z), (side * (WALL_X + 0.1), (SIDE_GLASS_Y + BACK_Y) / 2, CEIL_Z / 2), panel_wall, name="side wall")
    A.box((2 * WALL_X, 0.2, CEIL_Z), (0, BACK_Y - 0.1, CEIL_Z / 2), walnut, name="back wall")
    build_back(steel, graphite, dark_steel, room)

    # ---- The tactical walls, left and right ----
    for side in (-1, 1):
        tactical_wall(side, off_screen, dark_steel, graphite, displays)

    tactical_table(steel, graphite, off_screen, displays)
    lounge(graphite, steel)

    # ---- The mega display rig around the film ----
    half, bottom, top = A.screen_rect(RIG_Y, margin=1.06)
    bottom = max(bottom, 0.1)
    w, h = 2 * half, top - bottom
    A.box((w, 0.06, h), (0, RIG_Y + 0.05, (top + bottom) / 2), off_screen, name="rig panel")
    bar = 0.09
    for x in (-half - bar / 2, half + bar / 2):
        A.box((bar, 0.16, h + 2 * bar), (x, RIG_Y, (top + bottom) / 2), dark_steel, name="rig frame")
    A.box((w + 2 * bar, 0.16, bar), (0, RIG_Y, top + bar / 2), dark_steel, name="rig frame")
    A.box((w + 2 * bar, 0.4, bottom), (0, RIG_Y, bottom / 2), graphite, name="rig plinth")
    for x in (-half + 0.6, half - 0.6):
        A.cylinder(0.015, COFFER_Z - top, (x, RIG_Y + 0.02, (COFFER_Z + top) / 2), steel, vertices=8, name="rig hanger")
    edge = A.emissive("rig edge", (0.6, 0.85, 1.0), 9.0)
    e = 0.014
    for x in (-half + e / 2, half - e / 2):
        A.box((e, 0.02, h), (x, RIG_Y - 0.085, (top + bottom) / 2), edge, coll=room, name="rig edge")
    for z in (bottom + e / 2, top - e / 2):
        A.box((w, 0.02, e), (0, RIG_Y - 0.085, z), edge, coll=room, name="rig edge")
    A.box((w + 0.2, 0.02, 0.012), (0, RIG_Y - 0.21, 0.02), edge, coll=room, name="rig floor line")

    # A faint, cool spill from the film: the room as it looks while it plays.
    hidden_area((4.8, 2.7), (0, 4.9, 1.6), (90, 0, 180), (0.6, 0.72, 1.0), 800, "base", name="screen spill")
    # The city's glow coming in through the glass.
    city_glow = (0.85, 0.74, 0.66)
    hidden_area((2 * WALL_X, CEIL_Z - 0.6), (0, FRONT_Y - 0.4, CEIL_Z / 2), (90, 0, 180), city_glow, 500, "base", name="city glow")
    for side in (-1, 1):
        hidden_area((side_len, CEIL_Z - 0.6), (side * (WALL_X - 0.4), (FRONT_Y + SIDE_GLASS_Y) / 2, CEIL_Z / 2),
                    (0, 90 * side, 0), city_glow, 180, "base", name="city glow")

    build_seat()


def build_back(steel, graphite, dark_steel, room):
    """The lift lobby wall behind the viewer: walnut flutes, steel doors, low credenzas."""
    y = BACK_Y + 0.02
    A.box((2.9, 0.08, 3.1), (0, y + 0.04, 1.55), dark_steel, name="lift surround")
    A.box((2.2, 0.06, 2.7), (0, y + 0.09, 1.35), steel, name="lift doors")
    A.box((0.012, 0.07, 2.7), (0, y + 0.1, 1.35), graphite, name="lift seam")
    frame = A.emissive("lift frame", WARM, 5.0)
    for x in (-1.25, 1.25):
        A.box((0.02, 0.02, 2.95), (x, y + 0.13, 1.475), frame, coll=room, name="lift glow")
    A.box((2.52, 0.02, 0.02), (0, y + 0.13, 2.95), frame, coll=room, name="lift glow")
    for side in (-1, 1):
        cx = side * 5.2
        A.box((4.4, 0.5, 0.62), (cx, y + 0.25, 0.37), graphite, bevel=0.01, name="credenza")
        A.box((4.44, 0.54, 0.04), (cx, y + 0.27, 0.7), steel, name="credenza top")
        A.box((4.3, 0.02, 0.012), (cx, y + 0.51, 0.06), A.emissive("credenza glow", WARM, 4.0), coll=room, name="credenza glow")
        hidden_area((4.0, 0.3), (cx, y + 0.3, 2.9), (0, 0, 0), WARM, 120, room, name="wall wash")
        # Abstract sculptural pieces on the credenza: slim brushed blocks.
        for k, (dx, hh) in enumerate(((-1.2, 0.5), (-0.95, 0.32), (1.1, 0.42))):
            A.box((0.12, 0.12, hh), (cx + side * dx, y + 0.27, 0.72 + hh / 2), steel if k % 2 else dark_steel, bevel=0.005, name="sculpture")


def tactical_wall(side, off_screen, dark_steel, graphite, displays):
    """A wall-sized tactical display with a console desk below it."""
    x = side * WALL_X
    width, height, z_mid = 4.8, 2.6, 2.3
    A.box((0.08, width + 0.24, height + 0.24), (x - side * 0.04, 0.0, z_mid), dark_steel, name="display frame")
    A.box((0.02, width, height), (x - side * 0.09, 0.0, z_mid), off_screen, name="display glass")
    mat = display_material(f"tactical {side}", width, height, 5, 3, seed=3.0 + side, strength=6.0)
    A.plane((width, height), (x - side * 0.105, 0.0, z_mid), mat, coll=displays, rotation=(90, 0, -90 * side), name="tactical display")
    hidden_area((width, height), (x - side * 0.3, 0.0, z_mid), (0, 90 * side, 0), CYAN, 480, displays, name="display glow")
    # The console desk below.
    dx = x - side * 0.55
    A.box((0.7, width, 0.06), (dx, 0, 0.76), graphite, bevel=0.01, name="console top")
    A.box((0.5, width - 0.2, 0.73), (dx + side * 0.1, 0, 0.365), graphite, name="console body")
    A.box((0.012, width, 0.012), (dx - side * 0.35, 0, 0.78), A.emissive("console edge", CYAN, 6.0), coll=displays, name="console edge")
    for k, y in enumerate((-1.5, 0.0, 1.5)):
        A.box((0.04, 0.9, 0.5), (dx + side * 0.12, y, 1.08), dark_steel, rotation=(0, side * 12, 0), name="monitor")
        A.box((0.005, 0.86, 0.46), (dx + side * 0.095, y, 1.085), off_screen, rotation=(0, side * 12, 0), name="monitor glass")
        mon = display_material(f"monitor {side} {k}", 0.86, 0.46, 2, 1, seed=11.0 + 3 * k + side, strength=3.5)
        A.plane((0.86, 0.46), (dx + side * 0.09, y, 1.085), mon, coll=displays, rotation=(78, 0, -90 * side), name="monitor screen")


def tactical_table(steel, graphite, off_screen, displays):
    """A long table to the right with a glowing map top and a holographic relief over it."""
    cx, cy, length, width, top_z = 5.0, 1.4, 4.6, 1.4, 0.9
    A.box((width, length, 0.06), (cx, cy, top_z - 0.03), graphite, bevel=0.015, name="table top")
    A.box((width - 0.16, length - 0.16, 0.005), (cx, cy, top_z + 0.002), off_screen, name="table glass")
    for y in (cy - length / 2 + 0.6, cy + length / 2 - 0.6):
        A.box((0.9, 0.08, top_z - 0.06), (cx, y, (top_z - 0.06) / 2), steel, name="table leg")
    A.box((0.06, length - 1.0, 0.18), (cx, cy, top_z - 0.15), steel, name="table beam")
    mat = display_material("table map", width - 0.2, length - 0.2, 1, 3, seed=21.0, strength=2.5)
    A.plane((width - 0.2, length - 0.2), (cx, cy, top_z + 0.006), mat, coll=displays, name="table display")
    A.box((width + 0.01, 0.012, 0.012), (cx, cy - length / 2 - 0.006, top_z - 0.04), A.emissive("table edge", CYAN, 5.0), coll=displays, name="table edge")
    hidden_area((width - 0.3, length - 0.4), (cx, cy, top_z + 0.02), (180, 0, 0), CYAN, 70, displays, name="table glow")
    hidden_area((width, length), (cx, cy, top_z + 1.4), (0, 0, 0), CYAN, 40, displays, name="holo glow")

    # The holographic relief: a displaced grid hovering above the table.
    from mathutils import noise, Vector

    bm = bmesh.new()
    nx, ny = 36, 110
    sx, sy = width - 0.4, length - 0.8
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            px, py = (i / nx - 0.5) * sx, (j / ny - 0.5) * sy
            edge = min(1.0, 4 * min(i / nx, 1 - i / nx, j / ny, 1 - j / ny) * 3)
            hgt = max(0.0, noise.noise(Vector((px * 1.6, py * 1.6, 0.3))) * 0.5 + noise.noise(Vector((px * 4, py * 4, 2.0))) * 0.12 + 0.12)
            row.append(bm.verts.new((px, py, hgt * edge * 0.9)))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    mesh = bpy.data.meshes.new("hologram")
    bm.to_mesh(mesh)
    bm.free()
    holo = bpy.data.objects.new("hologram", mesh)
    bpy.context.scene.collection.objects.link(holo)
    A._place(holo, displays, holo_material(), (cx, cy, top_z + 0.12), (0, 0, 0))

    # Chairs along both sides.
    for side in (-1, 1):
        x = cx + side * (width / 2 + 0.45)
        parts = [
            A.box((0.46, 0.46, 0.08), (x, cy - 1.5, 0.48), graphite, bevel=0.02, name="chair seat"),
            A.box((0.06, 0.44, 0.48), (x + side * 0.24, cy - 1.5, 0.78), graphite, rotation=(0, side * 8, 0), bevel=0.02, name="chair back"),
            A.cylinder(0.025, 0.44, (x, cy - 1.5, 0.22), steel, vertices=12, name="chair stem"),
            A.cylinder(0.2, 0.02, (x, cy - 1.5, 0.01), steel, vertices=24, name="chair foot"),
        ]
        for part in parts:
            A.array(part, 3, (0, 1.5, 0))


def lounge(graphite, steel):
    """A low sofa facing the left tactical wall, and a stone side table."""
    fabric = A.material("charcoal fabric", (0.03, 0.03, 0.033), roughness=0.9, sheen=0.4)
    leather = A.material("lounge leather", (0.025, 0.018, 0.014), roughness=0.45, coat=0.2)
    x, y, length = -6.2, 0.4, 3.4
    A.box((0.95, length, 0.3), (x, y, 0.2), leather, bevel=0.03, name="sofa base")
    A.box((0.75, length - 0.3, 0.14), (x - 0.08, y, 0.42), fabric, bevel=0.05, name="sofa cushion")
    A.box((0.22, length, 0.45), (x + 0.37, y, 0.55), leather, bevel=0.06, name="sofa back")
    for s in (-1, 1):
        A.box((0.95, 0.18, 0.28), (x, y + s * (length / 2 - 0.09), 0.48), leather, bevel=0.05, name="sofa arm")
    A.box((0.9, length - 0.2, 0.04), (x, y, 0.035), steel, name="sofa plinth")
    A.cylinder(0.55, 0.32, (-8.0, 0.4, 0.16), A.material("stone table", (0.05, 0.05, 0.055), roughness=0.2), vertices=64, name="low table")


# ---- The viewer's seat ----


def build_seat():
    seat = "seat"
    leather = A.material("seat leather", (0.022, 0.017, 0.014), roughness=0.42, coat=0.3)
    fabric = A.material("seat fabric", (0.035, 0.036, 0.04), roughness=0.92, sheen=0.5)
    steel = A.material("seat steel", (0.6, 0.61, 0.63), roughness=0.25, metallic=1.0)
    rug_edge = A.material("rug edge", (0.05, 0.052, 0.058), roughness=0.95)
    rug = A.material("rug", (0.018, 0.019, 0.022), roughness=0.98, sheen=0.3)
    A.cylinder(1.5, 0.012, (0, 0, 0.006), rug_edge, coll=seat, vertices=96, name="rug edge")
    A.cylinder(1.44, 0.016, (0, 0, 0.008), rug, coll=seat, vertices=96, name="rug")
    # Swivel base.
    A.cylinder(0.34, 0.025, (0, -0.05, 0.03), steel, coll=seat, vertices=48, name="chair base")
    A.cylinder(0.05, 0.16, (0, -0.05, 0.12), steel, coll=seat, vertices=24, name="chair column")
    # Shell, cushions, back and arms.
    A.box((0.9, 0.86, 0.14), (0, -0.04, 0.27), leather, coll=seat, bevel=0.04, name="chair shell")
    A.box((0.66, 0.7, 0.12), (0, 0.0, 0.39), fabric, coll=seat, bevel=0.05, name="seat cushion")
    A.box((0.9, 0.18, 0.66), (0, -0.42, 0.66), leather, coll=seat, rotation=(16, 0, 0), bevel=0.07, name="chair back")
    A.box((0.64, 0.1, 0.46), (0, -0.31, 0.68), fabric, coll=seat, rotation=(16, 0, 0), bevel=0.04, name="back cushion")
    for side in (-1, 1):
        A.box((0.13, 0.8, 0.26), (side * 0.385, -0.04, 0.47), leather, coll=seat, bevel=0.05, name="armrest")
        A.box((0.1, 0.5, 0.012), (side * 0.385, 0.04, 0.605), steel, coll=seat, bevel=0.004, name="arm inlay")
    # A slim side table at the right hand.
    A.cylinder(0.2, 0.018, (0.72, 0.15, 0.52), A.material("smoked glass", (0.02, 0.022, 0.025), roughness=0.08), coll=seat, vertices=40, name="side table top")
    A.cylinder(0.012, 0.5, (0.72, 0.15, 0.27), steel, coll=seat, vertices=12, name="side table stem")
    A.cylinder(0.14, 0.015, (0.72, 0.15, 0.02), steel, coll=seat, vertices=32, name="side table foot")
    merge(seat, "lounge chair")


def merge(coll_name, name):
    """Join a collection's objects into one mesh (modifiers applied), so the seat exports as one model."""
    objs = list(A.collection(coll_name).objects)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    except (AttributeError, RuntimeError):
        bpy.ops.object.shade_smooth()
    return merged
