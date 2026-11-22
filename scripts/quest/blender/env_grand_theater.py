"""
Grand Theater: a classic, luxurious cinema seen from a raised VIP row.

Dark red velvet, warm wall sconces and gold trim, a star-dotted ceiling, the
screen framed by curtains, and raked stalls stepping down towards it. The
viewer has a velvet armchair of their own behind a low brass rail, with the
projection booth's window glowing behind them.

Light layers:
- house: the sconces and the cove light along the ceiling. Up while the
  film isn't playing, almost out while it plays.
The star ceiling and the aisle lights belong to the base: a cinema keeps
those on during the film.
"""

import math

import aurora_scene as A

SAMPLES = 192

WALL_X = 13.0
BACK_Y = -3.4
SCREEN_Y = 16.2
CEILING_Z = 9.0
STALLS_TOP_Z = -0.6
STALLS_RAKE = 0.24  # each row steps down this much towards the screen
STAGE_Z = -3.2

WARM = (1.0, 0.72, 0.45)


def velvet_wall(nodes, links, coord):
    """Deep red velvet in soft vertical pleats."""
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.inputs["Scale"].default_value = 3.0
    wave.inputs["Distortion"].default_value = 0.6
    links.new(coord, wave.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.045, 0.004, 0.007, 1)
    ramp.color_ramp.elements[1].color = (0.1, 0.009, 0.014, 1)
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    return ramp.outputs["Color"]


