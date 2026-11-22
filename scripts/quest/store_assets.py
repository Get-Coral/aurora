"""
The Meta Horizon Store listing images for Aurora Cinema, rendered from the
Quest theater's own environments.

    .context/tools/venv/bin/python scripts/quest/store_assets.py [--refresh] [--only NAME ...]

Needs numpy and Pillow (and ffmpeg to fetch film frames). Writes into store/horizon/images/:
- hero.png (3000x900), cover_landscape.png (2560x1440), cover_square.png
  (1440x1440), cover_portrait.png (1008x1440), mini_landscape.png (1080x360):
  the branded set, one design: the Grand Theater with its lights up, the
  title "Aurora Cinema" (and the Aurora mark) on the cinema screen;
- icon.png (512x512): public/logo512.png flattened onto its own background;
- logo.png: the wordmark on a transparent background;
- screenshot_<n>.png (2560x1440): first-person views from the seat, a film
  playing, one per environment;
- CREDITS.md: the film on each screenshot and its licence.

Inputs, read as they are when the script runs:
- the environments: android/app/src/quest/res/drawable-nodpi/theater_<env>.jpg
  (360° equirectangular, the room with its lights off) and
  theater_<env>_<layer>.jpg (each light layer, added on top), as
  scripts/quest/compose.py writes them;
- fonts: android/app/src/quest/res/font/{space_grotesk,manrope}.ttf;
- the icon: public/logo512.png; the Aurora mark is drawn from the path in
  public/aurora-mark.svg (repeated below);
- films: public domain and Creative Commons (CC BY) films on the public
  Jellyfin demo server (https://demo.jellyfin.org/stable, as
  scripts/store/screenshots.mjs uses): a film's backdrop image, or a frame
  of the film itself (taken from the server's stream with ffmpeg, which must
  then be on the PATH). They are fetched once into .context/store-cache/films/
  and read from there afterwards; --refresh fetches them again.

The geometry is the theater's (TheaterActivity.kt): the viewer's eye 1.15 m
up at the panorama's centre, looking down +Y (the panorama's centre column);
the film on a flat 4.8 x 2.7 m panel, its centre 1.6 m up and 5 m ahead; the
control bar 1.25 x 0.275 m, its centre 0.95 m up and 1.45 m ahead.
"""

import argparse
import json
import math
import re
import subprocess
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SKIES = ROOT / "android/app/src/quest/res/drawable-nodpi"
FONTS = ROOT / "android/app/src/quest/res/font"
OUT = ROOT / "store/horizon/images"
CACHE = ROOT / ".context/store-cache/films"

DEMO_SERVER = "https://demo.jellyfin.org/stable"

VOID = (5, 8, 22)
ACCENT = (112, 168, 255)
ACCENT_STRONG = (143, 209, 255)
INK = (245, 247, 255)

EYE = 1.15
SCREEN = dict(centre=(0.0, 5.0, 1.6 - EYE), size=(4.8, 2.7))
CONTROLS = dict(centre=(0.0, 1.45, 0.95 - EYE), size=(1.25, 0.275))

# Light layers as the theater sets them while a film plays (TheaterEnvironments.kt, "down").
FILM_LIGHTS = {
    "grand_theater": {"house": 0.04},
    "orbital_deck": {"deck": 0.05, "holo": 0.65},
    "sentinel_hq": {"room": 0.05, "displays": 0.55},
    "arcane_library": {"candles": 0.25, "fire": 0.7, "runes": 0.3},
    "biolume_grove": {"glow": 0.6, "motes": 0.5},
}

# Films from the demo server (its Name), with what CREDITS.md says about them. `at`: a
# frame from the film itself at that second (taken from the server's stream with ffmpeg);
# without it, the film's backdrop image.
CAMINANDES = "Blender Foundation / Pablo Vazquez, Beorn Leonard, Francesco Siddi; caminandes.com"
FILMS = {
    "llama_drama": dict(
        name="Caminandes: Llama Drama",
        credit=f"Caminandes: Llama Drama (2013), {CAMINANDES}",
        licence="Creative Commons Attribution 3.0 (CC BY 3.0)",
    ),
    "llama_drama_dawn": dict(
        name="Caminandes: Llama Drama",
        at=75,
        credit=f"Caminandes: Llama Drama (2013), {CAMINANDES}",
        licence="Creative Commons Attribution 3.0 (CC BY 3.0)",
    ),
    "llamigos_snow": dict(
        name="Caminandes: Llamigos",
        at=100,
        credit=f"Caminandes 3: Llamigos (2016), {CAMINANDES}",
        licence="Creative Commons Attribution 3.0 (CC BY 3.0)",
    ),
    "llamigos_ice": dict(
        name="Caminandes: Llamigos",
        at=20,
        credit=f"Caminandes 3: Llamigos (2016), {CAMINANDES}",
        licence="Creative Commons Attribution 3.0 (CC BY 3.0)",
    ),
    "jungle_book": dict(
        name="Jungle Book",
        credit="Jungle Book (1942), Alexander Korda Films",
        licence="Public domain (United States)",
        # The backdrop has a glitch near the bottom edge: frame a little tighter, higher.
        zoom=(1.2, 0.5, 0.4),
    ),
    "train_robbery": dict(
        name="The Great Train Robbery",
        credit="The Great Train Robbery (1903), Edison Studios",
        licence="Public domain",
    ),
}

