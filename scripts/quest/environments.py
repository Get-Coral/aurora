"""
Paints the 360° skies of the Quest theater as equirectangular images.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow
    .venv/bin/python scripts/quest/environments.py

Writes into android/app/src/quest/res/drawable-nodpi/ (plus a small
thumbnail of each for the environment picker, *_thumb.jpg):
- theater_aurora.jpg: a night sky with the northern lights over dark
  mountains, mirrored in a still lake. Aurora's own, made from noise and
  maths here, so there are no third-party assets to license.
- theater_dark.jpg: a dark, almost black room for watching without
  distractions.

The output is deterministic (fixed seed), so running it again gives the same
files.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

WIDTH, HEIGHT = 4096, 2048
OUT = Path(__file__).resolve().parents[2] / "android/app/src/quest/res/drawable-nodpi"
rng = np.random.default_rng(20261122)


def smooth_noise_1d(n: int, octaves: int, base_freq: int, persistence: float = 0.5) -> np.ndarray:
    """Periodic fractal noise over n samples (wraps around the horizon)."""
    x = np.arange(n) / n
    total = np.zeros(n)
    amp, freq, norm = 1.0, base_freq, 0.0
    for _ in range(octaves):
        phases = rng.uniform(0, 2 * np.pi, 3)
        layer = sum(np.sin(2 * np.pi * (freq * k) * x + p) / k for k, p in zip((1, 2, 3), phases))
        total += amp * layer
        norm += amp * (1 + 1 / 2 + 1 / 3)
        amp *= persistence
        freq *= 2
    return total / norm


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return a * (1 - t) + b * t


def hex_rgb(value: str) -> np.ndarray:
    value = value.lstrip("#")
    return np.array([int(value[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255


def paint_sky(width: int, height: int) -> np.ndarray:
    """Upper hemisphere only: rows 0..height-1 run from the zenith to the horizon."""
    elevation = np.linspace(90, 0, height)[:, None] * np.ones((1, width))  # degrees
    azimuth = np.linspace(0, 1, width, endpoint=False)[None, :] * np.ones((height, 1))

    # Night gradient: deep navy overhead, a little teal glow at the horizon.
    sky = mix(hex_rgb("#0b1830"), hex_rgb("#03050f"), (elevation / 90) ** 0.6)

    # Stars, uniform over the sphere: equal-area sampling of the elevation.
    stars = np.zeros((height, width))
    count = 9000
    sin_el = rng.uniform(0, 1, count)
    rows = ((1 - np.degrees(np.arcsin(sin_el)) / 90) * (height - 1)).astype(int)
    cols = rng.integers(0, width, count)
    stars[rows, cols] = rng.pareto(2.2, count).clip(0, 6) * 0.35 + 0.15
    star_img = Image.fromarray((np.clip(stars, 0, 1) * 255).astype(np.uint8))
    stars = np.asarray(star_img.filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float64) / 255 * 3
    twinkle = hex_rgb("#dfe8ff")
    sky += stars[..., None] * twinkle * (0.35 + 0.65 * (elevation[..., None] / 90))

    # The northern lights: a few curtains, each a wavy lower edge with light
    # fading upward, split into rays and shifting from green to violet.
    aurora = np.zeros((height, width, 3))
    green, teal, violet = hex_rgb("#45ffa8"), hex_rgb("#2fd6c8"), hex_rgb("#9a5cff")
    for base, amplitude, strength in ((26, 8, 1.0), (40, 6, 0.6), (18, 5, 0.4)):
        # Folded curtains: the lower edge sways at several scales.
        edge = base + amplitude * smooth_noise_1d(width, 5, 2, 0.6)
        presence = np.clip(smooth_noise_1d(width, 3, 1) * 1.6 + 0.45, 0, 1) ** 1.5
        rays = 0.78 + 0.22 * np.clip(smooth_noise_1d(width, 4, 24, 0.6) * 2.0, -1, 1)
        above = elevation - edge[None, :]
        onset = np.clip(above / 2.5 + 1, 0, 1) ** 1.5  # a soft lower edge
        falloff = np.exp(-np.clip(above, 0, None) / 11)
        glow = onset * falloff * (presence * rays * strength)[None, :]
        height_t = np.clip(above / 30, 0, 1)
        colour = mix(mix(green[None, None, :] * np.ones((height, width, 1)), teal, height_t * 1.4), violet, (height_t - 0.35) * 1.6)
        aurora += colour * glow[..., None]
    # Soften the rays so the curtains read as light, not stripes.
    aurora_img = Image.fromarray((np.clip(aurora, 0, 1) * 255).astype(np.uint8))
    aurora = np.asarray(aurora_img.filter(ImageFilter.GaussianBlur(4)), dtype=np.float64) / 255
    sky += aurora * 0.95

    # Dark mountains along the horizon, with a faint rim of aurora light.
    # Ridged noise gives peaks rather than rolling hills; a second, paler
    # range behind adds depth.
    def range_profile(low, high, freq):
        ridged = 1 - np.abs(smooth_noise_1d(width, 6, freq, 0.55))
        return low + (high - low) * ridged**3

    far = range_profile(2.5, 9.5, 3)
    near = range_profile(1.0, 6.0, 5)
    far_mask = elevation < far[None, :]
    sky[far_mask] = mix(sky[far_mask], hex_rgb("#0a1220"), 0.85)
    near_mask = elevation < near[None, :]
    shade = np.clip(elevation / np.maximum(near[None, :], 1e-3), 0, 1)
    sky[near_mask] = mix(hex_rgb("#03050a")[None, :] * np.ones((near_mask.sum(), 1)), hex_rgb("#070c16"), shade[near_mask])
    rim = np.exp(-np.abs(elevation - far[None, :]) / 0.35) * far_mask
    sky += rim[..., None] * hex_rgb("#1d4a44") * 0.5
    ridge = far
    return np.clip(sky, 0, 1), ridge


def paint_aurora() -> Image.Image:
    half = HEIGHT // 2
    sky, _ = paint_sky(WIDTH, half)

    # The lake mirrors the sky, darker, with a slight ripple and fading into
    # black below the viewer.
    rows = np.arange(half)
    ripple = (smooth_noise_1d(half, 4, 30) * 1.5).astype(int)
    mirror_rows = np.clip(half - 1 - rows + ripple, 0, half - 1)
    lake = sky[mirror_rows, :, :]
    lake = np.asarray(
        Image.fromarray((lake * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2)),
        dtype=np.float64,
    ) / 255
    depth = rows / half
    lake *= (0.42 * np.exp(-depth * 3.2))[:, None, None]
    lake += hex_rgb("#010204")

    image = np.concatenate([sky, lake], axis=0)
    return Image.fromarray((np.clip(image, 0, 1) ** (1 / 1.1) * 255).astype(np.uint8))


def paint_dark() -> Image.Image:
    width, height = 2048, 1024
    t = np.linspace(0, 1, height)[:, None, None]
    top, horizon, floor = hex_rgb("#08090e"), hex_rgb("#11131c"), hex_rgb("#030304")
    upper = top * (1 - t * 2) + horizon * (t * 2)
    lower = horizon * (2 - t * 2) + floor * (t * 2 - 1)
    image = np.where(t < 0.5, upper, lower) * np.ones((1, width, 1))
    # A touch of noise so the gradient doesn't band in the headset.
    image += rng.normal(0, 0.004, image.shape)
    return Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8))


def thumbnail(panorama: Image.Image) -> Image.Image:
    """A 16:9 slice around the horizon, as the picker shows it."""
    w, h = panorama.size
    crop_w = w // 3
    crop_h = crop_w * 9 // 16
    top = h // 2 - crop_h * 2 // 3
    # The brightest third of the horizon, so the picker shows the best of it.
    best = max(range(0, w - crop_w, w // 24), key=lambda x: sum(panorama.crop((x, top, x + crop_w, top + crop_h)).convert("L").resize((16, 9)).tobytes()))
    return panorama.crop((best, top, best + crop_w, top + crop_h)).resize((480, 270), Image.LANCZOS)


def paint_passthrough_thumb() -> Image.Image:
    """No panorama: a soft, warm 'your room' card for the picker."""
    width, height = 480, 270
    y, x = np.mgrid[0:height, 0:width] / np.array([height, width])[:, None, None]
    glow = np.exp(-(((x - 0.5) / 0.55) ** 2 + ((y - 0.45) / 0.6) ** 2))
    image = mix(hex_rgb("#141a2a")[None, None, :] * np.ones((height, width, 1)), hex_rgb("#c9a27a"), glow * 0.55)
    # A window frame suggests a real room around the screen.
    frame = ((np.abs(x - 0.5) < 0.22) & (np.abs(y - 0.42) < 0.24)) & ~((np.abs(x - 0.5) < 0.205) & (np.abs(y - 0.42) < 0.215))
    image[frame] = mix(image[frame], hex_rgb("#f2e6d4"), 0.6)
    return Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8))


def with_screen(card: Image.Image) -> Image.Image:
    """Puts a glowing screen on a card, so a near-black room still reads as a cinema."""
    width, height = card.size
    image = np.asarray(card, dtype=np.float64) / 255
    y, x = np.mgrid[0:height, 0:width] / np.array([height, width])[:, None, None]
    inside = (np.abs(x - 0.5) < 0.26) & (np.abs(y - 0.42) < 0.16)
    halo = np.exp(-(np.clip(np.abs(x - 0.5) - 0.26, 0, None) ** 2 + np.clip(np.abs(y - 0.42) - 0.16, 0, None) ** 2) / 0.004)
    image = image + halo[..., None] * hex_rgb("#70a8ff") * 0.18
    image[inside] = mix(hex_rgb("#1b2a48")[None, :] * np.ones((inside.sum(), 1)), hex_rgb("#8fd1ff"), (0.6 - y[inside]) * 0.8)
    return Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    aurora, dark = paint_aurora(), paint_dark()
    aurora.save(OUT / "theater_aurora.jpg", quality=88, optimize=True)
    dark.save(OUT / "theater_dark.jpg", quality=90, optimize=True)
    thumbnail(aurora).save(OUT / "theater_aurora_thumb.jpg", quality=88)
    with_screen(thumbnail(dark)).save(OUT / "theater_dark_thumb.jpg", quality=88)
    paint_passthrough_thumb().save(OUT / "theater_passthrough_thumb.jpg", quality=88)
    for path in sorted(OUT.glob("theater_*.jpg")):
        print(path.name, path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