def build():
    A.world((0.0005, 0.0005, 0.001))

    velvet = A.textured("velvet", velvet_wall, roughness=0.85, sheen=0.6)
    seat_velvet = A.material("seat velvet", (0.13, 0.01, 0.016), roughness=0.8, sheen=0.8)
    gold = A.material("gold", (0.72, 0.52, 0.22), roughness=0.35, metallic=1.0)
    dark_gold = A.material("dark gold", (0.35, 0.24, 0.1), roughness=0.5, metallic=1.0)
    carpet = A.material("carpet", (0.03, 0.005, 0.008), roughness=0.95)
    black = A.material("masking", (0.004, 0.004, 0.004), roughness=0.95)
    screen = A.material("screen", (0.03, 0.03, 0.032), roughness=0.9)
    cream = A.material("plaster", (0.2, 0.15, 0.1), roughness=0.7)
    ceiling = star_ceiling_material()

    # ---- The room ----
    depth = SCREEN_Y - BACK_Y
    mid_y = (SCREEN_Y + BACK_Y) / 2
    floor_z = STAGE_Z - 1.0
    height = CEILING_Z - floor_z
    mid_z = (CEILING_Z + floor_z) / 2
    for side in (-1, 1):
        A.box((0.2, depth, height), (side * WALL_X, mid_y, mid_z), velvet, name="side wall")
    A.box((2 * WALL_X, 0.2, height), (0, BACK_Y, mid_z), velvet, name="back wall")
    A.box((2 * WALL_X, depth, 0.2), (0, mid_y, CEILING_Z), ceiling, name="ceiling")

    # Gold pilasters along the side walls, each with two sconces (house lights).
    for side in (-1, 1):
        y = BACK_Y + 1.6
        while y < SCREEN_Y - 1.5:
            A.box((0.25, 0.55, height), (side * (WALL_X - 0.12), y, mid_z), cream, name="pilaster")
            A.box((0.3, 0.65, 0.18), (side * (WALL_X - 0.12), y, CEILING_Z - 0.6), gold, name="capital")
            for z in (3.6, 0.9):
                sconce(side * (WALL_X - 0.35), y, z, gold)
            y += 3.6
        # Cornice and the cove light above it.
        A.box((0.5, depth, 0.25), (side * (WALL_X - 0.25), mid_y, CEILING_Z - 0.9), gold, name="cornice")
        A.box((0.08, depth, 0.06), (side * (WALL_X - 0.5), mid_y, CEILING_Z - 0.72),
              A.emissive("cove", WARM, 6.0), coll=A.layer("house"), name="cove")
        A.area_light((depth, 0.3), (side * (WALL_X - 0.8), mid_y, CEILING_Z - 0.75), (0, 0, 0),
                     WARM, 500, coll=A.layer("house"), name="cove light")

    # ---- The stalls below: raked rows of seats ----
    seat_y = 2.6
    row = 0
    while seat_y < 13.0:
        z = STALLS_TOP_Z - row * STALLS_RAKE
        A.box((2 * WALL_X, 1.05, 3.0), (0, seat_y, z - 1.5), carpet, name="step")
        for x0, count in ((-11.2, 11), (-3.1, 11), (4.6, 11)):
            seat_row(x0, seat_y, z, count, seat_velvet, dark_gold)
        for x in (-3.8, 3.8):  # aisle step lights
            A.sphere(0.035, (x, seat_y - 0.48, z + 0.05), A.emissive("aisle", (1.0, 0.55, 0.3), 25), name="aisle")
        seat_y += 1.05
        row += 1
    A.box((2 * WALL_X, 4.0, 1.0), (0, 14.5, STAGE_Z - 0.5), carpet, name="front floor")

    # ---- The raised VIP row around the viewer ----
    A.box((2 * WALL_X, 3.4 - BACK_Y + 1.6, 3.0), (0, (BACK_Y + 1.6) / 2, -1.5), carpet, name="vip floor")
    A.box((2 * WALL_X, 0.08, 0.62), (0, 1.62, -0.31), velvet, name="vip front")
    rail(-WALL_X, WALL_X, gold, "base")
    for x0, x1 in ((-12.2, -2.6), (2.6, 12.2)):
        count = int((x1 - x0) / 0.8)
        seat_row(x0, 0.0, 0.0, count, seat_velvet, dark_gold, spacing=0.8)
        A.box((x1 - x0 + 0.6, 1.4, 0.3), ((x0 + x1) / 2, -1.5, 0.15), carpet, name="riser")
        seat_row(x0, -1.5, 0.3, count, seat_velvet, dark_gold, spacing=0.8)
    # The projection booth's little window, high in the back wall.
    A.box((1.6, 0.1, 0.7), (0, BACK_Y + 0.12, 5.2), A.emissive("booth", (0.75, 0.82, 1.0), 6.0), name="booth window")
    A.point_light((0, BACK_Y + 0.6, 5.2), (0.75, 0.82, 1.0), 120, radius=0.5, name="booth glow")

    # ---- The screen, its frame and curtains ----
    half, bottom, top = A.screen_rect(SCREEN_Y - 0.1, margin=1.02)
    A.box((2 * WALL_X, 0.3, height), (0, SCREEN_Y + 0.4, mid_z), black, name="screen wall")
    A.box((2 * half, 0.05, top - bottom), (0, SCREEN_Y, (top + bottom) / 2), screen, name="screen")
    border = 0.35
    for x in (-half - border / 2, half + border / 2):
        A.box((border, 0.1, top - bottom + 2 * border), (x, SCREEN_Y - 0.05, (top + bottom) / 2), black)
    for z in (bottom - border / 2, top + border / 2):
        A.box((2 * half + 2 * border, 0.1, border), (0, SCREEN_Y - 0.05, z), black)
    frame_w = half + border + 0.25
    for x in (-frame_w, frame_w):
        A.box((0.35, 0.4, top - STAGE_Z + 1), (x, SCREEN_Y - 0.3, (top + STAGE_Z) / 2), gold, name="proscenium")
    A.box((2 * frame_w + 0.35, 0.4, 0.4), (0, SCREEN_Y - 0.3, top + border + 0.6), gold, name="proscenium top")
    curtain_mat = A.material("curtain", (0.3, 0.02, 0.03), roughness=0.75, sheen=1.0)
    side_w = WALL_X - frame_w
    for side in (-1, 1):
        A.curtain(side_w, CEILING_Z - STAGE_Z, (side * (frame_w + side_w / 2 + 0.2), SCREEN_Y - 0.7, (CEILING_Z + STAGE_Z) / 2),
                  curtain_mat, folds=int(side_w * 2.2), depth=0.16)
    A.curtain(2 * WALL_X, CEILING_Z - top - border - 0.8, (0, SCREEN_Y - 0.9, (CEILING_Z + top + border + 0.8) / 2),
              curtain_mat, folds=40, depth=0.12)
    A.box((2 * WALL_X, 2.0, 0.6), (0, SCREEN_Y - 1.0, STAGE_Z + 0.3), A.material("stage", (0.05, 0.03, 0.02), roughness=0.5), name="stage")

    # A faint, cool spill from the screen: the room as it looks while a film plays.
    A.area_light((2 * half, top - bottom), (0, SCREEN_Y - 0.6, (top + bottom) / 2), (90, 0, 180),
                 (0.65, 0.72, 0.9), 5000, name="screen spill")
    # Recessed downlights in the ceiling, for the lights-up state.
    for x in (-7, 0, 7):
        for y in (0, 5, 10):
            A.cylinder(0.25, 0.04, (x, y, CEILING_Z - 0.11), A.emissive("downlight", WARM, 12.0),
                       coll=A.layer("house"), name="downlight")
            A.area_light((0.5, 0.5), (x, y, CEILING_Z - 0.15), (0, 0, 0), WARM, 420, coll=A.layer("house"), name="downlight")

    build_seat(seat_velvet, gold, carpet, velvet)


