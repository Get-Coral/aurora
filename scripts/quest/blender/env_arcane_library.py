"""
Arcane Library: an enchanted academy's reading hall at night.

A tall gothic hall of dark oak and stone: bays of book-packed shelves between
clustered stone piers, an oak gallery with a balustrade along three walls, a
boarded pointed vault on oak ribs and tie beams, and a tall lancet window of
moonlit stained glass (stars, a sun and a crescent; no symbols) high on the
right. A great stone fireplace burns on the left with two wingback chairs
drawn up to it. Dozens of candles float high in the air, two iron candle
rings hang from the beams, oil lamps glow on the reading tables. The film
plays inside a great empty frame of dark oak and old brass on the far wall,
its inner edge glinting faintly with rune-like marks.

Light layers:
- candles: the floating candles, the candle rings and the oil lamps. Up when
  the film isn't playing, low while it plays (the app flickers it).
- fire: the fire in the hearth and its light. Stays fairly strong during the
  film (the app flickers it).
- runes: the glints along the frame's inner edge and a faint mist inside it
  (the app shimmers it).
The moonlit window, its moonbeam and the film's own spill belong to the base.

The viewer sits in a leather wingback armchair on a round rug, with a small
side table and a stack of books (the "seat" model).
"""

import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

import aurora_scene as A

SAMPLES = 160

W = 8.0  # half width of the hall
BACK = -7.0
FAR = 10.0
SPRING = 9.6  # where the vault springs from the walls
RISE = 5.0
PIERS = [-7.0, -3.6, -0.2, 3.2, 6.6, 10.0]
FIRE_Y = 1.5  # bay centre of the fireplace (left) and the window (right)
GAL_Z = 3.9
GAL_D = 1.35
CASE_D = 0.42
CASE_TOP = 3.55
UPPER_TOP = 7.4

WARM = (1.0, 0.62, 0.3)
CANDLE = (1.0, 0.58, 0.26)
FIRE = (1.0, 0.42, 0.13)
MOON = (0.55, 0.68, 1.0)
RUNE = (0.55, 0.86, 1.0)

R = random.Random(11)


# ---------------------------------------------------------------- utilities


class Wall:
    """A wall's own frame: u along the wall, n into the room, z up."""

    def __init__(self, ox, oy, yaw):
        self.ox, self.oy, self.yaw = ox, oy, yaw
        self.c, self.s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))

    def p(self, u, n, z):
        return (self.ox + u * self.c - n * self.s, self.oy + u * self.s + n * self.c, z)

    def du(self):
        return (self.c, self.s, 0.0)

    def box(self, acc, u, n, z, su, sn, sz, rot=(0, 0, 0), **attrs):
        acc.box(self.p(u, n, z), (su, sn, sz), (rot[0], rot[1], rot[2] + self.yaw), **attrs)

    def abox(self, u, n, z, su, sn, sz, mat, coll="base", rot=(0, 0, 0), bevel=0.0, name="box"):
        return A.box((su, sn, sz), self.p(u, n, z), mat, coll, rotation=(rot[0], rot[1], rot[2] + self.yaw),
                     bevel=bevel, name=name)


LEFT = Wall(-W, 0, -90)  # u = -y
RIGHT = Wall(W, 0, 90)  # u = y
FARW = Wall(0, FAR, 180)  # u = -x
BACKW = Wall(0, BACK, 0)  # u = x


def u_of(wall, y):
    return -y if wall is LEFT else y


class Acc:
    """Many simple pieces merged into one mesh (fast to build, one object)."""

    def __init__(self):
        self.v, self.f, self.attrs = [], [], {}

    def add(self, verts, faces, **attrs):
        o = len(self.v)
        self.v.extend(verts)
        self.f.extend(tuple(i + o for i in face) for face in faces)
        for k, val in attrs.items():
            self.attrs.setdefault(k, []).extend([val] * len(faces))

    def box(self, center, size, rot=(0, 0, 0), **attrs):
        m = Euler([math.radians(a) for a in rot]).to_matrix()
        sx, sy, sz = (s / 2 for s in size)
        c = Vector(center)
        corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                   (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        verts = [tuple(c + m @ Vector(k)) for k in corners]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.add(verts, faces, **attrs)

    def prism(self, base, r, h, segs=8, rot=(0, 0, 0), **attrs):
        m = Euler([math.radians(a) for a in rot]).to_matrix()
        b = Vector(base)
        verts = []
        for z in (0, h):
            for k in range(segs):
                a = 2 * math.pi * k / segs
                verts.append(tuple(b + m @ Vector((r * math.cos(a), r * math.sin(a), z))))
        faces = [tuple(range(segs - 1, -1, -1)), tuple(range(segs, 2 * segs))]
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((k, k2, segs + k2, segs + k))
        self.add(verts, faces, **attrs)

    def teardrop(self, base, r, h, segs=8, rings=6, lean=(0.0, 0.0), flat=1.0, wobble=0.0, phase=0.0, **attrs):
        bx, by, bz = base
        verts = [(bx, by, bz)]
        for i in range(1, rings + 1):
            t = i / (rings + 1)
            rad = r * (t ** 0.55) * ((1 - t) ** 0.9) / 0.381
            cx = bx + lean[0] * t * t + wobble * math.sin(phase + t * 5) * t
            cy = by + lean[1] * t * t
            for k in range(segs):
                a = 2 * math.pi * k / segs
                verts.append((cx + rad * math.cos(a), cy + rad * math.sin(a) * flat, bz + h * t))
        verts.append((bx + lean[0], by + lean[1], bz + h))
        faces = []
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((0, 1 + k2, 1 + k))
        for i in range(rings - 1):
            o0, o1 = 1 + i * segs, 1 + (i + 1) * segs
            for k in range(segs):
                k2 = (k + 1) % segs
                faces.append((o0 + k, o0 + k2, o1 + k2, o1 + k))
        top = len(verts) - 1
        o = 1 + (rings - 1) * segs
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((o + k, o + k2, top))
        self.add(verts, faces, **attrs)

    def build(self, name, mat, coll="base", smooth=False, bevel=0.0):
        if not self.f:
            return None
        return mesh_object(name, self.v, self.f, mat, coll, smooth=smooth, fattrs=self.attrs, bevel=bevel)


def get_coll(coll):
    return A.collection(coll) if isinstance(coll, str) else coll


def mesh_object(name, verts, faces, mat, coll="base", loc=(0, 0, 0), yaw=0.0, smooth=False, uvs=None,
                fattrs=None, bevel=0.0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.update()
    if uvs is not None:
        layer = mesh.uv_layers.new(name="UVMap")
        idx = np.zeros(len(mesh.loops), dtype=np.int32)
        mesh.loops.foreach_get("vertex_index", idx)
        layer.data.foreach_set("uv", np.asarray(uvs, dtype=np.float32)[idx].ravel())
    for k, vals in (fattrs or {}).items():
        attr = mesh.attributes.new(k, "FLOAT", "FACE")
        attr.data.foreach_set("value", vals)
    if smooth:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    get_coll(coll).objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (0, 0, math.radians(yaw))
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = "ANGLE"
    return obj


def torus(major, minor, location, mat, coll="base", rotation=(0, 0, 0), segs=48, minor_segs=8, name="ring"):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segs,
                                     minor_segments=minor_segs)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return A._place(obj, coll, mat, location, rotation)


def cone(r1, r2, depth, location, mat, coll="base", rotation=(0, 0, 0), vertices=8, name="cone"):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth)
    obj = bpy.context.active_object
    obj.name = name
    return A._place(obj, coll, mat, location, rotation)


def crisp(obj, deg=40):
    """Smooth shading with sharp edges above `deg` (clean caps on cylinders)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    limit = math.radians(deg)
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < limit
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    return obj


def soften(obj, segments=4):
    """Rounded, smooth-shaded upholstery from a bevelled box."""
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    for mod in obj.modifiers:
        if mod.type == "BEVEL":
            mod.segments = segments
            mod.harden_normals = True
    return obj


def hide_from_camera(obj, glossy=True):
    obj.visible_camera = False
    if not glossy:
        obj.visible_glossy = False
    return obj


def point(location, color, power, radius=0.05, coll="base", camera=False, glossy=True, name="light"):
    obj = A.point_light(location, color, power, radius=radius, coll=coll, name=name)
    if not camera:
        hide_from_camera(obj, glossy)
    return obj


def aim(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def arch_outline(h, spring, rfac, bottom, n=14, cu=0.0):
    """A pointed arch opening's outline, from bottom-left up and over to bottom-right."""
    radius = rfac * h
    cx = radius - h  # the left arc's centre sits right of the axis
    phi_apex = math.acos(-cx / radius)
    left = []
    for k in range(n + 1):
        phi = math.pi + (phi_apex - math.pi) * k / n
        left.append((cx + radius * math.cos(phi), spring + radius * math.sin(phi)))
    right = [(-x, z) for x, z in reversed(left[:-1])]
    pts = [(-h, bottom)] + left + right + [(h, bottom)]
    return [(cu + x, z) for x, z in pts]


def arch_apex(h, spring, rfac):
    radius = rfac * h
    cx = radius - h
    return spring + math.sqrt(radius * radius - cx * cx)