# One screenshot per environment, first-person from the seat, a film playing.
# hfov: horizontal field of view; lift: how far up the frame's centre looks (degrees, the
# camera stays level, so verticals stay vertical); grade: exposure, gamma.
SCREENSHOTS = [
    dict(env="grand_theater", film="llama_drama", hfov=96, lift=4, grade=(1.0, 1.0)),
    dict(env="orbital_deck", film="llamigos_snow", hfov=90, lift=7, grade=(1.0, 1.0)),
    dict(env="sentinel_hq", film="llama_drama_dawn", hfov=90, lift=3, grade=(1.12, 1.05)),
    dict(env="arcane_library", film="llamigos_ice", hfov=92, lift=5, grade=(1.25, 1.1)),
    dict(env="biolume_grove", film="jungle_book", hfov=96, lift=2, grade=(1.3, 1.08)),
    # The lights come up on pause and the control bar shows.
    dict(
        env="grand_theater",
        film="train_robbery",
        hfov=90,
        lift=3,
        grade=(1.0, 1.0),
        lights={"house": 1.0},
        controls=dict(progress=0.38, playing=False),
    ),
]


# ---------------------------------------------------------------------------
# Films


def _request(path, token=None, body=None):
    auth = 'MediaBrowser Client="Aurora store assets", Device="script", DeviceId="aurora-store-assets", Version="1.0"'
    if token:
        auth += f', Token="{token}"'
    headers = {"Authorization": auth, "User-Agent": "Mozilla/5.0 (aurora-store-assets)"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(DEMO_SERVER + path, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch_films(keys, refresh=False):
    """Each film's image and runtime, from the cache or else from the demo server."""
    CACHE.mkdir(parents=True, exist_ok=True)
    missing = [k for k in keys if refresh or not (CACHE / f"{k}.jpg").exists() or not (CACHE / f"{k}.json").exists()]
    if missing:
        # The demo account has no password.
        login = json.loads(_request("/Users/AuthenticateByName", body={"Username": "demo", "Pw": ""}))
        token, user = login["AccessToken"], login["User"]["Id"]
        items = json.loads(
            _request(f"/Items?userId={user}&IncludeItemTypes=Movie&Recursive=true&Fields=ProductionYear", token)
        )["Items"]
        by_name = {item["Name"]: item for item in items}
        for key in missing:
            item = by_name[FILMS[key]["name"]]
            if "at" in FILMS[key]:
                stream = f"{DEMO_SERVER}/Videos/{item['Id']}/stream?static=true&api_key={token}"
                subprocess.run(
                    ["ffmpeg", "-v", "error", "-y", "-ss", str(FILMS[key]["at"]), "-i", stream]
                    + ["-frames:v", "1", "-q:v", "1", str(CACHE / f"{key}.jpg")],
                    check=True,
                    timeout=300,
                )
            else:
                image = _request(f"/Items/{item['Id']}/Images/Backdrop/0?quality=96", token)
                (CACHE / f"{key}.jpg").write_bytes(image)
            meta = dict(
                name=item["Name"],
                id=item["Id"],
                year=item.get("ProductionYear"),
                runtime_s=int(item.get("RunTimeTicks", 0) / 10_000_000),
            )
            (CACHE / f"{key}.json").write_text(json.dumps(meta, indent=2))
            print("fetched", item["Name"])
    films = {}
    for key in keys:
        image = Image.open(CACHE / f"{key}.jpg").convert("RGB")
        zoom, cx, cy = FILMS[key].get("zoom", (1.0, 0.5, 0.5))
        image = fit(image, 16 / 9)
        if zoom != 1.0:
            w, h = image.size
            cw, ch = w / zoom, h / zoom
            left, top = (w - cw) * cx / 0.5 / 2, (h - ch) * cy / 0.5 / 2
            image = image.crop((round(left), round(top), round(left + cw), round(top + ch)))
        films[key] = dict(image=image, **json.loads((CACHE / f"{key}.json").read_text()))
    return films


def fit(image, aspect):
    """Crops to an aspect ratio around the centre."""
    w, h = image.size
    if w / h > aspect:
        nw = round(h * aspect)
        return image.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = round(w / aspect)
    return image.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))


# ---------------------------------------------------------------------------
# Panoramas and views


def load_sky(path):
    return np.asarray(Image.open(path).convert("RGB"))


class Camera:
    """
    A pinhole camera at the eye: yaw turns right, pitch tilts up (degrees). `lift` shifts
    the lens instead, as a view camera does: the frame looks up and verticals stay upright.
    """

    def __init__(self, width, height, hfov, lift=0.0, pitch=0.0, yaw=0.0):
        self.w, self.h = width, height
        self.f = (width / 2) / math.tan(math.radians(hfov) / 2)
        self.shift = math.tan(math.radians(lift))
        p, y = math.radians(pitch), math.radians(yaw)
        # Columns: the camera's right, forward and up, in the world (x right, y ahead, z up).
        right = np.array([math.cos(y), -math.sin(y), 0.0])
        forward = np.array([math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)])
        up = np.cross(right, forward)
        self.basis = np.stack([right, forward, up], axis=1)

    def rays(self, x0=0, y0=0, x1=None, y1=None, ox=0.5, oy=0.5):
        """World directions through pixels [x0, x1) x [y0, y1), at offset (ox, oy) inside each."""
        x1 = self.w if x1 is None else x1
        y1 = self.h if y1 is None else y1
        cx = (np.arange(x0, x1, dtype=np.float64) + ox - self.w / 2) / self.f
        cy = -(np.arange(y0, y1, dtype=np.float64) + oy - self.h / 2) / self.f + self.shift
        cx, cy = np.meshgrid(cx, cy)
        b = self.basis
        return (
            b[0, 0] * cx + b[0, 1] + b[0, 2] * cy,
            b[1, 0] * cx + b[1, 1] + b[1, 2] * cy,
            b[2, 0] * cx + b[2, 1] + b[2, 2] * cy,
        )

    def project(self, point):
        """Pixel coordinates of a world point (relative to the eye)."""
        c = self.basis.T @ np.asarray(point, dtype=np.float64)
        return self.w / 2 + self.f * c[0] / c[1], self.h / 2 - self.f * (c[2] / c[1] - self.shift)