def star_ceiling_material():
    import bpy

    mat = bpy.data.materials.new("star ceiling")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.008, 0.01, 0.025, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    coord = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    voronoi = nodes.new("ShaderNodeTexVoronoi")
    voronoi.inputs["Scale"].default_value = 6.0
    voronoi.inputs["Randomness"].default_value = 1.0
    links.new(coord, voronoi.inputs["Vector"])
    # A star where a cell's point is very close; brightness varies per cell.
    near = nodes.new("ShaderNodeMath")
    near.operation = "LESS_THAN"
    near.inputs[1].default_value = 0.035
    links.new(voronoi.outputs["Distance"], near.inputs[0])
    level = nodes.new("ShaderNodeMath")
    level.operation = "MULTIPLY"
    links.new(near.outputs[0], level.inputs[0])
    links.new(voronoi.outputs["Color"], level.inputs[1])
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 30.0
    links.new(level.outputs[0], strength.inputs[0])
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.92, 0.8, 1)
    links.new(strength.outputs[0], bsdf.inputs["Emission Strength"])
    return mat


def sconce(x, y, z, gold):
    side = 1 if x > 0 else -1
    A.box((0.08, 0.22, 0.4), (x + side * 0.05, y, z), gold, name="sconce plate")
    shade = A.cylinder(0.11, 0.26, (x - side * 0.12, y, z + 0.1), A.emissive("sconce shade", WARM, 9.0),
                       coll=A.layer("house"), vertices=24, name="sconce shade")
    shade.scale = (1, 1, 1)
    A.point_light((x - side * 0.3, y, z + 0.15), WARM, 170, radius=0.12, coll=A.layer("house"), name="sconce")


def seat_row(x0, y, z, count, velvet, frame, spacing=0.62):
    """A row of cinema seats facing the screen, as one object per part with arrays."""
    parts = [
        A.box((0.52, 0.5, 0.14), (x0, y, z + 0.44), velvet, bevel=0.04, name="cushion"),
        A.box((0.54, 0.12, 0.62), (x0, y - 0.3, z + 0.78), velvet, rotation=(-8, 0, 0), bevel=0.04, name="back"),
        A.box((0.06, 0.5, 0.25), (x0 - 0.3, y, z + 0.5), frame, bevel=0.015, name="arm"),
    ]
    for part in parts:
        A.array(part, count, (spacing, 0, 0))
    return parts


RAIL_Y = 1.25
RAIL_Z = 0.62


def rail(x0, x1, gold, coll):
    """A low brass rail on posts at the edge of the VIP row."""
    width = x1 - x0
    cx = (x0 + x1) / 2
    A.cylinder(0.03, width, (cx, RAIL_Y, RAIL_Z), gold, coll=coll, rotation=(0, 90, 0), vertices=16, name="rail")
    x = x0 + 0.6
    while x < x1:
        A.cylinder(0.022, RAIL_Z, (x, RAIL_Y, RAIL_Z / 2), gold, coll=coll, vertices=12, name="rail post")
        x += 1.2


def build_seat(velvet, gold, carpet, wall_velvet):
    """The viewer's own armchair at the rail, and the carpet under it (a 3D model in the app)."""
    seat = "seat"
    A.cylinder(1.6, 0.02, (0, 0.05, 0.01), carpet, coll=seat, vertices=64, name="seat carpet")
    A.box((0.66, 0.6, 0.2), (0, -0.02, 0.43), velvet, coll=seat, bevel=0.06, name="armchair cushion")
    A.box((0.74, 0.66, 0.3), (0, -0.02, 0.2), velvet, coll=seat, bevel=0.03, name="armchair base")
    A.box((0.76, 0.2, 0.78), (0, -0.4, 0.82), velvet, coll=seat, rotation=(-10, 0, 0), bevel=0.07, name="armchair back")
    for side in (-1, 1):
        A.box((0.14, 0.66, 0.26), (side * 0.42, -0.02, 0.5), velvet, coll=seat, bevel=0.05, name="armrest")
        A.box((0.15, 0.6, 0.03), (side * 0.42, 0.0, 0.645), gold, coll=seat, bevel=0.01, name="armrest trim")
    for x in (-0.32, 0.32):
        for y in (-0.3, 0.26):
            A.cylinder(0.025, 0.06, (x, y, 0.03), gold, coll=seat, vertices=12, name="foot")
    # The stretch of rail right in front of the viewer, in 3D so it stays put.
    rail(-1.8, 1.8, gold, seat)