def strip_solid(inner, outer, n0, n1):
    """Extrude the band between two outlines (u, z) from n0 to n1: an arch moulding."""
    verts, faces = [], []
    for (ui, zi), (uo, zo) in zip(inner, outer):
        verts += [(ui, n1, zi), (uo, n1, zo), (ui, n0, zi), (uo, n0, zo)]
    count = len(inner)
    for i in range(count - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces.append((a, b, b + 1, a + 1))  # front
        faces.append((a + 2, a + 3, b + 3, b + 2))  # back
        faces.append((a, a + 2, b + 2, b))  # inner reveal
        faces.append((a + 1, b + 1, b + 3, a + 3))  # outer side
    for a in (0, 4 * (count - 1)):
        faces.append((a, a + 1, a + 3, a + 2))
    return verts, faces


def wall_mesh(wall, verts, faces, mat, coll="base", name="wall piece", uvs=None, smooth=False):
    return mesh_object(name, verts, faces, mat, coll, loc=wall.p(0, 0, 0), yaw=wall.yaw, uvs=uvs, smooth=smooth)


def vault_profile(n=24):
    """The vault's cross-section from x=-W to x=W: a pointed arch, squashed to RISE."""
    h = W
    radius = 1.2 * h
    cx = radius - h
    phi_apex = math.acos(-cx / radius)
    raw = radius * math.sin(phi_apex)
    scale = RISE / raw
    left = []
    for k in range(n + 1):
        phi = math.pi + (phi_apex - math.pi) * k / n
        left.append((cx + radius * math.cos(phi) - 0.0, SPRING + scale * radius * math.sin(phi)))
    left[0] = (-W, SPRING)
    right = [(-x, z) for x, z in reversed(left[:-1])]
    return left + right


def vault_z(x, profile):
    xs = [p[0] for p in profile]
    zs = [p[1] for p in profile]
    return float(np.interp(x, xs, zs))


# ---------------------------------------------------------------- textures (numpy, in memory)


def np_image(name, rgb):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    return img


def value_noise(h, w, cy, cx, seed):
    g = np.random.default_rng(seed).random((cy + 2, cx + 2))
    ys = np.linspace(0, cy, h)
    xs = np.linspace(0, cx, w)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    ty = ys - y0
    tx = xs - x0
    ty = ty * ty * (3 - 2 * ty)
    tx = tx * tx * (3 - 2 * tx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    tx = tx[None, :]
    ty = ty[:, None]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def cell_hash(a, b):
    return np.abs(np.modf(np.sin(a * 12.9898 + b * 78.233) * 43758.5453)[0])


def stained_glass_image(h, sill, spring, rfac, wpx=440):
    apex = arch_apex(h, spring, rfac)
    height = apex - sill
    hpx = int(wpx * height / (2 * h))
    u = (np.arange(wpx) + 0.5) / wpx * 2 * h - h
    z = (np.arange(hpx) + 0.5) / hpx * height + sill
    U, Z = np.meshgrid(u, z)
    V = Z - sill
    blues = np.array([(0.05, 0.10, 0.42), (0.03, 0.06, 0.30), (0.08, 0.18, 0.55), (0.04, 0.24, 0.40),
                      (0.15, 0.09, 0.42), (0.02, 0.12, 0.26), (0.06, 0.14, 0.48), (0.10, 0.28, 0.50)])
    s = 0.16
    a = (U + V) / s
    b = (U - V) / s
    ia, ib = np.floor(a), np.floor(b)
    fa, fb = a - ia, b - ib
    r1, r2, r3 = cell_hash(ia, ib), cell_hash(ia + 7.1, ib - 3.3), cell_hash(ia - 2.7, ib + 5.9)
    col = blues[(r1 * len(blues)).astype(int) % len(blues)]
    col = np.where((r2 > 0.94)[..., None], np.array((0.85, 0.5, 0.12)), col)
    col = np.where((r2 < 0.035)[..., None], np.array((0.5, 0.05, 0.08)), col)
    col = np.where(((r2 > 0.5) & (r2 < 0.53))[..., None], np.array((0.75, 0.78, 0.9)), col)
    col = col * (0.72 + 0.5 * r3)[..., None]
    lead = np.minimum.reduce([fa, 1 - fa, fb, 1 - fb]) < 0.055

    # Distance to the opening's edge, for a border band.
    radius = rfac * h
    cx = radius - h
    centre_x = np.where(U < 0, cx, -cx)
    arc_in = radius - np.hypot(U - centre_x, Z - spring)
    edge = np.minimum(h - np.abs(U), V)
    edge = np.where(Z > spring, np.minimum(edge, arc_in), edge)
    band = edge < 0.1
    tile = (np.floor((V + np.abs(U) * 1.0) / 0.1) % 2) == 0
    band_col = np.where(tile[..., None], np.array((0.5, 0.05, 0.07)), np.array((0.85, 0.5, 0.12)))
    col = np.where(band[..., None], band_col, col)
    lead = np.where(band, (np.abs(edge - 0.1) < 0.012) | (edge < 0.012) | (np.modf((V + np.abs(U)) / 0.1)[0] < 0.1), lead)

    def medallion(cu, cz, rm, kind):
        nonlocal col, lead
        d = np.hypot(U - cu, Z - cz)
        ang = np.arctan2(Z - cz, U - cu)
        inside = d < rm
        if kind == "sun":
            sector = np.floor((ang / (2 * np.pi) + 0.5) * 16) % 2
            m = np.where((sector == 0)[..., None], np.array((0.95, 0.6, 0.15)), np.array((0.7, 0.32, 0.06)))
            core = d < 0.36 * rm
            m = np.where(core[..., None], np.array((1.0, 0.86, 0.5)), m)
            ln = (np.abs(d - 0.36 * rm) < 0.012) | ((np.modf((ang / (2 * np.pi) + 0.5) * 16)[0] < 0.06) & ~core)
        elif kind == "moon":
            m = np.broadcast_to(np.array((0.03, 0.05, 0.32)), col.shape).copy()
            cres = (d < 0.7 * rm) & (np.hypot(U - cu - 0.3 * rm, Z - cz - 0.12 * rm) > 0.58 * rm)
            m = np.where(cres[..., None], np.array((0.8, 0.84, 1.0)), m)
            for sx, sz in ((0.45, 0.45), (0.55, -0.3), (0.15, -0.6)):
                dot = np.hypot(U - cu - sx * rm, Z - cz - sz * rm) < 0.07 * rm
                m = np.where(dot[..., None], np.array((1.0, 0.9, 0.6)), m)
            ln = np.zeros_like(inside)
        elif kind == "star":
            m = np.broadcast_to(np.array((0.03, 0.05, 0.36)), col.shape).copy()
            r_star = rm * (0.28 + 0.5 * np.abs(np.cos(4 * ang)) ** 6 + 0.18 * np.abs(np.cos(4 * ang + np.pi / 2)) ** 8)
            star = d < r_star
            m = np.where(star[..., None], np.array((1.0, 0.86, 0.5)), m)
            ring_a = np.modf((ang / (2 * np.pi) + 0.5) * 16)[0]
            dots = (np.abs(d - 0.86 * rm) < 0.06 * rm) & (np.abs(ring_a - 0.5) < 0.2)
            m = np.where(dots[..., None], np.array((0.8, 0.85, 1.0)), m)
            ln = np.abs(d - 0.74 * rm) < 0.01
        else:  # orb: concentric rings of blue and teal
            rings = np.floor(d / rm * 4) % 2
            m = np.where((rings == 0)[..., None], np.array((0.06, 0.3, 0.45)), np.array((0.12, 0.08, 0.4)))
            m = np.where((d < 0.22 * rm)[..., None], np.array((0.9, 0.7, 0.35)), m)
            ln = np.modf(d / rm * 4)[0] < 0.08
        col = np.where(inside[..., None], m, col)
        lead = np.where(inside, ln, lead) | (np.abs(d - rm) < 0.014)

    lancet_u = h / 2 + 0.02
    medallion(-lancet_u, sill + 1.85, 0.36, "sun")
    medallion(lancet_u, sill + 1.85, 0.36, "moon")
    medallion(-lancet_u, sill + 0.75, 0.24, "orb")
    medallion(lancet_u, sill + 0.75, 0.24, "orb")
    medallion(0.0, spring + 0.62, 0.4, "star")

    # Moonlight: brighter towards the top, softly mottled glass.
    glow = 0.7 + 0.5 * (V / height)
    mottle = 0.8 + 0.4 * value_noise(hpx, wpx, 9, 4, 3)
    col = col * (glow * mottle)[..., None]
    col = np.where(lead[..., None], np.array((0.004, 0.004, 0.006)), col)
    return np_image("stained glass", col.astype(np.float32)), apex


def rug_image(name, length, width, palette, seed, px_per_m=110):
    """A worn oriental-style runner: borders, a field of lozenges, faded patches."""
    hpx, wpx = int(length * px_per_m), int(width * px_per_m)
    y = (np.arange(hpx) + 0.5) / px_per_m
    x = (np.arange(wpx) + 0.5) / px_per_m
    X, Y = np.meshgrid(x, y)
    field, dark, gold, light = (np.array(c) for c in palette)
    dx = np.minimum(X, width - X)
    dy = np.minimum(Y, length - Y)
    d = np.minimum(dx, dy)
    col = np.broadcast_to(field, (hpx, wpx, 3)).copy()

    def put(mask, c):
        nonlocal col
        col = np.where(mask[..., None], c, col)

    # Field: a column of lozenge medallions with small motifs scattered round them.
    period = 1.25
    cxp = width / 2
    ly = np.modf((Y - length / 2) / period + 100.5)[0] - 0.5
    loz = np.abs(X - cxp) / (width * 0.32) + np.abs(ly) / 0.42
    put(loz < 1.0, gold)
    put(loz < 0.9, dark)
    put(loz < 0.55, field * 1.25)
    put(loz < 0.4, gold)
    put(loz < 0.28, light)
    put(loz < 0.12, dark)
    sx = np.modf(X / 0.22)[0] - 0.5
    sy = np.modf(Y / 0.22)[0] - 0.5
    motif = (np.abs(sx) + np.abs(sy) < 0.18) & (loz > 1.15)
    put(motif, gold * 0.8)
    # Borders.
    put(d < 0.36, dark)
    s = np.where(dx < dy, Y, X)
    t = np.modf(s / 0.2)[0] - 0.5
    put((d < 0.33) & (d > 0.09) & (np.abs(t) + np.abs(d - 0.21) / 0.6 < 0.13), gold)
    put((d < 0.36) & (d > 0.335), gold)
    put((d < 0.09) & (d > 0.065), gold)
    put(d < 0.065, field * 0.8)
    put(d < 0.025, dark)
    # Wear: darker and lighter patches, a faded middle.
    n1 = value_noise(hpx, wpx, int(length * 2), int(width * 2), seed)
    n2 = value_noise(hpx, wpx, int(length * 9), int(width * 9), seed + 1)
    worn = np.clip((n1 - 0.45) * 2.0, 0, 1) * 0.45
    tan = np.array((0.06, 0.047, 0.034))
    col = col * (0.8 + 0.35 * n2)[..., None]
    col = col * (1 - worn[..., None]) + tan * worn[..., None]
    return np_image(name, col.astype(np.float32))


def globe_image():
    h, w = 256, 512
    lon = np.linspace(-np.pi, np.pi, w)
    lat = np.linspace(-np.pi / 2, np.pi / 2, h)
    LON, LAT = np.meshgrid(lon, lat)
    n = 0.6 * value_noise(h, w, 6, 12, 21) + 0.3 * value_noise(h, w, 14, 28, 22) + 0.1 * value_noise(h, w, 40, 80, 23)
    land = n > 0.55
    col = np.where(land[..., None], np.array((0.34, 0.25, 0.12)), np.array((0.035, 0.085, 0.09)))
    coast = (n > 0.53) & (n < 0.56)
    col = np.where(coast[..., None], np.array((0.12, 0.08, 0.04)), col)
    grid = (np.abs(np.modf((LON + np.pi) / (np.pi / 6))[0] - 0.5) > 0.48) | (np.abs(np.modf((LAT + np.pi) / (np.pi / 6))[0] - 0.5) > 0.47)
    col = np.where(grid[..., None], np.array((0.22, 0.15, 0.05)), col)
    return np_image("globe map", col.astype(np.float32))


# ---------------------------------------------------------------- materials


def sock(node, identifier, outputs=False):
    for s in (node.outputs if outputs else node.inputs):
        if s.identifier == identifier:
            return s
    raise KeyError(identifier)


def new_mat(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    return mat, nodes, links, nodes["Principled BSDF"]


def math_node(nodes, links, op, a, b=None, clamp=False):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            links.new(v, n.inputs[i])
    return n.outputs[0]


def mix_color(nodes, links, fac, a, b, blend="MIX"):
    n = nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    for ident, v in (("Factor_Float", fac), ("A_Color", a), ("B_Color", b)):
        s = sock(n, ident)
        if isinstance(v, (int, float)):
            s.default_value = v
        elif isinstance(v, tuple):
            s.default_value = (*v, 1) if len(v) == 3 else v
        else:
            links.new(v, s)
    return sock(n, "Result_Color", outputs=True)


def ramp(nodes, links, fac, stops, constant=False):
    n = nodes.new("ShaderNodeValToRGB")
    els = n.color_ramp.elements
    if constant:
        n.color_ramp.interpolation = "CONSTANT"
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, c in stops[1:-1]:
        e = els.new(pos)
        e.color = (*c, 1)
    links.new(fac, n.inputs["Fac"])
    return n.outputs["Color"]


def plane_coords(nodes, links, coord, a, b):
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord, sep.inputs[0])
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(sep.outputs[a], comb.inputs[0])
    links.new(sep.outputs[b], comb.inputs[1])
    return comb.outputs[0]


def stone_material(name, axes=("X", "Z"), c1=(0.095, 0.08, 0.064), c2=(0.068, 0.057, 0.046), brick=(0.85, 0.42),
                   mortar=0.012, roughness=0.8, rough_var=0.0, bump=0.5, mortar_dark=0.4):
    mat, nodes, links, bsdf = new_mat(name)
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    uv = plane_coords(nodes, links, coord, axes[0], axes[1])
    br = nodes.new("ShaderNodeTexBrick")
    br.offset = 0.5
    links.new(uv, br.inputs["Vector"])
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = mortar
    br.inputs["Mortar Smooth"].default_value = 0.3
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Brick Width"].default_value = brick[0]
    br.inputs["Row Height"].default_value = brick[1]
    br.inputs["Color1"].default_value = (*c1, 1)
    br.inputs["Color2"].default_value = (*c2, 1)
    br.inputs["Mortar"].default_value = (c2[0] * mortar_dark, c2[1] * mortar_dark, c2[2] * mortar_dark, 1)
    noise = nodes.new("ShaderNodeTexNoise")
    links.new(coord, noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 2.2
    noise.inputs["Detail"].default_value = 8.0
    grime = ramp(nodes, links, noise.outputs["Fac"], [(0.3, (0.6, 0.6, 0.6)), (0.7, (1.15, 1.12, 1.08))])
    color = mix_color(nodes, links, 1.0, br.outputs["Color"], grime, "MULTIPLY")
    links.new(color, bsdf.inputs["Base Color"])
    if rough_var:
        r = math_node(nodes, links, "MULTIPLY_ADD", noise.outputs["Fac"], rough_var)
        nodes_r = r.node
        nodes_r.inputs[2].default_value = roughness - rough_var / 2
        links.new(r, bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = roughness
    fine = nodes.new("ShaderNodeTexNoise")
    links.new(coord, fine.inputs["Vector"])
    fine.inputs["Scale"].default_value = 18.0
    fine.inputs["Detail"].default_value = 6.0
    height = math_node(nodes, links, "MULTIPLY_ADD", fine.outputs["Fac"], 0.25)
    height.node.inputs[2].default_value = 0.0
    height = math_node(nodes, links, "SUBTRACT", height, br.outputs["Fac"])
    bmp = nodes.new("ShaderNodeBump")
    bmp.inputs["Strength"].default_value = bump
    bmp.inputs["Distance"].default_value = 0.02
    links.new(height, bmp.inputs["Height"])
    links.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def trim_stone(name="stone trim"):
    mat, nodes, links, bsdf = new_mat(name)
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    noise = nodes.new("ShaderNodeTexNoise")
    links.new(coord, noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 8.0
    links.new(ramp(nodes, links, noise.outputs["Fac"], [(0.3, (0.075, 0.066, 0.056)), (0.7, (0.14, 0.125, 0.105))]),
              bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.75
    return mat


def wood_material(name, dark=(0.026, 0.013, 0.007), light=(0.06, 0.031, 0.015), roughness=0.42, coat=0.15,
                  direction="Z", scale=5.0):
    mat, nodes, links, bsdf = new_mat(name)
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = direction
    links.new(coord, wave.inputs["Vector"])
    wave.inputs["Scale"].default_value = scale
    wave.inputs["Distortion"].default_value = 3.0
    wave.inputs["Detail"].default_value = 2.0
    wave.inputs["Detail Scale"].default_value = 1.5
    links.new(ramp(nodes, links, wave.outputs["Fac"], [(0.0, dark), (1.0, light)]), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    return mat


def boards_material(name="vault boards"):
    mat, nodes, links, bsdf = new_mat(name)
    uv = nodes.new("ShaderNodeTexCoord").outputs["UV"]
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv, sep.inputs[0])
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(sep.outputs[1], comb.inputs[0])  # along the hall
    links.new(sep.outputs[0], comb.inputs[1])  # around the vault
    br = nodes.new("ShaderNodeTexBrick")
    br.offset = 0.37
    links.new(comb.outputs[0], br.inputs["Vector"])
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.008
    br.inputs["Brick Width"].default_value = 3.4
    br.inputs["Row Height"].default_value = 0.24
    br.inputs["Color1"].default_value = (0.034, 0.02, 0.011, 1)
    br.inputs["Color2"].default_value = (0.022, 0.013, 0.008, 1)
    br.inputs["Mortar"].default_value = (0.004, 0.003, 0.002, 1)
    links.new(br.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def books_material():
    mat, nodes, links, bsdf = new_mat("book spines")
    book = nodes.new("ShaderNodeAttribute")
    book.attribute_type = "GEOMETRY"
    book.attribute_name = "book"
    shade = nodes.new("ShaderNodeAttribute")
    shade.attribute_type = "GEOMETRY"
    shade.attribute_name = "shade"
    palette = [
        (0.13, 0.022, 0.016),  # oxblood
        (0.065, 0.032, 0.016),  # dark brown
        (0.2, 0.11, 0.045),  # tan calf
        (0.03, 0.062, 0.036),  # bottle green
        (0.022, 0.03, 0.075),  # navy
        (0.016, 0.014, 0.012),  # black
        (0.24, 0.15, 0.05),  # ochre
        (0.075, 0.025, 0.045),  # plum
        (0.17, 0.045, 0.028),  # faded red
        (0.1, 0.06, 0.03),  # brown
        (0.3, 0.25, 0.17),  # vellum
        (0.045, 0.05, 0.03),  # olive
    ]
    stops = [(i / len(palette), c) for i, c in enumerate(palette)]
    color = ramp(nodes, links, book.outputs["Fac"], stops, constant=True)
    level = math_node(nodes, links, "MULTIPLY_ADD", shade.outputs["Fac"], 0.8)
    level.node.inputs[2].default_value = 0.6
    comb = nodes.new("ShaderNodeCombineXYZ")
    for i in range(3):
        links.new(level, comb.inputs[i])
    links.new(mix_color(nodes, links, 1.0, color, comb.outputs[0], "MULTIPLY"), bsdf.inputs["Base Color"])
    rough = math_node(nodes, links, "MULTIPLY_ADD", shade.outputs["Fac"], 0.35)
    rough.node.inputs[2].default_value = 0.4
    links.new(rough, bsdf.inputs["Roughness"])
    bsdf.inputs["Sheen Weight"].default_value = 0.3
    return mat


def image_material(name, img, roughness=0.9, sheen=0.08, emission=0.0):
    mat, nodes, links, bsdf = new_mat(name)
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    if emission:
        nodes.clear()
        out = nodes.new("ShaderNodeOutputMaterial")
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs["Strength"].default_value = emission
        links.new(tex.outputs["Color"], emit.inputs["Color"])
        links.new(emit.outputs[0], out.inputs[0])
        return mat
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Sheen Weight"].default_value = sheen
    return mat


def flame_material(name, height, strength=30.0, core=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord, sep.inputs[0])
    g = math_node(nodes, links, "DIVIDE", sep.outputs["Z"], height, clamp=True)
    if core:
        color = ramp(nodes, links, g, [(0.0, (1.0, 0.78, 0.4)), (0.6, (1.0, 0.5, 0.12)), (1.0, (1.0, 0.32, 0.05))])
    else:
        color = ramp(nodes, links, g, [(0.0, (1.0, 0.55, 0.14)), (0.3, (1.0, 0.3, 0.04)), (1.0, (0.6, 0.06, 0.01))])
    emit = nodes.new("ShaderNodeEmission")
    links.new(color, emit.inputs["Color"])
    st = nodes.new("ShaderNodeMapRange")
    links.new(g, st.inputs["Value"])
    st.inputs["To Min"].default_value = strength
    st.inputs["To Max"].default_value = strength * 0.25
    links.new(st.outputs["Result"], emit.inputs["Strength"])
    fade = nodes.new("ShaderNodeMapRange")
    links.new(g, fade.inputs["Value"])
    fade.inputs["From Min"].default_value = 0.3
    fade.inputs["From Max"].default_value = 1.0
    fade.inputs["To Min"].default_value = 0.0
    fade.inputs["To Max"].default_value = 0.95
    # Soft edges: more see-through where the flame's surface turns away.
    facing = nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    edge = math_node(nodes, links, "POWER", facing.outputs["Facing"], 1.6)
    alpha = math_node(nodes, links, "MAXIMUM", fade.outputs["Result"], edge, clamp=True)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(alpha, mix.inputs[0])
    links.new(emit.outputs[0], mix.inputs[1])
    links.new(transparent.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    return mat


def fire_volume_material():
    """Emission-only volume flames: rising tongues of stretched noise, blackbody coloured."""
    mat = bpy.data.materials.new("fire volume")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord, sep.inputs[0])
    stretch = nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (1.0, 1.0, 0.42)
    links.new(coord, stretch.inputs[0])
    noise = nodes.new("ShaderNodeTexNoise")
    links.new(stretch.outputs[0], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 3.2
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.62
    noise.inputs["Distortion"].default_value = 0.9
    # Tongues thin out with height.
    h = math_node(nodes, links, "MULTIPLY_ADD", sep.outputs["Z"], -0.42)
    h.node.inputs[2].default_value = -0.24
    flame = math_node(nodes, links, "ADD", noise.outputs["Fac"], h)
    flame = math_node(nodes, links, "MULTIPLY", flame, 4.0, clamp=True)

    def falloff(value, a, b):
        absval = math_node(nodes, links, "ABSOLUTE", value)
        mr = nodes.new("ShaderNodeMapRange")
        mr.interpolation_type = "SMOOTHSTEP"
        links.new(absval, mr.inputs["Value"])
        mr.inputs["From Min"].default_value = a
        mr.inputs["From Max"].default_value = b
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.0
        return mr.outputs["Result"]

    fx = falloff(sep.outputs["X"], 0.3, 0.72)
    fy = falloff(sep.outputs["Y"], 0.06, 0.26)
    fz = math_node(nodes, links, "MULTIPLY", sep.outputs["Z"], 12.0, clamp=True)
    density = math_node(nodes, links, "MULTIPLY", flame, fx)
    density = math_node(nodes, links, "MULTIPLY", density, fy)
    density = math_node(nodes, links, "MULTIPLY", density, fz)
    temp = nodes.new("ShaderNodeMapRange")
    links.new(density, temp.inputs["Value"])
    temp.inputs["To Min"].default_value = 1000.0
    temp.inputs["To Max"].default_value = 2100.0
    body = nodes.new("ShaderNodeBlackbody")
    links.new(temp.outputs["Result"], body.inputs["Temperature"])
    strength = math_node(nodes, links, "POWER", density, 2.0)
    strength = math_node(nodes, links, "MULTIPLY", strength, 30.0)
    emit = nodes.new("ShaderNodeEmission")
    links.new(body.outputs["Color"], emit.inputs["Color"])
    links.new(strength, emit.inputs["Strength"])
    links.new(emit.outputs[0], out.inputs["Volume"])
    return mat


def embers_material():
    mat = bpy.data.materials.new("embers")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    vor = nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    links.new(coord, vor.inputs["Vector"])
    vor.inputs["Scale"].default_value = 14.0
    glow = ramp(nodes, links, vor.outputs["Distance"], [(0.0, (1.0, 0.35, 0.05)), (0.12, (0.4, 0.06, 0.01)), (0.3, (0.0, 0.0, 0.0))])
    emit = nodes.new("ShaderNodeEmission")
    links.new(glow, emit.inputs["Color"])
    emit.inputs["Strength"].default_value = 14.0
    links.new(emit.outputs[0], out.inputs[0])
    return mat


def mist_material():
    mat = bpy.data.materials.new("frame mist")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    noise = nodes.new("ShaderNodeTexNoise")
    links.new(coord, noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 0.5
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Distortion"].default_value = 1.5
    level = ramp(nodes, links, noise.outputs["Fac"], [(0.4, (0.0, 0.0, 0.0)), (0.8, (0.03, 0.06, 0.085))])
    vor = nodes.new("ShaderNodeTexVoronoi")
    links.new(coord, vor.inputs["Vector"])
    vor.inputs["Scale"].default_value = 9.0
    spark = math_node(nodes, links, "LESS_THAN", vor.outputs["Distance"], 0.03)
    spark = math_node(nodes, links, "MULTIPLY", spark, noise.outputs["Fac"])
    comb = nodes.new("ShaderNodeCombineXYZ")
    for i, k in enumerate(RUNE):
        links.new(math_node(nodes, links, "MULTIPLY", spark, k * 0.6), comb.inputs[i])
    color = mix_color(nodes, links, 1.0, level, comb.outputs[0], "ADD")
    emit = nodes.new("ShaderNodeEmission")
    links.new(color, emit.inputs["Color"])
    emit.inputs["Strength"].default_value = 1.0
    links.new(emit.outputs[0], out.inputs[0])
    return mat


def materials():
    m = type("M", (), {})()
    m.stone = stone_material("ashlar")
    m.floor = stone_material("flagstones", axes=("X", "Y"), c1=(0.09, 0.08, 0.07), c2=(0.06, 0.054, 0.047),
                             brick=(0.72, 0.5), mortar=0.008, roughness=0.38, rough_var=0.45, bump=0.3, mortar_dark=0.6)
    m.trim = trim_stone()
    m.soot = A.material("soot", (0.004, 0.0035, 0.003), roughness=0.95)
    m.wood = wood_material("dark oak")
    m.wood_h = wood_material("dark oak, across", direction="X")
    m.frame_wood = wood_material("frame oak", dark=(0.05, 0.026, 0.013), light=(0.072, 0.038, 0.018), roughness=0.32, coat=0.35, scale=9.0)
    m.boards = boards_material()
    m.books = books_material()
    m.brass = A.material("old brass", (0.42, 0.29, 0.11), roughness=0.38, metallic=1.0)
    m.bright_brass = A.material("brass", (0.62, 0.45, 0.2), roughness=0.3, metallic=1.0)
    m.iron = A.material("iron", (0.03, 0.028, 0.027), roughness=0.55, metallic=0.75)
    m.wax = A.material("wax", (0.36, 0.3, 0.22), roughness=0.45)
    m.wax.node_tree.nodes["Principled BSDF"].inputs["Subsurface Weight"].default_value = 0.25
    m.charred = A.material("charred wood", (0.022, 0.014, 0.01), roughness=0.9)
    m.leather = A.material("oxblood leather", (0.085, 0.014, 0.011), roughness=0.4)
    m.leather_dark = A.material("dark leather", (0.045, 0.009, 0.007), roughness=0.5)
    m.green_leather = A.material("green leather", (0.03, 0.06, 0.035), roughness=0.45)
    m.tan_leather = A.material("tan leather", (0.2, 0.11, 0.045), roughness=0.5)
    m.paper = A.material("pages", (0.55, 0.49, 0.38), roughness=0.85)
    m.velvet_black = A.material("frame backing", (0.004, 0.004, 0.006), roughness=0.95, sheen=0.3)
    m.candle_flame = A.emissive("candle flame", CANDLE, 60.0)
    m.lamp_glass = A.emissive("lamp glass", (1.0, 0.66, 0.32), 9.0)
    m.rune = A.emissive("rune glint", RUNE, 10.0)
    return m


# ---------------------------------------------------------------- the hall


def build_shell(m, profile):
    A.plane((2 * W, FAR - BACK), (0, (FAR + BACK) / 2, 0), m.floor, name="floor")
    for wall in (LEFT, RIGHT):
        wall.abox(u_of(wall, (FAR + BACK) / 2), -0.15, SPRING / 2, FAR - BACK + 0.6, 0.3, SPRING, m.stone,
                  name="side wall")
    # End walls: rectangle plus the vault's pointed gable.
    outline = [(-W - 0.3, 0.0), (W + 0.3, 0.0)] + [(x, z) for x, z in reversed(profile)]
    outline[2] = (W + 0.3, SPRING)
    outline[-1] = (-W - 0.3, SPRING)
    verts = [(u, 0.0, z) for u, z in outline]
    for wall in (FARW, BACKW):
        wall_mesh(wall, verts, [tuple(range(len(verts)))], m.stone, name="end wall")

    # The boarded vault.
    ys = [BACK - 0.2, FAR + 0.2]
    verts, uvs, faces = [], [], []
    arc = [0.0]
    for (x0, z0), (x1, z1) in zip(profile, profile[1:]):
        arc.append(arc[-1] + math.hypot(x1 - x0, z1 - z0))
    for j, y in enumerate(ys):
        for i, (x, z) in enumerate(profile):
            verts.append((x, y, z))
            uvs.append((arc[i], y))
    n = len(profile)
    for i in range(n - 1):
        faces.append((i, i + 1, n + i + 1, n + i))
    mesh_object("vault", verts, faces, m.boards, smooth=True, uvs=uvs)

    # Oak ribs over each pier, tie beams, king and queen posts, ridge and purlins.
    timber = Acc()
    apex = SPRING + RISE
    for y in PIERS:
        y_c = min(max(y, BACK + 0.15), FAR - 0.15)
        rib_v, rib_f = [], []
        for i, (x, z) in enumerate(profile):
            a = profile[max(i - 1, 0)]
            b = profile[min(i + 1, n - 1)]
            tx, tz = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(tx, tz)
            nx, nz = tz / ln, -tx / ln  # inward
            for dy in (-0.16, 0.16):
                rib_v.append((x + nx * 0.02, y_c + dy, z + nz * 0.02))
                rib_v.append((x + nx * 0.4, y_c + dy, z + nz * 0.4))
        for i in range(n - 1):
            a, b = 4 * i, 4 * (i + 1)
            rib_f += [(a + 1, b + 1, b + 3, a + 3), (a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3)]
        timber.add(rib_v, rib_f)
        if y in (BACK, FAR):
            continue
        timber.box((0, y, SPRING - 0.12), (2 * W, 0.32, 0.42))
        timber.box((0, y, (SPRING + apex) / 2), (0.28, 0.28, apex - SPRING))
        for x in (-3.4, 3.4):
            top = vault_z(x, profile) - 0.3
            timber.box((x, y, (SPRING + top) / 2), (0.22, 0.22, top - SPRING))
        # Curved braces under the tie beam, against the walls.
        for side in (-1, 1):
            timber.box((side * (W - 0.75), y, SPRING - 0.75), (0.2, 0.2, 1.4), rot=(0, side * 40, 0))
    timber.box((0, (FAR + BACK) / 2, apex - 0.32), (0.26, FAR - BACK, 0.34))
    for x in (-5.6, -2.6, 2.6, 5.6):
        z = vault_z(x, profile)
        slope = math.degrees(math.atan2(vault_z(x + 0.05, profile) - vault_z(x - 0.05, profile), 0.1))
        timber.box((x, (FAR + BACK) / 2, z - 0.2), (0.22, FAR - BACK, 0.26), rot=(0, -slope, 0))
    timber.build("timbers", m.wood_h, bevel=0.012)


def build_piers(m):
    trim = Acc()
    for wall in (LEFT, RIGHT):
        for y in PIERS:
            y_c = min(max(y, BACK + 0.4), FAR - 0.4)
            u = u_of(wall, y_c)
            width = 0.8
            wall.abox(u, 0.22, SPRING / 2, width, 0.45, SPRING, m.stone, name="pier")
            wall.box(trim, u, 0.3, 0.3, width + 0.18, 0.62, 0.6)
            wall.box(trim, u, 0.32, SPRING - 0.22, width + 0.24, 0.66, 0.24)
            wall.box(trim, u, 0.28, SPRING - 0.42, width + 0.1, 0.56, 0.12)
            offsets = (-0.24, 0.0, 0.24) if y not in (BACK, FAR) else (0.0,)
            for du in offsets:
                p = wall.p(u + du, 0.5, 0.6)
                trim.prism(p, 0.085, SPRING - 1.0, segs=12)
    # A string course above the upper shelves, all the way round.
    for wall in (LEFT, RIGHT):
        wall.box(trim, u_of(wall, (FAR + BACK) / 2), 0.12, UPPER_TOP + 0.4, FAR - BACK, 0.24, 0.2)
    for wall in (FARW, BACKW):
        wall.box(trim, 0, 0.12, UPPER_TOP + 0.4, 2 * W, 0.24, 0.2)
    # Blind arcading in the stone above it, two small arches per bay.
    for wall in (LEFT, RIGHT):
        for y0, y1 in zip(PIERS, PIERS[1:]):
            yc = (y0 + y1) / 2
            if wall is RIGHT and abs(yc - FIRE_Y) < 0.1:
                continue
            for du in (-0.78, 0.78):
                cu = u_of(wall, yc) + du
                inner = arch_outline(0.5, 8.75, 1.15, UPPER_TOP + 0.5, n=10, cu=cu)
                outer = arch_outline(0.62, 8.75, (1.15 * 0.5 + 0.12) / 0.62, UPPER_TOP + 0.5, n=10, cu=cu)
                v, f = strip_solid(inner, outer, 0.0, 0.14)
                trim.add([wall.p(a, b, c) for a, b, c in v], f)
                wall.box(trim, cu, 0.03, (UPPER_TOP + 0.5 + 9.3) / 2, 1.0, 0.04, 9.3 - UPPER_TOP - 0.5)
    trim.build("stone trim", m.trim)


def books_row(wall, books, u0, u1, z0, clear, depth):
    """One shelf's worth of books, leaning and stacked here and there."""
    u = u0 + R.uniform(0.0, 0.03)
    lean_next = 0.0
    while u < u1 - 0.03:
        r = R.random()
        attrs = {"book": R.random(), "shade": R.random()}
        if r < 0.035:
            u += R.uniform(0.06, 0.22)
            lean_next = R.choice((-1, 1)) * R.uniform(8, 18)
            continue
        if r < 0.07 and u1 - u > 0.3:
            # A short pile of books lying flat.
            length = R.uniform(0.2, 0.28)
            z = z0
            for _ in range(R.randint(2, 5)):
                t = R.uniform(0.03, 0.05)
                if z + t > z0 + clear - 0.02:
                    break
                d = R.uniform(0.16, 0.22)
                wall.box(books, u + length / 2, depth - 0.02 - d / 2, z + t / 2, length + R.uniform(-0.03, 0.0), d, t,
                         rot=(0, 0, R.uniform(-4, 4)), book=R.random(), shade=R.random())
                z += t
            u += length + 0.015
            continue
        w = R.uniform(0.022, 0.06) if R.random() > 0.1 else R.uniform(0.06, 0.09)
        h = min(clear - 0.015, R.uniform(0.2, 0.37) if R.random() > 0.25 else R.uniform(0.15, 0.22))
        d = min(depth - 0.04, R.uniform(0.15, 0.24) * (0.8 + h))
        n = depth - R.uniform(0.008, 0.03) - d / 2
        if lean_next:
            a = math.radians(abs(lean_next))
            zc = z0 + (h * math.cos(a) + w * math.sin(a)) / 2
            wall.box(books, u + w / 2 + h * math.sin(a) / 2, n, zc, w, d, h, rot=(0, lean_next, 0), **attrs)
            u += w + h * math.sin(a) + 0.005
            lean_next = 0.0
        else:
            wall.box(books, u + w / 2, n, z0 + h / 2, w, d, h, **attrs)
            u += w + R.uniform(0.0, 0.004)


def bookcase(wall, wood, books, u0, u1, z0, z1, depth=CASE_D, columns=None, shelf=0.42, cornice=True):
    width = u1 - u0
    uc = (u0 + u1) / 2
    zc = (z0 + z1) / 2
    wall.box(wood, uc, 0.02, zc, width, 0.04, z1 - z0)
    columns = columns or max(1, round(width / 0.95))
    edges = [u0 + width * i / columns for i in range(columns + 1)]
    for i, u in enumerate(edges):
        t = 0.07 if i in (0, columns) else 0.05
        wall.box(wood, u, depth / 2, zc, t, depth, z1 - z0)
        if i in (0, columns):
            wall.box(wood, u, depth + 0.01, zc, t + 0.03, 0.03, z1 - z0)
    plinth = 0.14
    wall.box(wood, uc, depth / 2 + 0.01, z0 + plinth / 2, width + 0.02, depth + 0.02, plinth)
    if cornice:
        wall.box(wood, uc, depth / 2 + 0.04, z1 - 0.05, width + 0.1, depth + 0.08, 0.1)
        wall.box(wood, uc, depth / 2 + 0.06, z1 + 0.02, width + 0.16, depth + 0.12, 0.05)
    rows = max(1, int((z1 - 0.1 - z0 - plinth) / shelf))
    gap = (z1 - 0.1 - z0 - plinth) / rows
    for k in range(rows):
        zb = z0 + plinth + k * gap
        if k:
            wall.box(wood, uc, depth / 2, zb, width, depth, 0.03)
        for a, b in zip(edges, edges[1:]):
            books_row(wall, books, a + 0.035, b - 0.035, zb + 0.015, gap - 0.04, depth)


def gallery(wall, wood, u0, u1, posts):
    length = u1 - u0
    uc = (u0 + u1) / 2
    wall.box(wood, uc, GAL_D / 2, GAL_Z - 0.14, length, GAL_D, 0.28)
    wall.box(wood, uc, GAL_D + 0.02, GAL_Z - 0.2, length, 0.08, 0.42)
    wall.box(wood, uc, GAL_D + 0.06, GAL_Z - 0.03, length, 0.06, 0.06)
    wall.box(wood, uc, GAL_D + 0.05, GAL_Z - 0.38, length, 0.06, 0.05)
    rail = GAL_D - 0.06
    wall.box(wood, uc, rail, GAL_Z + 1.0, length, 0.1, 0.07)
    wall.box(wood, uc, rail, GAL_Z + 0.08, length, 0.08, 0.06)
    count = int(length / 0.15)
    for i in range(count + 1):
        u = u0 + 0.075 + i * (length - 0.15) / count
        wood.prism(wall.p(u, rail, GAL_Z + 0.1), 0.02, 0.88, segs=6)
    for u in posts:
        if u0 - 0.01 <= u <= u1 + 0.01:
            wall.box(wood, u, rail, GAL_Z + 0.55, 0.12, 0.12, 1.15)
            wall.box(wood, u, rail, GAL_Z + 1.16, 0.15, 0.15, 0.06)
            # A diagonal bracket under the gallery.
            wall.box(wood, u, 0.62, GAL_Z - 0.85, 0.14, 1.35, 0.16, rot=(38, 0, 0))


def build_shelves(m):
    wood, books = Acc(), Acc()
    for wall in (LEFT, RIGHT):
        for y0, y1 in zip(PIERS, PIERS[1:]):
            a, b = sorted((u_of(wall, y0), u_of(wall, y1)))
            a, b = a + 0.45, b - 0.45
            fire_bay = abs((y0 + y1) / 2 - FIRE_Y) < 0.1
            if not (wall is LEFT and fire_bay):
                bookcase(wall, wood, books, a, b, 0.0, CASE_TOP)
                if not (wall is RIGHT and fire_bay):
                    bookcase(wall, wood, books, a, b, GAL_Z, UPPER_TOP, depth=0.38)
        posts = [u_of(wall, y) for y in PIERS]
        if wall is LEFT:
            gallery(wall, wood, u_of(wall, FAR), u_of(wall, 2.85), posts + [u_of(wall, 2.85)])
            gallery(wall, wood, u_of(wall, 0.15), u_of(wall, BACK), posts + [u_of(wall, 0.15)])
        else:
            gallery(wall, wood, u_of(wall, BACK), u_of(wall, FAR), posts)
    # Behind: shelves either side of the doorway, the gallery above.
    for a, b in ((-7.55, -4.6), (-4.5, -1.5), (1.5, 4.5), (4.6, 7.55)):
        bookcase(BACKW, wood, books, a, b, 0.0, CASE_TOP)
    for a, b in ((-7.55, -4.6), (-4.5, -1.55), (-1.45, 1.45), (1.55, 4.5), (4.6, 7.55)):
        bookcase(BACKW, wood, books, a, b, GAL_Z, UPPER_TOP, depth=0.38)
    gallery(BACKW, wood, -W + GAL_D, W - GAL_D, [-6.6, -3.3, 0.0, 3.3, 6.6])
    # Ahead: tall cases either side of the great frame.
    for a, b in ((-7.6, -5.75), (5.75, 7.6)):
        bookcase(FARW, wood, books, a, b, 0.0, 7.0, depth=0.46, columns=2)
        # A library ladder leaning on each.
        lu = (a + b) / 2
        lean = math.degrees(math.atan2(0.62, 6.6))
        for du in (-0.24, 0.24):
            FARW.box(wood, lu + du, 0.82, 3.35, 0.05, 0.07, 6.75, rot=(lean, 0, 0))
        for k in range(22):
            z = 0.3 + k * 0.3
            n = 1.14 - 0.62 * z / 6.6
            FARW.box(wood, lu, n, z, 0.48, 0.035, 0.035)
    wood.build("shelves", m.wood, bevel=0.006)
    obj = books.build("books", m.books)
    print("BOOKS", len(books.f) // 6, flush=True)
    return obj


# ---------------------------------------------------------------- the window


def build_window(m):
    h, sill, spring, rfac = 1.05, 5.25, 8.0, 1.6
    cu = u_of(RIGHT, FIRE_Y)
    img, apex = stained_glass_image(h, sill, spring, rfac)
    outline = arch_outline(h, spring, rfac, sill, n=16, cu=cu)
    verts = [(u, 0.05, z) for u, z in outline]
    uvs = [((u - cu + h) / (2 * h), (z - sill) / (apex - sill)) for u, z in outline]
    wall_mesh(RIGHT, verts, [tuple(reversed(range(len(verts))))], image_material("stained glass", img, emission=3.2),
              name="stained glass", uvs=uvs)
    trim = Acc()
    for a, b, n0, n1 in ((h, h + 0.16, 0.0, 0.34), (h + 0.16, h + 0.3, 0.0, 0.2)):
        rf_a = (rfac * h + (a - h)) / a
        rf_b = (rfac * h + (b - h)) / b
        v, f = strip_solid(arch_outline(a, spring, rf_a, sill, n=16, cu=cu),
                           arch_outline(b, spring, rf_b, sill, n=16, cu=cu), n0, n1)
        trim.add([RIGHT.p(*p) for p in v], f)
    RIGHT.box(trim, cu, 0.25, sill - 0.08, 2 * h + 0.7, 0.5, 0.16)
    RIGHT.box(trim, cu, 0.12, (sill + spring + 0.15) / 2, 0.1, 0.16, spring + 0.15 - sill)
    trim.build("window tracery", m.trim)
    torus(0.42, 0.045, RIGHT.p(cu, 0.12, spring + 0.62), m.trim, rotation=(90, 0, RIGHT.yaw), name="oculus")
    # Moonlight: the glass's soft glow into the room and a beam onto the floor.
    soft = A.area_light((1.8, 3.6), RIGHT.p(cu, 0.6, (sill + apex) / 2), (0, 0, 0), MOON, 500, name="window glow")
    hide_from_camera(soft, glossy=False)
    aim(soft, (0.0, FIRE_Y, 2.0))
    data = bpy.data.lights.new("moonbeam", "SPOT")
    data.color = MOON
    data.energy = 14000
    data.spot_size = math.radians(17)
    data.spot_blend = 0.4
    data.shadow_soft_size = 0.6
    beam = bpy.data.objects.new("moonbeam", data)
    A.collection("base").objects.link(beam)
    beam.location = RIGHT.p(cu, 0.5, 7.2)
    aim(beam, (-2.3, FIRE_Y + 3.0, 0.0))
    hide_from_camera(beam)


# ---------------------------------------------------------------- the fireplace


def build_fireplace(m):
    wall = LEFT
    cu = u_of(wall, FIRE_Y)
    half = 1.3
    depth = 1.3
    op_h, op_top = 0.95, 1.65
    # Chimney breast, cut round the firebox opening.
    for side in (-1, 1):
        wall.abox(cu + side * (op_h + (half - op_h) / 2), depth / 2, op_top / 2, half - op_h, depth, op_top, m.stone,
                  name="fireplace jamb")
    wall.abox(cu, depth / 2, (op_top + SPRING) / 2, 2 * half, depth, SPRING - op_top, m.stone, name="chimney breast")
    # Firebox: sooty back, sides, floor.
    wall.abox(cu, 0.38, op_top / 2, 2 * op_h, 0.1, op_top, m.soot, name="fireback")
    for side in (-1, 1):
        wall.abox(cu + side * (op_h - 0.03), 0.85, op_top / 2, 0.06, 0.9, op_top, m.soot, name="firebox side")
    wall.abox(cu, 0.85, op_top - 0.03, 2 * op_h, 0.9, 0.06, m.soot, name="firebox top")
    wall.abox(cu, 0.85, 0.1, 2 * op_h, 0.9, 0.2, m.soot, name="firebox floor")
    # Carved surround, mantel and overmantel.
    trim = Acc()
    for side in (-1, 1):
        wall.box(trim, cu + side * (op_h + 0.14), depth + 0.08, 1.0, 0.28, 0.16, 2.0)
        wall.box(trim, cu + side * (op_h + 0.14), depth + 0.1, 0.08, 0.36, 0.22, 0.16)
        wall.box(trim, cu + side * (half - 0.1), depth + 0.2, 2.02, 0.22, 0.4, 0.3)  # corbels
    wall.box(trim, cu, depth + 0.1, 1.86, 2 * op_h + 0.56, 0.2, 0.3)
    for k in range(9):  # a frieze of small blocks
        wall.box(trim, cu - 0.8 + k * 0.2, depth + 0.21, 1.86, 0.1, 0.04, 0.1)
    wall.box(trim, cu, depth + 0.25, 2.24, 2 * half + 0.3, 0.55, 0.12)  # mantel shelf
    wall.box(trim, cu, depth + 0.2, 2.15, 2 * half + 0.2, 0.45, 0.06)
    wall.box(trim, cu, depth + 0.05, 3.6, 2.0, 0.1, 2.3)  # overmantel panel
    wall.box(trim, cu, depth + 0.08, 4.8, 2.3, 0.16, 0.14)
    wall.box(trim, cu, depth + 0.08, 2.45, 2.3, 0.16, 0.12)
    # A carved celestial roundel: rings and rays.
    centre = (cu, depth + 0.12, 3.6)
    for k in range(16):
        a = 2 * math.pi * k / 16
        wall.box(trim, cu + 0.55 * math.cos(a), depth + 0.12, 3.6 + 0.55 * math.sin(a), 0.36, 0.06, 0.05,
                 rot=(0, -math.degrees(a), 0))
    for side in (-1, 1):  # pilasters up the breast, and bands across it
        wall.box(trim, cu + side * (half - 0.12), depth + 0.06, (2.3 + SPRING) / 2, 0.24, 0.12, SPRING - 2.3)
    for z in (5.1, GAL_Z - 0.1, UPPER_TOP + 0.4):
        wall.box(trim, cu, depth + 0.08, z, 2 * half + 0.1, 0.16, 0.18)
    wall.box(trim, cu, depth + 0.04, 6.3, 1.5, 0.08, 1.8)
    for k in range(5):
        wall.box(trim, cu - 0.6 + k * 0.3, depth + 0.1, 6.3, 0.08, 0.06, 1.5)
    trim.build("fireplace carving", m.trim)
    torus(0.78, 0.05, wall.p(*centre), m.trim, rotation=(90, 0, wall.yaw), name="roundel ring")
    torus(0.3, 0.04, wall.p(*centre), m.trim, rotation=(90, 0, wall.yaw), name="roundel ring")
    A.cylinder(0.18, 0.1, wall.p(*centre), m.trim, rotation=(90, 0, wall.yaw), name="roundel boss")
    # Hearth slab and a brass fender.
    wall.abox(cu, depth + 0.4, 0.04, 2 * half + 0.4, 0.8, 0.08, m.trim, name="hearth")
    fender = A.cylinder(0.02, 2 * op_h + 0.2, wall.p(cu, depth + 0.55, 0.3), m.brass, rotation=(0, 90, wall.yaw),
                        vertices=12, name="fender")
    for du in (-op_h - 0.08, 0, op_h + 0.08):
        A.cylinder(0.015, 0.24, wall.p(cu + du, depth + 0.55, 0.18), m.brass, vertices=8, name="fender post")
    # Andirons and logs.
    for du in (-0.55, 0.55):
        wall.abox(cu + du, 0.95, 0.32, 0.05, 0.6, 0.05, m.iron, name="andiron")
        A.sphere(0.05, wall.p(cu + du, 1.25, 0.4), m.brass, name="andiron knob", segments=12)
    for du, dn, z, rz, r in ((0.0, 0.78, 0.32, 0, 0.1), (0.05, 1.0, 0.3, 6, 0.085), (-0.1, 0.88, 0.48, -18, 0.08),
                             (0.15, 0.9, 0.46, 24, 0.07)):
        A.cylinder(r, 1.1, wall.p(cu + du, dn, z), m.charred, rotation=(0, 90, wall.yaw + rz), vertices=12,
                   name="log")

    # The fire (layer).
    fire = A.layer("fire")
    base = wall.p(cu, 0.88, 0.3)
    domain = Acc()
    domain.box((0, 0, 0.6), (1.6, 0.6, 1.2))
    flames = domain.build("flames", fire_volume_material(), fire)
    flames.location = base
    flames.rotation_euler = (0, 0, math.radians(wall.yaw))
    wall.abox(cu, 0.85, 0.235, 2 * op_h - 0.2, 0.7, 0.03, embers_material(), coll=fire, name="ember bed")
    for du, dn, z, p in ((-0.4, 1.15, 0.55, 30), (0.4, 1.15, 0.55, 30), (0.0, 1.2, 0.75, 45)):
        point(wall.p(cu + du, dn, z), FIRE, p, radius=0.15, coll=fire, name="fire")
    point(wall.p(cu, 1.75, 0.8), FIRE, 520, radius=0.45, coll=fire, glossy=False, name="fire glow")

    # Two wingback chairs drawn up to the fire, a low table and a rug.
    mats = (m.leather, m.wood, m.brass, m.leather_dark)
    wingback("base", mats, at=(-5.15, FIRE_Y - 1.75), yaw=36)
    wingback("base", mats, at=(-5.15, FIRE_Y + 1.75), yaw=144)
    A.cylinder(0.36, 0.05, (-4.9, FIRE_Y, 0.48), m.wood, vertices=32, name="tea table")
    A.cylinder(0.05, 0.45, (-4.9, FIRE_Y, 0.24), m.wood, vertices=12, name="tea table post")
    A.cylinder(0.25, 0.04, (-4.9, FIRE_Y, 0.02), m.wood, vertices=24, name="tea table foot")
    book_stack((-4.95, FIRE_Y - 0.08, 0.505), m, count=3, yaw=20)
    rug = A.plane((3.4, 4.8), (-5.0, FIRE_Y, 0.006), image_material(
        "fireside rug", rug_image("fireside rug", 4.8, 3.4,
                                  [(0.018, 0.024, 0.05), (0.075, 0.017, 0.013), (0.15, 0.095, 0.03), (0.18, 0.14, 0.085)], 7)),
        name="fireside rug")
    rug.rotation_euler = (0, 0, 0)


# ---------------------------------------------------------------- the great frame ahead


def build_frame(m):
    wall = FARW
    half, bottom, top = A.screen_rect(FAR - 0.3, margin=1.035)
    print(f"FRAME half={half:.2f} top={top:.2f} bottom={bottom:.2f}", flush=True)
    wall.abox(0, 0.06, top / 2, 2 * half + 0.2, 0.04, top + 0.2, m.velvet_black, name="frame backing")
    wood, brass = Acc(), Acc()
    b = 0.7  # frame width
    for side in (-1, 1):
        u = side * (half + b / 2)
        wall.box(wood, u, 0.22, (top + b) / 2, b, 0.3, top + b)
        wall.box(wood, side * (half + b + 0.1), 0.12, (top + b + 0.2) / 2, 0.22, 0.18, top + b + 0.2)
        wall.box(brass, side * (half + 0.045), 0.39, top / 2, 0.09, 0.06, top + 0.09)
        wall.box(brass, side * (half + b - 0.03), 0.38, (top + b) / 2, 0.04, 0.04, top + b)
        wall.box(wood, side * (half + 0.24), 0.39, top / 2, 0.16, 0.05, top + 0.25)
    wall.box(wood, 0, 0.22, top + b / 2, 2 * (half + b), 0.3, b)
    wall.box(wood, 0, 0.12, top + b + 0.1, 2 * (half + b + 0.2), 0.18, 0.22)
    wall.box(brass, 0, 0.39, top + 0.045, 2 * half, 0.06, 0.09)
    wall.box(brass, 0, 0.38, top + b - 0.03, 2 * (half + b), 0.04, 0.04)
    wall.box(wood, 0, 0.39, top + 0.24, 2 * (half + 0.24), 0.05, 0.16)
    # Crest: a pointed gable of oak over the top rail, with a brass ring.
    z0 = top + b + 0.2
    v, f = strip_solid(arch_outline(1.0, z0 + 0.1, 1.5, z0, n=12), arch_outline(1.35, z0 + 0.1, (1.5 + 0.35) / 1.35, z0, n=12),
                       0.08, 0.34)
    wood.add([wall.p(*p) for p in v], f)
    crest_apex = arch_apex(1.35, z0 + 0.1, (1.5 + 0.35) / 1.35)
    wall.box(wood, 0, 0.12, z0 + 0.6, 2.0, 0.08, 1.2)
    # Pinnacles on the corners and the apex.
    for u, z in ((-(half + b / 2), top + b), (half + b / 2, top + b), (0, crest_apex - 0.05)):
        wall.box(wood, u, 0.22, z + 0.35, 0.2, 0.2, 0.7)
        wall.box(brass, u, 0.22, z + 0.72, 0.26, 0.26, 0.05)
        cone(0.17, 0.0, 0.7, wall.p(u, 0.22, z + 1.1), m.frame_wood, vertices=4, rotation=(0, 0, 45), name="pinnacle")
        A.sphere(0.05, wall.p(u, 0.22, z + 1.5), m.brass, segments=12, name="finial")
    wood.build("great frame", m.frame_wood, bevel=0.012)
    brass.build("frame brass", m.brass, bevel=0.006)
    torus(0.48, 0.045, wall.p(0, 0.3, z0 + 0.62), m.brass, rotation=(90, 0, 0), name="crest ring")
    torus(0.24, 0.03, wall.p(0, 0.3, z0 + 0.62), m.brass, rotation=(90, 0, 0), name="crest ring")
    studs = []
    for side in (-1, 1):
        studs.append((side * (half + b / 2), top + b / 2, 0.16))
        z = top - 0.6
        while z > 0.6:
            studs.append((side * (half + b / 2), z, 0.07))
            z -= 0.8
    u = -half + 0.4
    while u < half - 0.3:
        studs.append((u, top + b / 2, 0.07))
        u += 0.8
    for u, z, r in studs:
        crisp(A.cylinder(r, 0.05, wall.p(u, 0.39, z), m.brass, rotation=(90, 0, 0), vertices=20, name="rosette"))
        A.sphere(r * 0.45, wall.p(u, 0.41, z), m.brass, segments=12, name="rosette boss")
    # Two tall iron candelabra flanking the frame (their candles in the candles layer).
    candles = A.layer("candles")
    wax, flames = Acc(), Acc()
    for side in (-1, 1):
        x, y = side * 6.35, FAR - 1.3
        A.cylinder(0.035, 2.2, (x, y, 1.15), m.iron, vertices=12, name="candelabrum")
        for k in range(3):
            a = math.radians(90 + k * 120)
            A.box((0.05, 0.5, 0.05), (x + 0.2 * math.cos(a), y + 0.2 * math.sin(a), 0.12), m.iron,
                  rotation=(-25, 0, math.degrees(a) - 90), name="candelabrum foot")
        torus(0.08, 0.02, (x, y, 1.2), m.iron, segs=16, minor_segs=6, name="candelabrum knop")
        A.cylinder(0.04, 0.6, (x, y, 2.3), m.iron, rotation=(0, 90, 90), vertices=8, name="candelabrum arm")
        for k, du in enumerate((-0.28, -0.14, 0.0, 0.14, 0.28)):
            hh = 0.06 + 0.12 * (1 - abs(du) / 0.28)
            A.cylinder(0.008, hh, (x, y + du, 2.3 + hh / 2), m.iron, vertices=6, name="candelabrum branch")
            crisp(A.cylinder(0.04, 0.02, (x, y + du, 2.3 + hh), m.brass, vertices=12, name="drip pan"))
            candle(wax, flames, candles, (x, y + du, 2.31 + hh), R.uniform(0.2, 0.3), r=0.025, power=6.0, flame=1.2)
        point((x - side * 0.4, y - 0.4, 2.7), CANDLE, 90, radius=0.4, coll=candles, glossy=False, name="candelabrum glow")
    wax.build("candelabra candles", m.wax)
    flames.build("candelabra flames", m.candle_flame, candles, smooth=True)
    # Feet: stone plinths under the stiles.
    for side in (-1, 1):
        wall.abox(side * (half + b / 2), 0.3, 0.2, b + 0.2, 0.5, 0.4, m.trim, name="frame plinth")

    # Blind tracery in the stone above: a great pointed arch and a stone rose.
    trim = Acc()
    spring = top + b + 0.6
    hh = half + b + 0.5
    v, f = strip_solid(arch_outline(hh, spring, 1.15, 0.0, n=20), arch_outline(hh + 0.35, spring, (1.15 * hh + 0.35) / (hh + 0.35), 0.0, n=20),
                       0.0, 0.25)
    trim.add([wall.p(*p) for p in v], f)
    rose_z = (crest_apex + arch_apex(hh, spring, 1.15)) / 2 + 0.3
    for k in range(12):
        a = 2 * math.pi * k / 12
        wall.box(trim, 0.95 * math.cos(a), 0.12, rose_z + 0.95 * math.sin(a), 1.0, 0.1, 0.08, rot=(0, -math.degrees(a), 0))
    trim.build("far tracery", m.trim)
    torus(1.5, 0.08, wall.p(0, 0.14, rose_z), m.trim, rotation=(90, 0, 0), name="rose")
    torus(0.45, 0.07, wall.p(0, 0.14, rose_z), m.trim, rotation=(90, 0, 0), name="rose")
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        torus(0.22, 0.03, wall.p(1.15 * math.cos(a), 0.14, rose_z + 1.15 * math.sin(a)), m.trim, rotation=(90, 0, 0),
              segs=16, minor_segs=6, name="rose foil")

    # Runes (layer): rows of tiny glints along the inner brass, a faint mist inside.
    runes = A.layer("runes")
    glints = Acc()
    rng = random.Random(9)

    def glyph_row(points):
        for (u, z, horizontal) in points:
            kind = rng.random()
            if kind < 0.4:
                s = (0.028, 0.02, 0.028)
            elif kind < 0.7:
                s = (0.09, 0.02, 0.022) if horizontal else (0.022, 0.02, 0.09)
            else:
                s = (0.022, 0.02, 0.07) if horizontal else (0.07, 0.02, 0.022)
            wall.box(glints, u, 0.43, z, *s, rot=(0, rng.choice((0, 0, 45)), 0))

    pts = []
    for side in (-1, 1):
        z = 0.4
        while z < top - 0.1:
            if rng.random() < 0.8:
                pts.append((side * (half + 0.24), z + rng.uniform(-0.02, 0.02), False))
            z += rng.uniform(0.07, 0.13) if rng.random() > 0.12 else 0.35
    u = -half + 0.1
    while u < half - 0.1:
        if rng.random() < 0.8:
            pts.append((u, top + 0.24 + rng.uniform(-0.02, 0.02), True))
        u += rng.uniform(0.07, 0.13) if rng.random() > 0.12 else 0.35
    glyph_row(pts)
    glints.build("rune glints", m.rune, runes)
    wall.abox(0, 0.1, top / 2, 2 * half, 0.01, top, mist_material(), coll=runes, name="frame mist")
    for u, z in ((-half, top), (half, top), (-half, 1.0), (half, 1.0), (0, top)):
        point(wall.p(u, 0.9, z), RUNE, 40, radius=0.3, coll=runes, glossy=True, name="rune light")

    # The film's own light, faint and cool, for the room while it plays.
    spill = A.area_light((2 * half, top), wall.p(0, 0.8, top / 2), (-90, 0, 0), (0.7, 0.76, 0.92), 600,
                         name="screen spill")
    spill.rotation_euler = (math.radians(90), 0, math.radians(180))
    hide_from_camera(spill, glossy=False)
    return top


# ---------------------------------------------------------------- doorway behind


def build_door(m):
    wall = BACKW
    h, spring, rfac = 0.95, 2.1, 1.25
    outline = arch_outline(h, spring, rfac, 0.0, n=12)
    verts = [(u, 0.04, z) for u, z in outline]
    wall_mesh(wall, verts, [tuple(range(len(verts)))], m.wood, name="door")
    trim = Acc()
    for a, b, n1 in ((h, h + 0.2, 0.3), (h + 0.2, h + 0.36, 0.18)):
        v, f = strip_solid(arch_outline(a, spring, (rfac * h + a - h) / a, 0.0, n=12),
                           arch_outline(b, spring, (rfac * h + b - h) / b, 0.0, n=12), 0.0, n1)
        trim.add([wall.p(*p) for p in v], f)
    trim.build("door arch", m.trim)
    iron = Acc()
    wall.box(iron, 0, 0.07, 1.4, 0.03, 0.03, 2.8)
    for z in (0.5, 1.4, 2.1):
        for side in (-1, 1):
            wall.box(iron, side * 0.45, 0.07, z, 0.8, 0.02, 0.07)
    iron.build("door iron", m.iron)
    for side in (-1, 1):
        torus(0.07, 0.012, wall.p(side * 0.15, 0.1, 1.05), m.iron, rotation=(90, 0, 0), segs=16, minor_segs=6,
              name="door ring")


# ---------------------------------------------------------------- furniture and props


def book_stack(pos, m, count=4, yaw=0.0):
    covers = (m.leather, m.green_leather, m.tan_leather, m.leather_dark)
    z = pos[2]
    rng = random.Random(int(pos[0] * 100 + pos[1] * 10))
    for k in range(count):
        t = rng.uniform(0.035, 0.06)
        w, d = rng.uniform(0.18, 0.26), rng.uniform(0.14, 0.2)
        rot = (0, 0, yaw + rng.uniform(-12, 12))
        A.box((w, d, t), (pos[0], pos[1], z + t / 2), covers[k % len(covers)], rotation=rot, name="book")
        A.box((w - 0.012, d - 0.015, t - 0.012), (pos[0] + 0.004, pos[1], z + t / 2), m.paper, rotation=rot,
              name="pages")
        z += t


def oil_lamp(pos, m, candles):
    x, y, z = pos
    A.cylinder(0.065, 0.025, (x, y, z + 0.012), m.brass, vertices=16, name="lamp foot")
    A.cylinder(0.012, 0.13, (x, y, z + 0.09), m.brass, vertices=8, name="lamp stem")
    A.sphere(0.055, (x, y, z + 0.19), m.brass, segments=16, name="lamp font")
    A.sphere(0.07, (x, y, z + 0.3), m.lamp_glass, coll=candles, segments=16, name="lamp glass")
    A.cylinder(0.026, 0.12, (x, y, z + 0.41), m.lamp_glass, coll=candles, vertices=12, name="lamp chimney")
    point((x, y, z + 0.3), WARM, 60, radius=0.07, coll=candles, name="lamp")


def open_book(pos, m, yaw=0.0):
    x, y, z = pos
    A.box((0.46, 0.32, 0.012), (x, y, z + 0.006), m.leather_dark, rotation=(0, 0, yaw), name="open cover")
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    for side in (-1, 1):
        A.box((0.21, 0.29, 0.025), (x + side * 0.11 * c, y + side * 0.11 * s, z + 0.025), m.paper,
              rotation=(0, -side * 5, yaw), name="open pages")


def table_globe(pos, m, globe_mat, radius=0.17):
    x, y, z = pos
    A.cylinder(0.11, 0.03, (x, y, z + 0.015), m.wood, vertices=24, name="globe foot")
    A.cylinder(0.018, 0.12, (x, y, z + 0.09), m.brass, vertices=8, name="globe post")
    g = A.sphere(radius, (x, y, z + 0.17 + radius), globe_mat, segments=32, name="globe")
    g.rotation_euler = (math.radians(23), 0, math.radians(40))
    torus(radius + 0.02, 0.008, (x, y, z + 0.17 + radius), m.brass, rotation=(90, 23, 30), segs=40, minor_segs=6,
          name="meridian")


def armillary(pos, m):
    x, y, z = pos
    A.cylinder(0.09, 0.03, (x, y, z + 0.015), m.wood, vertices=24, name="armillary foot")
    A.cylinder(0.014, 0.16, (x, y, z + 0.11), m.brass, vertices=8, name="armillary post")
    c = (x, y, z + 0.33)
    for rot in ((90, 0, 0), (90, 0, 60), (90, 0, 120), (0, 0, 0), (23, 0, 0)):
        torus(0.15, 0.006, c, m.bright_brass, rotation=rot, segs=40, minor_segs=6, name="armillary ring")
    A.sphere(0.035, c, m.bright_brass, segments=16, name="armillary core")


def reading_table(at, length, m, candles, props):
    x, y = at
    A.box((1.05, length, 0.07), (x, y, 0.79), m.wood, bevel=0.015, name="table top")
    for side in (-1, 1):
        yy = y + side * (length / 2 - 0.35)
        A.box((0.12, 0.1, 0.72), (x, yy, 0.39), m.wood, name="trestle")
        A.box((0.85, 0.14, 0.08), (x, yy, 0.04), m.wood, bevel=0.01, name="trestle foot")
        A.box((0.8, 0.12, 0.06), (x, yy, 0.72), m.wood, name="trestle head")
    A.box((0.1, length - 0.7, 0.1), (x, y, 0.28), m.wood, name="stretcher")
    for side in (-1, 1):
        A.box((0.34, length - 0.5, 0.06), (x + side * 0.85, y, 0.46), m.wood, bevel=0.01, name="bench")
        for yy in (y - length / 2 + 0.5, y + length / 2 - 0.5):
            A.box((0.28, 0.06, 0.43), (x + side * 0.85, yy, 0.215), m.wood, name="bench leg")
    top = 0.825
    for kind, dy, extra in props:
        p = (x + extra, y + dy, top)
        if kind == "lamp":
            oil_lamp(p, m, candles)
        elif kind == "book":
            open_book(p, m, yaw=R.uniform(-15, 15) + 90)
        elif kind == "stack":
            book_stack(p, m, count=R.randint(3, 5), yaw=R.uniform(0, 90))
        elif kind == "globe":
            table_globe(p, m, m.globe)
        elif kind == "armillary":
            armillary(p, m)
        elif kind == "scrolls":
            for k in range(3):
                A.cylinder(0.025, 0.32, (p[0] + k * 0.03, p[1] + k * 0.055, p[2] + 0.025 + (0.04 if k == 1 else 0)),
                           m.paper, rotation=(0, 90, 20), vertices=12, name="scroll")


def floor_globe(at, m):
    x, y = at
    A.cylinder(0.3, 0.04, (x, y, 0.02), m.wood, vertices=32, name="globe base")
    for k in range(3):
        a = math.radians(k * 120)
        A.box((0.05, 0.05, 0.75), (x + 0.18 * math.cos(a), y + 0.18 * math.sin(a), 0.4), m.wood,
              rotation=(math.degrees(0.25) * math.sin(a), -math.degrees(0.25) * math.cos(a), 0), name="globe leg")
    torus(0.42, 0.03, (x, y, 0.8), m.wood, segs=40, name="globe horizon")
    g = A.sphere(0.36, (x, y, 0.82), m.globe, segments=48, name="floor globe")
    g.rotation_euler = (math.radians(23), 0, math.radians(110))
    torus(0.385, 0.012, (x, y, 0.82), m.brass, rotation=(90, 23, 70), segs=48, minor_segs=6, name="meridian")


def candle(wax, flames, coll, base, h, r=0.03, tilt=(0, 0), power=3.5, flame=1.0):
    wax.prism(base, r, h, segs=10, rot=(tilt[0], tilt[1], 0))
    m = Euler((math.radians(tilt[0]), math.radians(tilt[1]), 0)).to_matrix()
    top = Vector(base) + m @ Vector((0, 0, h))
    flames.teardrop((top.x, top.y, top.z + 0.008), 0.014 * flame, 0.06 * flame, segs=8, rings=5)
    point((top.x, top.y, top.z + 0.035), CANDLE, power, radius=0.015, coll=coll, name="candle")


CHANDELIERS = [(0.0, 3.2, 6.7), (0.0, -3.6, 6.7)]


def build_candles(m):
    candles = A.layer("candles")
    wax, flames = Acc(), Acc()
    iron = Acc()
    for cx, cy, cz in CHANDELIERS:
        torus(1.05, 0.04, (cx, cy, cz), m.iron, segs=64, name="candle ring")
        torus(0.45, 0.03, (cx, cy, cz), m.iron, segs=48, name="candle ring")
        for k in range(6):
            a = math.pi * k / 3
            iron.box((cx + 0.75 * math.cos(a), cy + 0.75 * math.sin(a), cz), (0.6, 0.03, 0.03), rot=(0, 0, math.degrees(a)))
        for k in range(4):
            a = math.pi * k / 2 + math.pi / 4
            p0 = Vector((cx + 1.0 * math.cos(a), cy + 1.0 * math.sin(a), cz))
            p1 = Vector((cx, cy, cz + 1.3))
            mid = (p0 + p1) / 2
            d = p1 - p0
            rot = d.to_track_quat("Z", "Y").to_euler()
            iron.box(tuple(mid), (0.015, 0.015, d.length), rot=tuple(math.degrees(v) for v in rot))
        iron.box((cx, cy, (cz + 1.3 + SPRING - 0.3) / 2), (0.03, 0.03, SPRING - 0.3 - cz - 1.3))
        for k in range(14):
            a = 2 * math.pi * (k + 0.5) / 14
            px, py = cx + 1.05 * math.cos(a), cy + 1.05 * math.sin(a)
            iron.prism((px, py, cz + 0.03), 0.04, 0.03, segs=8)
            candle(wax, flames, candles, (px, py, cz + 0.06), R.uniform(0.18, 0.26), r=0.026, power=5.0)
        point((cx, cy, cz + 0.4), CANDLE, 160, radius=0.9, coll=candles, glossy=False, name="ring glow")

    rng = random.Random(5)
    placed = []
    tries = 0
    while len(placed) < 72 and tries < 20000:
        tries += 1
        x, y, z = rng.uniform(-6.3, 6.3), rng.uniform(-6.0, 9.0), rng.uniform(4.9, 9.0)
        horiz = math.hypot(x, y)
        if y > 0 and abs(math.degrees(math.atan2(x, y))) < 32 and math.degrees(math.atan2(z - A.EYE_HEIGHT, horiz)) < 36:
            continue
        if any(math.hypot(x - cx, y - cy) < 1.5 and abs(z - cz) < 1.0 for cx, cy, cz in CHANDELIERS):
            continue
        if abs(x) > 4.6 and z < GAL_Z + 1.8:
            continue
        if horiz < 2.2:
            continue
        if any((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2 < 0.85 ** 2 for px, py, pz in placed):
            continue
        placed.append((x, y, z))
        candle(wax, flames, candles, (x, y, z), rng.uniform(0.14, 0.32), r=rng.uniform(0.026, 0.034),
               tilt=(rng.uniform(-4, 4), rng.uniform(-4, 4)), power=rng.uniform(3.0, 5.0), flame=1.4)
    wax.build("candles", m.wax, smooth=False)
    flames.build("candle flames", m.candle_flame, candles, smooth=True)
    iron.build("candle ring iron", m.iron)
    # The candles' collective warm glow, high in the hall.
    for x, y in ((-3.6, -1.5), (3.6, -1.5), (-3.6, 5.2), (3.6, 5.2), (0, 8.0)):
        point((x, y, 7.2), CANDLE, 650, radius=1.2, coll=candles, glossy=False, name="candle glow")
    print("FLOATING CANDLES", len(placed), flush=True)


def build_furniture(m):
    candles = A.layer("candles")
    runner = rug_image("runner", 7.2, 2.5,
                       [(0.085, 0.017, 0.014), (0.016, 0.02, 0.045), (0.15, 0.095, 0.032), (0.17, 0.135, 0.085)], 4)
    A.plane((2.5, 7.2), (0, 5.4, 0.006), image_material("runner", runner), name="runner")
    reading_table((-4.2, 5.6), 3.2, m, candles,
                  [("lamp", -0.9, 0.0), ("lamp", 0.9, 0.0), ("book", 0.0, -0.2), ("stack", -1.35, 0.25),
                   ("armillary", 1.35, 0.2), ("scrolls", 0.4, 0.3)])
    reading_table((4.2, 4.3), 3.2, m, candles,
                  [("lamp", -0.9, 0.0), ("lamp", 0.9, 0.0), ("book", -0.1, 0.2), ("globe", 1.3, -0.2),
                   ("stack", -1.3, -0.25), ("stack", 0.5, -0.3)])
    reading_table((4.0, -3.8), 3.2, m, candles,
                  [("lamp", -0.8, 0.0), ("lamp", 0.8, 0.0), ("book", 0.1, 0.0), ("stack", -1.3, 0.2),
                   ("stack", 1.3, -0.2)])
    floor_globe((-4.4, -4.6), m)
    A.plane((3.2, 4.6), (4.0, -3.8, 0.006), image_material(
        "back rug", rug_image("back rug", 4.6, 3.2,
                              [(0.02, 0.032, 0.026), (0.07, 0.02, 0.015), (0.14, 0.09, 0.034), (0.17, 0.135, 0.085)], 11)),
        name="back rug")


# ---------------------------------------------------------------- the viewer's chair


def wingback(coll, mats, at=(0.0, 0.0), yaw=0.0, nailheads=True):
    leather, wood, brass, dark = mats
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))

    def P(x, y, z):
        return (at[0] + x * c - y * s, at[1] + x * s + y * c, z)

    def rot(rx=0, ry=0, rz=0):
        return (rx, ry, rz + yaw)

    parts = []

    def bx(size, loc, mat, r=(0, 0, 0), bevel=0.0, name="chair"):
        obj = A.box(size, P(*loc), mat, coll, rotation=rot(*r), bevel=bevel, name=name)
        parts.append(obj)
        return obj

    def cy(radius, depth, loc, mat, r=(0, 0, 0), vertices=24, name="chair"):
        obj = A.cylinder(radius, depth, P(*loc), mat, coll, rotation=rot(*r), vertices=vertices, name=name)
        crisp(obj)
        parts.append(obj)
        return obj

    soften(bx((0.84, 0.76, 0.27), (0, -0.03, 0.255), leather, bevel=0.035, name="chair base"))
    soften(bx((0.6, 0.62, 0.12), (0, 0.02, 0.4), leather, bevel=0.045, name="seat cushion"))
    soften(bx((0.8, 0.2, 0.9), (0, -0.37, 0.82), leather, r=(-8, 0, 0), bevel=0.07, name="chair back"))
    soften(bx((0.58, 0.12, 0.62), (0, -0.25, 0.77), leather, r=(-8, 0, 0), bevel=0.05, name="back cushion"))
    cy(0.1, 0.8, (0, -0.43, 1.25), leather, r=(0, 90, 0), vertices=24, name="back crest")
    for side in (-1, 1):
        soften(bx((0.12, 0.4, 0.55), (side * 0.37, -0.18, 0.98), leather, r=(0, 0, side * 9), bevel=0.05, name="wing"))
        cy(0.06, 0.55, (side * 0.4, 0.01, 0.98), leather, vertices=20, name="wing edge")
        soften(bx((0.14, 0.72, 0.24), (side * 0.37, -0.03, 0.5), leather, bevel=0.04, name="arm"))
        cy(0.085, 0.74, (side * 0.39, -0.02, 0.63), leather, r=(90, 0, 0), vertices=24, name="arm roll")
        cy(0.092, 0.03, (side * 0.39, 0.345, 0.62), dark, r=(90, 0, 0), vertices=24, name="arm scroll")
    for x in (-0.34, 0.34):
        for y in (-0.36, 0.28):
            cy(0.032, 0.1, (x, y, 0.07), wood, vertices=12, name="foot")
            cy(0.036, 0.02, (x, y, 0.005), brass, vertices=12, name="castor")
    if nailheads:
        row = A.sphere(0.009, P(-0.4, 0.355, 0.155), brass, coll, segments=8, name="nailheads")
        A.array(row, 27, (0.8 / 26 * c, 0.8 / 26 * s, 0))
        parts.append(row)
        for side in (-1, 1):
            col = A.sphere(0.009, P(side * 0.39, 0.358, 0.535), brass, coll, segments=8, name="nailheads")
            A.array(col, 9, (0, 0, -0.04))
            parts.append(col)
        # Buttons on the back cushion, in a diamond pattern.
        for k, z in enumerate((0.6, 0.73, 0.86, 0.99)):
            n = 3 if k % 2 == 0 else 2
            x0 = -0.16 if n == 3 else -0.08
            y = -0.18 - (z - 0.5) * math.tan(math.radians(8))
            but = A.sphere(0.014, P(x0, y, z), dark, coll, segments=8, name="buttons")
            A.array(but, n, (0.16 * c, 0.16 * s, 0))
            parts.append(but)
    return parts


def build_seat(m):
    seat = "seat"
    # A round rug in concentric bands.
    bands = [
        (1.5, (0.03, 0.036, 0.075), 0.010),
        (1.44, (0.27, 0.17, 0.06), 0.012),
        (1.36, (0.028, 0.034, 0.07), 0.014),
        (1.12, (0.25, 0.16, 0.055), 0.016),
        (1.08, (0.15, 0.03, 0.024), 0.018),
        (0.62, (0.03, 0.036, 0.075), 0.020),
        (0.56, (0.27, 0.17, 0.06), 0.021),
        (0.5, (0.15, 0.03, 0.024), 0.022),
    ]
    for i, (radius, color, height) in enumerate(bands):
        mat = A.material(f"rug band {i}", color, roughness=0.95, sheen=0.6)
        crisp(A.cylinder(radius, height, (0, 0.05, height / 2), mat, coll=seat, vertices=72, name="rug"))
    wingback(seat, (m.leather, m.wood, m.brass, m.leather_dark))
    # A small side table with a stack of books and a candlestick.
    tx, ty = 0.74, 0.12
    crisp(A.cylinder(0.24, 0.03, (tx, ty, 0.575), m.wood, coll=seat, vertices=40, name="side table"))
    crisp(A.cylinder(0.22, 0.04, (tx, ty, 0.54), m.wood, coll=seat, vertices=40, name="side table apron"))
    crisp(A.cylinder(0.035, 0.5, (tx, ty, 0.28), m.wood, coll=seat, vertices=16, name="side table post"))
    for k in range(3):
        a = math.radians(90 + k * 120)
        A.box((0.05, 0.24, 0.04), (tx + 0.11 * math.cos(a), ty + 0.11 * math.sin(a), 0.035), m.wood, coll=seat,
              rotation=(0, 0, math.degrees(a) - 90), bevel=0.012, name="side table leg")
    z = 0.59
    rng = random.Random(2)
    for color, (w, d, t) in zip((m.green_leather, m.leather, m.tan_leather),
                                ((0.24, 0.17, 0.045), (0.21, 0.15, 0.035), (0.17, 0.12, 0.03))):
        yaw = rng.uniform(-20, 20)
        A.box((w, d, t), (tx - 0.04, ty + 0.03, z + t / 2), color, coll=seat, rotation=(0, 0, yaw), bevel=0.004,
              name="book")
        A.box((w - 0.014, d - 0.016, t - 0.01), (tx - 0.034, ty + 0.03, z + t / 2), m.paper, coll=seat,
              rotation=(0, 0, yaw), name="pages")
        z += t
    cx, cy_ = tx + 0.12, ty - 0.1
    crisp(A.cylinder(0.05, 0.012, (cx, cy_, 0.596), m.brass, coll=seat, vertices=24, name="candlestick"))
    crisp(A.cylinder(0.011, 0.12, (cx, cy_, 0.66), m.brass, coll=seat, vertices=12, name="candlestick"))
    crisp(A.cylinder(0.03, 0.01, (cx, cy_, 0.72), m.brass, coll=seat, vertices=20, name="candlestick"))
    crisp(A.cylinder(0.014, 0.09, (cx, cy_, 0.77), m.wax, coll=seat, vertices=12, name="candle"))


# ---------------------------------------------------------------- build


def build():
    A.world((0.0015, 0.0018, 0.003))
    m = materials()
    m.globe = image_material("globe", globe_image(), roughness=0.45, sheen=0.0)
    profile = vault_profile()
    build_shell(m, profile)
    build_piers(m)
    build_shelves(m)
    build_window(m)
    build_fireplace(m)
    build_frame(m)
    build_door(m)
    build_furniture(m)
    build_candles(m)
    build_seat(m)