def _cubic_weights(t):
    """Catmull-Rom weights for the four taps around a sample, t in [0, 1)."""
    t2, t3 = t * t, t * t * t
    return (
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1,
        -1.5 * t3 + 2 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2,
    )


def sample_equirect(sky, dx, dy, dz, cubic=True):
    """Bicubic (Catmull-Rom) or bilinear samples of an equirectangular image along directions."""
    h, w, _ = sky.shape
    lon = np.arctan2(dx, dy)
    lat = np.arctan2(dz, np.hypot(dx, dy))
    u = (lon / (2 * np.pi) + 0.5) * w - 0.5
    v = (0.5 - lat / np.pi) * h - 0.5
    if not cubic:
        u0, v0 = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
        fu, fv = (u - u0)[..., None].astype(np.float32), (v - v0)[..., None].astype(np.float32)
        r0, r1 = np.clip(v0, 0, h - 1), np.clip(v0 + 1, 0, h - 1)
        c0, c1 = u0 % w, (u0 + 1) % w
        out = (sky[r0, c0] * (1 - fu) + sky[r0, c1] * fu) * (1 - fv) + (sky[r1, c0] * (1 - fu) + sky[r1, c1] * fu) * fv
        return out.astype(np.float32) / 255
    u0, v0 = np.floor(u), np.floor(v)
    wu, wv = _cubic_weights(u - u0), _cubic_weights(v - v0)
    u0, v0 = u0.astype(np.int64), v0.astype(np.int64)
    out = np.zeros(dx.shape + (3,), dtype=np.float32)
    for j in range(4):
        rows = np.clip(v0 + j - 1, 0, h - 1)
        acc = np.zeros_like(out)
        for i in range(4):
            cols = (u0 + i - 1) % w  # wraps around behind the viewer
            acc += sky[rows, cols].astype(np.float32) * wu[i][..., None].astype(np.float32)
        out += acc * wv[j][..., None].astype(np.float32)
    return out / 255


def render_room(env, camera, lights, chunk=240):
    """The environment through the camera, its light layers at the given strengths."""
    base = load_sky(SKIES / f"theater_{env}.jpg")
    layers = []
    for name, k in lights.items():
        if k <= 0:
            continue
        layer = Image.open(SKIES / f"theater_{env}_{name}.jpg").convert("RGB")
        # Light layers are smaller JPEGs: soften their 8x8 blocks before they are enlarged.
        magnification = camera.f * 2 * math.pi / layer.width
        blur = min(1.6, max(0.6, 0.3 * magnification))
        layers.append((np.asarray(layer.filter(ImageFilter.GaussianBlur(blur))), k))
    out = np.zeros((camera.h, camera.w, 3), dtype=np.float32)
    for y0 in range(0, camera.h, chunk):
        y1 = min(camera.h, y0 + chunk)
        d = camera.rays(0, y0, None, y1)
        room = sample_equirect(base, *d)
        for layer, k in layers:
            room += k * sample_equirect(layer, *d, cubic=False)
        out[y0:y1] = room
    return np.clip(out, 0, 1)


