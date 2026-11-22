"""
Helpers for building the Quest theater environments in Blender, entirely from
code. Each environment module (env_*.py) builds its scene with these and
says which objects belong to which light layer and to the viewer's seat.

Conventions (Blender, Z up, metres):
- The viewer's eyes are at (0, 0, EYE_HEIGHT), looking along +Y.
- The film plays on a panel that, seen from there, spans SCREEN_* angles.
  Environments frame that area (a cinema screen, a window, a display wall).
- Collections:
  - "base": everything always present (lights-off state of the room).
  - "layer:<name>": a light layer (lights + glowing objects), rendered
    separately so the app can dim, flicker or pulse it on its own.
  - "seat": the viewer's own seat and the floor around it. Exported as a
    glTF model and placed in 3D in the app, not baked into the panorama.
"""

import math

import bpy

EYE_HEIGHT = 1.15  # seated
# The video panel in the app: 4.8 x 2.7 m, centre 1.6 m high, 5 m away.
SCREEN_HALF_WIDTH_DEG = math.degrees(math.atan(2.4 / 5))
SCREEN_TOP_DEG = math.degrees(math.atan((1.6 + 1.35 - EYE_HEIGHT) / 5))
SCREEN_BOTTOM_DEG = math.degrees(math.atan((1.6 - 1.35 - EYE_HEIGHT) / 5))


def screen_rect(distance: float, margin: float = 1.0):
    """Where the film's panel falls on a wall `distance` metres ahead:
    (half_width, bottom_z, top_z) in world units, scaled by `margin`."""
    half = distance * math.tan(math.radians(SCREEN_HALF_WIDTH_DEG)) * margin
    centre = (SCREEN_TOP_DEG + SCREEN_BOTTOM_DEG) / 2
    half_h = (SCREEN_TOP_DEG - SCREEN_BOTTOM_DEG) / 2 * margin
    bottom = EYE_HEIGHT + distance * math.tan(math.radians(centre - half_h))
    top = EYE_HEIGHT + distance * math.tan(math.radians(centre + half_h))
    return half, bottom, top


# ---- Scene ----


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = "GPU"
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 6
    scene.cycles.seed = 7
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    for name in ("base", "seat"):
        collection(name)
    return scene


def collection(name: str):
    existing = bpy.data.collections.get(name)
    if existing:
        return existing
    created = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(created)
    return created


def layer(name: str):
    return collection(f"layer:{name}")


def panorama_camera():
    data = bpy.data.cameras.new("viewer")
    data.type = "PANO"
    data.panorama_type = "EQUIRECTANGULAR"
    camera = bpy.data.objects.new("viewer", data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = (0, 0, EYE_HEIGHT)
    camera.rotation_euler = (math.radians(90), 0, 0)  # look along +Y
    bpy.context.scene.camera = camera
    return camera


def world(color=(0.0, 0.0, 0.0), strength=1.0, shader=None):
    """A plain world colour, or a node builder `shader(nodes, links) -> output socket`."""
    w = bpy.data.worlds.new("world")
    bpy.context.scene.world = w
    w.use_nodes = True
    nodes, links = w.node_tree.nodes, w.node_tree.links
    background = nodes["Background"]
    if shader:
        links.new(shader(nodes, links), background.inputs["Color"])
    else:
        background.inputs["Color"].default_value = (*color, 1)
    background.inputs["Strength"].default_value = strength
    return w


# ---- Materials ----


def material(name, color, roughness=0.6, metallic=0.0, sheen=0.0, coat=0.0, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Sheen Weight"].default_value = sheen
    bsdf.inputs["Coat Weight"].default_value = coat
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def emissive(name, color, strength):
    """A pure light-giving surface (a lamp shade, a glowing plant, a hologram)."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    emit.inputs["Strength"].default_value = strength
    links.new(emit.outputs[0], out.inputs[0])
    return mat


def textured(name, builder, roughness=0.6, metallic=0.0, sheen=0.0, bump=None):
    """A material whose colour comes from `builder(nodes, links, coord) -> colour socket`,
    with object-space coordinates, and an optional `bump(nodes, links, coord) -> height socket`."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    links.new(builder(nodes, links, coord), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Sheen Weight"].default_value = sheen
    if bump:
        b = nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = 0.4
        links.new(bump(nodes, links, coord), b.inputs["Height"])
        links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# ---- Objects ----


def _place(obj, coll, mat, location, rotation):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    (coll if not isinstance(coll, str) else collection(coll)).objects.link(obj)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


def box(size, location, mat=None, coll="base", rotation=(0, 0, 0), bevel=0.0, name="box"):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    return _place(obj, coll, mat, location, rotation)


def cylinder(radius, depth, location, mat=None, coll="base", rotation=(0, 0, 0), vertices=32, name="cyl"):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return _place(obj, coll, mat, location, rotation)


def sphere(radius, location, mat=None, coll="base", name="sphere", segments=32):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=segments, ring_count=segments // 2)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return _place(obj, coll, mat, location, (0, 0, 0))


def plane(size, location, mat=None, coll="base", rotation=(0, 0, 0), name="plane"):
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(scale=True)
    return _place(obj, coll, mat, location, rotation)


def array(obj, count, offset, count2=0, offset2=None):
    """Repeat an object along one (or two) offsets, without extra objects."""
    mod = obj.modifiers.new("array", "ARRAY")
    mod.count = count
    mod.use_relative_offset = False
    mod.use_constant_offset = True
    mod.constant_offset_displace = offset
    if count2:
        mod2 = obj.modifiers.new("array2", "ARRAY")
        mod2.count = count2
        mod2.use_relative_offset = False
        mod2.use_constant_offset = True
        mod2.constant_offset_displace = offset2
    return obj


def point_light(location, color, power, radius=0.1, coll="base", name="light"):
    data = bpy.data.lights.new(name, "POINT")
    data.color = color
    data.energy = power
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    (collection(coll) if isinstance(coll, str) else coll).objects.link(obj)
    obj.location = location
    return obj


def area_light(size, location, rotation, color, power, coll="base", name="area"):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = size
    data.color = color
    data.energy = power
    obj = bpy.data.objects.new(name, data)
    (collection(coll) if isinstance(coll, str) else coll).objects.link(obj)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    return obj


def curtain(width, height, location, mat, coll="base", folds=14, depth=0.18, rotation=(90, 0, 0)):
    """A hanging velvet curtain: a grid rippled into soft vertical folds.

    Built flat in XY (height along Y) and stood up by `rotation`."""
    import bmesh

    mesh = bpy.data.meshes.new("curtain")
    bm = bmesh.new()
    cols, rows = folds * 12, 12
    verts = []
    for j in range(rows + 1):
        y = (j / rows - 0.5) * height
        row = []
        for i in range(cols + 1):
            x = (i / cols - 0.5) * width
            phase = 2 * math.pi * folds * i / cols
            # Deeper folds towards the floor, where the fabric gathers.
            z = depth * (0.6 + 0.4 * (0.5 - y / height)) * math.sin(phase + 0.6 * math.sin(phase / 3))
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("curtain", mesh)
    bpy.context.scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return _place(obj, coll, mat, location, rotation)
