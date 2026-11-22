"""
Turns an environment's Blender renders into what the Quest theater loads.

    .venv/bin/python scripts/quest/compose.py grand_theater

Reads .context/renders/<name>/ (base.png plus one <layer>.png per light
layer, from blender/render_env.py) and writes into
android/app/src/quest/res/drawable-nodpi/:
- theater_<name>.jpg: the room with every light layer off, the sky the app
  shows as is,
- theater_<name>_<layer>.jpg: what that layer's lights add, drawn on top
  additively, so the app can dim, flicker or pulse each layer on its own,
- theater_<name>_thumb.jpg: the picker's preview, lights up
  (--look-up=<degrees> tilts it towards the sky).
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "android/app/src/quest/res/drawable-nodpi"
LAYER_SIZE = (4096, 2048)


def load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255


def save(array: np.ndarray, path: Path, size=None, quality=88):
    image = Image.fromarray((np.clip(array, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size and image.size != size:
        image = image.resize(size, Image.LANCZOS)
    image.save(path, quality=quality, optimize=True)
    print(path.name, image.size, path.stat().st_size // 1024, "KB")


def thumbnail(panorama: np.ndarray, look_up: float = 0.0) -> np.ndarray:
    """The view ahead (the screen and around it), 16:9, tilted `look_up` degrees."""
    h, w, _ = panorama.shape
    crop_w = w * 70 // 360  # 70° wide
    crop_h = crop_w * 9 // 16
    top = h // 2 - crop_h // 2 - h // 40 - int(look_up / 180 * h)
    left = w // 2 - crop_w // 2
    return panorama[top : top + crop_h, left : left + crop_w]


def main(name: str, look_up: float = 0.0):
    src = ROOT / ".context/renders" / name
    base_image = Image.open(src / "base.png").convert("RGB")
    base = np.asarray(base_image, dtype=np.float64) / 255
    lit = None
    for path in sorted(src.glob("*.png")):
        if path.stem == "base":
            continue
        full = load(path)
        # Layers render at a lower resolution than the room; compare like with like.
        h, w, _ = full.shape
        base_at_layer = np.asarray(base_image.resize((w, h), Image.LANCZOS), dtype=np.float64) / 255
        # The layer's own light, as it adds up on screen. Tiny differences
        # are denoiser noise between the two renders, not light.
        added = np.clip(full - base_at_layer, 0, 1)
        added[added < 2.5 / 255] = 0
        save(added, OUT / f"theater_{name}_{path.stem}.jpg", LAYER_SIZE)
        lit = (base_at_layer if lit is None else lit) + added
    save(base, OUT / f"theater_{name}.jpg", quality=86)
    lit = np.clip(base if lit is None else lit, 0, 1)
    thumb = Image.fromarray((thumbnail(lit, look_up) * 255).astype(np.uint8)).resize((480, 270), Image.LANCZOS)
    thumb.save(OUT / f"theater_{name}_thumb.jpg", quality=88)


if __name__ == "__main__":
    # Optional: --look-up=<degrees>, for a thumbnail that shows more of the sky.
    look = next((float(a.split("=", 1)[1]) for a in sys.argv[2:] if a.startswith("--look-up=")), 0.0)
    main(sys.argv[1], look)