def sharpen(image, radius=1.4, amount=0.35):
    """A light unsharp mask: the skies are upsampled, this restores some crispness."""
    pil = to_image(image)
    blurred = np.asarray(pil.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255
    return np.clip(image + amount * (image - blurred), 0, 1)


def place_quad(camera, texture, centre, size, supersample=4):
    """
    Projects a flat, upright quad facing the viewer (an RGBA texture) into the camera.
    Returns the colour (premultiplied by coverage) and the coverage, full frame.
    """
    cx, cy, cz = centre
    qw, qh = size
    corners = [camera.project((cx + sx * qw / 2, cy, cz + sz * qh / 2)) for sx in (-1, 1) for sz in (-1, 1)]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    x0, x1 = max(0, int(math.floor(min(xs))) - 1), min(camera.w, int(math.ceil(max(xs))) + 2)
    y0, y1 = max(0, int(math.floor(min(ys))) - 1), min(camera.h, int(math.ceil(max(ys))) + 2)
    # Resample the texture to about its size on screen first, so sampling it never aliases.
    on_screen = (max(xs) - min(xs), max(ys) - min(ys))
    tex = texture.resize((max(2, round(on_screen[0])), max(2, round(on_screen[1]))), Image.LANCZOS)
    tex = np.asarray(tex.convert("RGBA"), dtype=np.float32) / 255
    tex[..., :3] *= tex[..., 3:]  # premultiplied
    th, tw, _ = tex.shape

    colour = np.zeros((camera.h, camera.w, 3), dtype=np.float32)
    cover = np.zeros((camera.h, camera.w), dtype=np.float32)
    acc_c = np.zeros((y1 - y0, x1 - x0, 3), dtype=np.float32)
    acc_a = np.zeros((y1 - y0, x1 - x0), dtype=np.float32)
    n = supersample
    for sy in range(n):
        for sx in range(n):
            dx, dy, dz = camera.rays(x0, y0, x1, y1, (sx + 0.5) / n, (sy + 0.5) / n)
            t = cy / dy
            s = (t * dx - (cx - qw / 2)) / qw  # 0..1 left to right
            r = ((cz + qh / 2) - t * dz) / qh  # 0..1 top to bottom
            inside = (s >= 0) & (s < 1) & (r >= 0) & (r < 1) & (dy > 0)
            u = np.clip(s * tw - 0.5, 0, tw - 1.001)
            v = np.clip(r * th - 0.5, 0, th - 1.001)
            iu, iv = u.astype(np.int64), v.astype(np.int64)
            fu, fv = (u - iu)[..., None], (v - iv)[..., None]
            px = (
                tex[iv, iu] * (1 - fu) * (1 - fv)
                + tex[iv, iu + 1] * fu * (1 - fv)
                + tex[iv + 1, iu] * (1 - fu) * fv
                + tex[iv + 1, iu + 1] * fu * fv
            )
            px *= inside[..., None]
            acc_c += px[..., :3]
            acc_a += px[..., 3]
    colour[y0:y1, x0:x1] = acc_c / (n * n)
    cover[y0:y1, x0:x1] = acc_a / (n * n)
    return colour, cover


def over(room, colour, cover):
    return room * (1 - cover[..., None]) + colour


def glow(image, colour, cover, strength=0.35, radius=0.018):
    """A soft bloom of a bright panel onto what is around it, nothing more."""
    h, w, _ = image.shape
    small = (max(8, w // 6), max(8, h // 6))
    light = to_image(colour).resize(small, Image.BILINEAR)
    halo = np.zeros((h, w, 3), dtype=np.float32)
    for k, r in ((0.6, radius), (0.4, radius * 3.5)):
        blurred = light.filter(ImageFilter.GaussianBlur(r * small[0]))
        halo += k * np.asarray(blurred.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
    return np.clip(image + strength * halo * (1 - cover[..., None]), 0, 1)


def grade(image, exposure=1.0, gamma=1.0):
    return np.clip(image * exposure, 0, 1) ** (1 / gamma)


def vignette(image, strength=0.35, centre=(0.5, 0.5)):
    h, w, _ = image.shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (x / w - centre[0]) * 2
    ny = (y / h - centre[1]) * 2 * min(1.0, h / w * 1.6)
    d = np.sqrt(nx * nx + ny * ny) / math.sqrt(2)
    return image * (1 - strength * np.clip(d, 0, 1) ** 2)[..., None]


def to_image(array):
    return Image.fromarray((np.clip(array, 0, 1) * 255 + 0.5).astype(np.uint8))


def dither(array, seed=1):
    """A little noise before quantising, against banding in dark gradients."""
    rng = np.random.default_rng(seed)
    return array + rng.uniform(-0.5, 0.5, array.shape[:2])[..., None].astype(np.float32) / 255


# ---------------------------------------------------------------------------
# Vector bits: the Aurora mark and the control bar's Lucide icons


def _path_polylines(d, steps=24):
    """Flattens SVG path data (M L H V C A Z, absolute and relative) into polylines."""
    tokens = re.findall(r"[MmLlHhVvCcAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?", d)
    lines, current, pos, start, cmd, i = [], [], np.zeros(2), np.zeros(2), None, 0

    def num():
        nonlocal i
        i += 1
        return float(tokens[i - 1])

    while i < len(tokens):
        if re.match(r"[A-Za-z]", tokens[i]):
            cmd = tokens[i]
            i += 1
            if cmd in "Zz":
                if current:
                    current.append(start.copy())
                    lines.append(current)
                current, pos = [], start.copy()
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            p = np.array([num(), num()]) + (pos if rel else 0)
            if current:
                lines.append(current)
            current, pos, start = [p.copy()], p, p.copy()
            cmd = "l" if rel else "L"  # further pairs are line-tos
        elif c in "LHV":
            if c == "L":
                p = np.array([num(), num()]) + (pos if rel else 0)
            elif c == "H":
                p = np.array([num() + (pos[0] if rel else 0), pos[1]])
            else:
                p = np.array([pos[0], num() + (pos[1] if rel else 0)])
            current.append(p.copy())
            pos = p
        elif c == "C":
            pts = [np.array([num(), num()]) + (pos if rel else 0) for _ in range(3)]
            p0 = pos.copy()
            for k in range(1, steps + 1):
                t = k / steps
                current.append(
                    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * pts[0] + 3 * (1 - t) * t * t * pts[1] + t**3 * pts[2]
                )
            pos = pts[2]
        elif c == "A":
            rx, ry, rot, large, sweep = num(), num(), num(), num(), num()
            p = np.array([num(), num()]) + (pos if rel else 0)
            current.extend(_arc(pos, p, rx, ry, math.radians(rot), large, sweep, steps))
            pos = p
        else:
            raise ValueError(f"path command {cmd}")
    if current:
        lines.append(current)
    return [np.array(line) for line in lines]


def _arc(p0, p1, rx, ry, phi, large, sweep, steps):
    """SVG's endpoint arc, as points (the end point included)."""
    cos, sin = math.cos(phi), math.sin(phi)
    dx, dy = (p0 - p1) / 2
    x1, y1 = cos * dx + sin * dy, -sin * dx + cos * dy
    rx, ry = abs(rx), abs(ry)
    scale = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry)
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    den = rx * rx * y1 * y1 + ry * ry * x1 * x1
    k = math.sqrt(max(0.0, num / den)) * (-1 if large == sweep else 1)
    cx1, cy1 = k * rx * y1 / ry, -k * ry * x1 / rx
    centre = np.array([cos * cx1 - sin * cy1, sin * cx1 + cos * cy1]) + (p0 + p1) / 2
    a0 = math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx)
    a1 = math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx)
    delta = a1 - a0
    if sweep and delta < 0:
        delta += 2 * math.pi
    elif not sweep and delta > 0:
        delta -= 2 * math.pi
    n = max(4, int(abs(delta) / (2 * math.pi) * steps * 4))
    pts = []
    for k in range(1, n + 1):
        a = a0 + delta * k / n
        x, y = rx * math.cos(a), ry * math.sin(a)
        pts.append(centre + np.array([cos * x - sin * y, sin * x + cos * y]))
    return pts


def _gradient_x(width, height, x0, x1, stops):
    """A horizontal linear gradient (RGBA float), stops: [(offset, (r, g, b, a)), ...]."""
    x = np.clip((np.arange(width) + 0.5 - x0) / (x1 - x0), 0, 1)
    offsets = [s[0] for s in stops]
    channels = [np.interp(x, offsets, [s[1][c] for s in stops]) for c in range(4)]
    row = np.stack(channels, axis=-1).astype(np.float32)
    return np.broadcast_to(row, (height, width, 4)).copy()


MARK_PATH = "M44 3 C46 22 54 30 73 32 C54 34 46 42 44 61 C42 42 34 34 15 32 C34 30 42 22 44 3 Z"


def hex_rgba(value, alpha=1.0):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (alpha,)


def draw_mark(height, palette="brand", ss=4):
    """The Aurora mark (public/aurora-mark.svg, viewBox 88x64) as RGBA, `height` pixels tall."""
    s = height / 64 * ss
    w, h = round(88 * s), round(64 * s)
    shape = Image.new("L", (w, h), 0)
    star = _path_polylines(MARK_PATH, steps=64)[0] * s
    ImageDraw.Draw(shape).polygon([tuple(p) for p in star], fill=255)
    shape = np.asarray(shape, dtype=np.float32) / 255
    rows = np.arange(h)[:, None] / s
    top_mask = shape * (rows < 29)
    bottom_mask = shape * (rows >= 35)
    if palette == "brand":
        top_stops = [(0, hex_rgba("#fdf2f8")), (1, hex_rgba("#f9a8d4"))]
        bottom_stops = [(0, hex_rgba("#a78bfa", 0.8)), (1, hex_rgba("#38bdf8", 0.8))]
    else:  # deeper, for light backgrounds too
        top_stops = [(0, hex_rgba("#e0559f")), (1, hex_rgba("#b062e8"))]
        bottom_stops = [(0, hex_rgba("#7c5ce6")), (1, hex_rgba("#1d8fd8"))]
    top = _gradient_x(w, h, 15 * s, 73 * s, top_stops)
    bottom = _gradient_x(w, h, 15 * s, 73 * s, bottom_stops)
    top[..., 3] *= top_mask
    bottom[..., 3] *= bottom_mask
    beam_mask = Image.new("L", (w, h), 0)
    lw = 2.5 * s
    ImageDraw.Draw(beam_mask).rounded_rectangle(
        (4 * s - lw / 2, 32 * s - lw / 2, 84 * s + lw / 2, 32 * s + lw / 2), radius=lw / 2, fill=255
    )
    beam = _gradient_x(
        w,
        h,
        4 * s,
        84 * s,
        [
            (0, hex_rgba("#f472b6", 0)),
            (0.3, hex_rgba("#f472b6")),
            (0.7, hex_rgba("#38bdf8")),
            (1, hex_rgba("#38bdf8", 0)),
        ],
    )
    beam[..., 3] *= np.asarray(beam_mask, dtype=np.float32) / 255
    out = np.zeros((h, w, 4), dtype=np.float32)
    for layer in (top, bottom, beam):  # source-over, straight alpha
        a = layer[..., 3:]
        out_a = a + out[..., 3:] * (1 - a)
        out[..., :3] = np.where(out_a > 0, (layer[..., :3] * a + out[..., :3] * out[..., 3:] * (1 - a)) / np.maximum(out_a, 1e-6), 0)
        out[..., 3:] = out_a
    image = Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")
    return image.resize((round(88 * height / 64), height), Image.LANCZOS)


def draw_icon(svg_paths, size, colour, ss=8):
    """A Lucide icon (24x24 viewBox, stroke 2, round caps and joins) as RGBA."""
    s = size / 24 * ss
    n = round(24 * s)
    mask = Image.new("L", (n, n), 0)
    draw = ImageDraw.Draw(mask)
    width = 2 * s
    for d, filled in svg_paths:
        for line in _path_polylines(d):
            pts = [tuple(p * s) for p in line]
            if filled and len(pts) > 2:
                draw.polygon(pts, fill=255)
            draw.line(pts, fill=255, width=round(width), joint="curve")
            for p in (pts[0], pts[-1]):
                draw.ellipse((p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    icon = Image.new("RGBA", (size, size), colour[:3] + (0,))
    alpha = np.asarray(mask, dtype=np.float32) * (colour[3] / 255 if len(colour) > 3 else 1)
    icon.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return icon


def font(name, size, weight):
    f = ImageFont.truetype(str(FONTS / name), size)
    try:
        f.set_variation_by_axes([weight])
    except (OSError, AttributeError):
        pass  # no variable font support: the default weight
    return f


# ---------------------------------------------------------------------------
# The theater's control bar (res/layout/theater_controls.xml), 1000x220 dp


ICONS = {
    "pause": [
        ("M15,3h3a1,1 0 0 1 1,1v16a1,1 0 0 1 -1,1h-3a1,1 0 0 1 -1,-1v-16a1,1 0 0 1 1,-1z", True),
        ("M6,3h3a1,1 0 0 1 1,1v16a1,1 0 0 1 -1,1h-3a1,1 0 0 1 -1,-1v-16a1,1 0 0 1 1,-1z", True),
    ],
    "skip_back": [("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", False), ("M3 3v5h5", False)],
    "skip_forward": [("M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", False), ("M21 3v5h-5", False)],
    "environments": [
        ("m8 3 4 8 5-5 5 15H2L8 3z", False),
        ("M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19", False),
    ],
    "close": [("M18 6 6 18", False), ("m6 6 12 12", False)],
}


def _play_icon_paths():
    """Lucide "play", read from the app's drawable so it matches what the theater shows."""
    xml = (ROOT / "android/app/src/quest/res/drawable/theater_icon_play.xml").read_text()
    return [(d, 'fillColor' in block) for block in xml.split("<path")[1:] for d in re.findall(r'pathData="([^"]+)"', block)]


def control_bar(title, position_s, duration_s, playing, scale=3):
    """The bar as the theater draws it: dark glass, title and time, timeline, transport."""
    dp = scale
    W, H = 1000 * dp, 220 * dp
    ss = 2
    image = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    q = dp * ss
    # theater_glass_bg: #EB131C34, 1.5 dp #47AAC4FF stroke, 36 dp corners; the layout pads 8 dp.
    border = round(1.5 * q)
    draw.rounded_rectangle((8 * q, 8 * q, 992 * q, 212 * q), radius=36 * q, fill=(170, 196, 255, 0x47))
    draw.rounded_rectangle(
        (8 * q + border, 8 * q + border, 992 * q - border, 212 * q - border),
        radius=36 * q - border,
        fill=(19, 28, 52, 0xEB),
    )
    image = image.resize((W, H), Image.LANCZOS)
    draw = ImageDraw.Draw(image)

    left, right, top = 40, 968, 28  # inside the padding (start 32, end 24, top 20)
    # Title row: Space Grotesk 700 26 sp, time in Manrope 500 18 sp, muted.
    title_font = font("space_grotesk.ttf", round(26 * dp), 700)
    time_font = font("manrope.ttf", round(18 * dp), 500)

    def clock(seconds):
        h, m, s = seconds // 3600, seconds % 3600 // 60, seconds % 60
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

    row_mid = (top + 18) * dp
    draw.text((left * dp, row_mid), title, font=title_font, fill=INK, anchor="lm")
    draw.text(
        (right * dp, row_mid), f"{clock(position_s)} / {clock(duration_s)}", font=time_font, fill=(228, 235, 255, 0xB8), anchor="rm"
    )
    # Timeline: a 6 dp track (25% white), the played part in the accent gradient, a 20 dp thumb.
    track_y = (top + 36 + 18) * dp
    x0, x1 = left * dp, (right - 8) * dp
    progress = position_s / max(1, duration_s)
    xp = x0 + (x1 - x0) * progress
    draw.rounded_rectangle((x0, track_y - 3 * dp, x1, track_y + 3 * dp), radius=3 * dp, fill=(255, 255, 255, 0x40))
    played = Image.new("RGBA", (max(1, round(xp - x0)), 6 * dp))
    grad = _gradient_x(played.width, played.height, 0, played.width, [(0, ACCENT + (255,)), (1, ACCENT_STRONG + (255,))])
    played = Image.fromarray(grad.astype(np.uint8), "RGBA")
    pmask = Image.new("L", played.size, 0)
    ImageDraw.Draw(pmask).rounded_rectangle((0, 0, played.width - 1, played.height - 1), radius=3 * dp, fill=255)
    image.paste(played, (round(x0), round(track_y - 3 * dp)), pmask)
    draw = ImageDraw.Draw(image)
    draw.ellipse((xp - 10 * dp, track_y - 10 * dp, xp + 10 * dp, track_y + 10 * dp), fill=INK)

    # Transport, centred in the rest: 64 dp icon buttons (28 dp icons, muted), a 76 dp play button.
    row_y = ((top + 36 + 36) + 198) / 2 * dp
    mid_x = (left + right) / 2 * dp
    muted = (228, 235, 255, 0xB8)

    def put(icon, cx, cy):
        image.alpha_composite(icon, (round(cx - icon.width / 2), round(cy - icon.height / 2)))

    put(draw_icon(ICONS["skip_back"], 28 * dp, muted), mid_x - (38 + 20 + 32) * dp, row_y)
    put(draw_icon(ICONS["skip_forward"], 28 * dp, muted), mid_x + (38 + 20 + 32) * dp, row_y)
    # The play button: an oval, accent to #5A8FE6 at 315° (top left to bottom right).
    n = 76 * dp
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    t = np.clip((xx + yy) / 2, 0, 1)[..., None]
    rgb = np.array(ACCENT, np.float32) * (1 - t) + np.array((90, 143, 230), np.float32) * t
    disc = Image.new("L", (n * 4, n * 4), 0)
    ImageDraw.Draw(disc).ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
    button = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    button.putalpha(disc.resize((n, n), Image.LANCZOS))
    put(button, mid_x, row_y)
    glyph = ICONS["pause"] if playing else _play_icon_paths()
    put(draw_icon(glyph, 28 * dp, VOID + (255,)), mid_x, row_y)
    put(draw_icon(ICONS["environments"], 28 * dp, muted), (right - 64 - 32) * dp, row_y)
    put(draw_icon(ICONS["close"], 28 * dp, muted), (right - 32) * dp, row_y)
    return image


# ---------------------------------------------------------------------------
# Screenshots


def screenshot(spec, film, size=(2560, 1440)):
    camera = Camera(*size, spec["hfov"], spec["lift"])
    lights = spec.get("lights", FILM_LIGHTS[spec["env"]])
    room = sharpen(render_room(spec["env"], camera, lights))
    room = grade(room, *spec["grade"])
    frame = film["image"].convert("RGBA")
    colour, cover = place_quad(camera, frame, SCREEN["centre"], SCREEN["size"])
    image = glow(over(room, colour, cover), colour, cover)
    if spec.get("controls"):
        c = spec["controls"]
        duration = film["runtime_s"] or 600
        bar = control_bar(film["name"], round(duration * c["progress"]), duration, c["playing"])
        colour, cover = place_quad(camera, bar, CONTROLS["centre"], CONTROLS["size"])
        image = over(image, colour, cover)
    return to_image(dither(image))


# ---------------------------------------------------------------------------
# The branded set: the Grand Theater, lights up, the title on its screen


TITLE = "Aurora Cinema"


def title_card(width, title_width=0.78, mark=True):
    """What the cinema screen shows: the mark and the title, glowing on a deep aurora sky."""
    w, h = width, round(width * 9 / 16)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = (xx / w - 0.5) * 16 / 9, yy / h - 0.5
    bg = np.ones((h, w, 3), np.float32) * np.array(VOID, np.float32) / 255
    for (cx, cy, r, col, k) in (
        (0.0, -0.05, 0.75, (124, 109, 242), 0.45),  # violet, as the icon's glow
        (-0.5, 0.3, 0.6, (244, 114, 182), 0.2),  # a breath of pink
        (0.5, 0.3, 0.6, (56, 189, 248), 0.22),  # and of sky blue
    ):
        d2 = ((nx - cx) ** 2 + (ny - cy) ** 2) / (r * r)
        bg += k * np.exp(-d2 * 2.2)[..., None] * np.array(col, np.float32) / 255
    card = to_image(dither(np.clip(bg, 0, 1), seed=3)).convert("RGBA")

    # Title: Space Grotesk Bold, sized to the card.
    probe = font("space_grotesk.ttf", 200, 700)
    box = probe.getbbox(TITLE)
    size = round(200 * title_width * w / (box[2] - box[0]))
    f = font("space_grotesk.ttf", size, 700)
    box = f.getbbox(TITLE)
    text_w, cap = box[2] - box[0], box[3] - box[1]
    mark_h = round(cap * 1.7) if mark else 0
    gap = round(cap * 0.35) if mark else 0
    block = mark_h + gap + cap
    top = (h - block) / 2
    text = Image.new("L", (w, h), 0)
    ImageDraw.Draw(text).text(((w - text_w) / 2 - box[0], top + mark_h + gap - box[1]), TITLE, font=f, fill=255)
    halo = text.filter(ImageFilter.GaussianBlur(cap * 0.35))
    wide = text.filter(ImageFilter.GaussianBlur(cap * 1.2))
    glow_layer = np.zeros((h, w, 4), np.float32)
    glow_layer[..., :3] = np.array(ACCENT_STRONG, np.float32)
    glow_layer[..., 3] = np.clip(np.asarray(halo, np.float32) * 0.7 + np.asarray(wide, np.float32) * 0.45, 0, 255)
    card.alpha_composite(Image.fromarray(glow_layer.astype(np.uint8), "RGBA"))
    ink = Image.new("RGBA", (w, h), INK + (0,))
    ink.putalpha(text)
    card.alpha_composite(ink)
    if mark:
        m = draw_mark(mark_h)
        mglow = Image.new("RGBA", m.size, (190, 170, 255, 0))
        mglow.putalpha(m.getchannel("A").filter(ImageFilter.GaussianBlur(mark_h * 0.12)))
        pos = (round((w - m.width) / 2), round(top))
        card.alpha_composite(mglow, pos)
        card.alpha_composite(m, pos)
    return card.convert("RGB")


def branded(size, panel_width, panel_y, title_width=0.8, darken=0.62, vig=0.55):
    """
    The theater framed so the screen is `panel_width` of the image wide with its
    centre at `panel_y` of the height (the title sits on the screen's centre).
    """
    w, h = size
    half = SCREEN["size"][0] / 2 / SCREEN["centre"][1]  # tan of the screen's half width
    f = panel_width * w / 2 / half
    hfov = math.degrees(2 * math.atan(w / 2 / f))
    lift = math.degrees(math.atan(SCREEN["centre"][2] / SCREEN["centre"][1] - (0.5 - panel_y) * h / f))
    camera = Camera(w, h, hfov, lift)
    room = sharpen(render_room("grand_theater", camera, {"house": 1.0}))
    room = vignette(room * darken, vig, centre=(0.5, panel_y))
    on_screen = round(panel_width * w * 2)
    card = title_card(on_screen, title_width).convert("RGBA")
    colour, cover = place_quad(camera, card, SCREEN["centre"], SCREEN["size"])
    image = glow(over(room, colour, cover), colour, cover, strength=0.3, radius=0.02)
    return to_image(dither(image))


BRANDED = {
    "hero": dict(size=(3000, 900), panel_width=0.4, panel_y=0.5),
    "cover_landscape": dict(size=(2560, 1440), panel_width=0.5, panel_y=0.45),
    "cover_square": dict(size=(1440, 1440), panel_width=0.62, panel_y=0.5),
    "cover_portrait": dict(size=(1008, 1440), panel_width=0.8, panel_y=0.5),
    "mini_landscape": dict(size=(1080, 360), panel_width=0.54, panel_y=0.5, title_width=0.88, vig=0.3),
}


# ---------------------------------------------------------------------------
# Icon and logo


def icon():
    """public/logo512.png flattened onto its own background gradient, square corners."""
    logo = Image.open(ROOT / "public/logo512.png").convert("RGBA")
    n = logo.width
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    t = np.clip((xx + yy) / (2 * n), 0, 1)[..., None]  # the SVG's #0f1428 -> #070a14 diagonal
    bg = np.array((15, 20, 40), np.float32) * (1 - t) + np.array((7, 10, 20), np.float32) * t
    out = Image.fromarray((bg + 0.5).astype(np.uint8), "RGB").convert("RGBA")
    out.alpha_composite(logo)
    return out.convert("RGB")


def logo():
    """The wordmark with the mark, in mid tones that read on light and on dark."""
    height = 1000
    f = font("space_grotesk.ttf", 640, 700)
    box = f.getbbox(TITLE)
    text_w, cap = box[2] - box[0], box[3] - box[1]
    mark = draw_mark(round(cap * 1.45), palette="deep")
    gap = round(cap * 0.35)
    pad = round(cap * 0.12)
    width = pad + mark.width + gap + text_w + pad
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mask = Image.new("L", (width, height), 0)
    tx = pad + mark.width + gap
    ImageDraw.Draw(mask).text((tx - box[0], (height - cap) / 2 - box[1]), TITLE, font=f, fill=255)
    # A blue to violet gradient whose luminance gives about 4.5:1 against white and black alike.
    grad = _gradient_x(width, height, tx, tx + text_w, [(0, hex_rgba("#3f7ee8")), (1, hex_rgba("#8a5cf0"))])
    grad[..., 3] = np.asarray(mask, np.float32) / 255
    image.alpha_composite(Image.fromarray((grad * 255 + 0.5).astype(np.uint8), "RGBA"))
    image.alpha_composite(mark, (pad, round((height - mark.height) / 2)))
    bbox = image.getchannel("A").getbbox()
    margin = round(cap * 0.1)
    return image.crop((bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin))


# ---------------------------------------------------------------------------


def credits():
    lines = [
        "# Film credits for the store screenshots",
        "",
        "The films on the theater screen in the screenshots are frames or backdrop images of public",
        "domain and Creative Commons Attribution films on the public Jellyfin demo server",
        f"({DEMO_SERVER}), fetched by scripts/quest/store_assets.py.",
        "",
        "| Screenshot | Environment | Film | Licence |",
        "| --- | --- | --- | --- |",
    ]
    for n, spec in enumerate(SCREENSHOTS, 1):
        film = FILMS[spec["film"]]
        env = spec["env"].replace("_", " ").title().replace("Hq", "HQ")
        source = f"frame at {film['at'] // 60}:{film['at'] % 60:02d}" if "at" in film else "backdrop image"
        lines.append(f"| screenshot_{n}.png | {env} | {film['credit']} ({source}) | {film['licence']} |")
    lines += [
        "",
        "The Aurora mark, Space Grotesk and Manrope (SIL Open Font License) are the app's own;",
        "the control bar icons are Lucide (ISC licence).",
        "",
    ]
    (OUT / "CREDITS.md").write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--refresh", action="store_true", help="fetch the film backdrops again")
    parser.add_argument("--only", nargs="*", help="only these outputs (e.g. hero screenshot_2 icon)")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = lambda name: not args.only or name in args.only  # noqa: E731
    started = time.time()

    def save(image, name):
        path = OUT / f"{name}.png"
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {image.size[0]}x{image.size[1]} {image.mode}  {time.time() - started:.0f}s")

    if wanted("icon"):
        save(icon(), "icon")
    if wanted("logo"):
        save(logo(), "logo")
    for name, spec in BRANDED.items():
        if wanted(name):
            save(branded(**spec), name)
    shots = [(f"screenshot_{n}", spec) for n, spec in enumerate(SCREENSHOTS, 1) if wanted(f"screenshot_{n}")]
    if shots:
        films = fetch_films(sorted({spec["film"] for _, spec in shots}), args.refresh)
        for name, spec in shots:
            save(screenshot(spec, films[spec["film"]]), name)
    credits()


if __name__ == "__main__":
    main()
