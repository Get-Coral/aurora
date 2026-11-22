"""
Renders one Quest theater environment with Blender (Cycles).

    blender -b --factory-startup -P scripts/quest/blender/render_env.py -- grand_theater
    blender -b --factory-startup -P scripts/quest/blender/render_env.py -- grand_theater --preview

Builds the scene from env_<name>.py, then:
- renders the room with every light layer off (base.png),
- renders it once more per light layer with only that layer on
  (<layer>.png), for compose.py to turn into additive light layers,
- exports the viewer's seat (the "seat" collection) as a glTF model.

Renders go to .context/renders/<name>/; the seat goes straight into the app's
assets. Then run scripts/quest/compose.py <name>.
"""

import importlib
import sys
import time
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))

import aurora_scene as A  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
name = args[0]
preview = "--preview" in args
only = next((a.split("=", 1)[1] for a in args if a.startswith("--only=")), None)
seat_only = "--seat-only" in args

scene = A.reset()
A.panorama_camera()
env = importlib.import_module(f"env_{name}")
env.build()

if preview:
    scene.render.resolution_x, scene.render.resolution_y = 1536, 768
    scene.cycles.samples = 24
else:
    scene.render.resolution_x, scene.render.resolution_y = 4096, 2048
    scene.cycles.samples = getattr(env, "SAMPLES", 160)
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "16"

out = ROOT / ".context/renders" / name
out.mkdir(parents=True, exist_ok=True)

layers = [c for c in bpy.data.collections if c.name.startswith("layer:")]
seat = bpy.data.collections["seat"]


def render(label: str, enabled: set):
    for coll in layers:
        coll.hide_render = coll.name not in enabled
    seat.hide_render = True  # the seat is a 3D model in the app, not part of the sky
    scene.render.filepath = str(out / f"{label}.png")
    started = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {name}/{label} in {time.time() - started:.0f}s", flush=True)


if not seat_only:
    if only in (None, "base"):
        render("base", set())
    for coll in layers:
        label = coll.name.split(":", 1)[1]
        if only in (None, label):
            render(label, {coll.name})

if (not preview or seat_only) and seat.all_objects:
    target = ROOT / "android/app/src/quest/assets/theater" / f"{name}.glb"
    target.parent.mkdir(parents=True, exist_ok=True)
    # Unhide first, in its own pass: changing visibility while selecting drops
    # the selection, and the export would miss most of the seat.
    seat.hide_render = False
    for obj in seat.all_objects:
        obj.hide_render = False
        obj.hide_set(False)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in seat.all_objects:
        obj.select_set(True)
    print(f"EXPORTING {len(seat.all_objects)} seat objects", flush=True)
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
    )
    print(f"EXPORTED seat {target}", flush=True)
