"""
Synthesises the ambient sound loops of the Quest theater environments.

    python3 -m venv .venv && .venv/bin/pip install numpy soundfile
    .venv/bin/python scripts/quest/ambience.py

Writes android/app/src/quest/res/raw/theater_ambience_*.ogg. Every sound is
made here from noise and oscillators, so there is nothing to license, and
each loop is seamless (its end crossfades into its start).

The theater plays an environment's loop softly while the film isn't playing,
and fades it out when it starts, the way a cinema hushes when the lights go down.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 32_000
OUT = Path(__file__).resolve().parents[2] / "android/app/src/quest/res/raw"
rng = np.random.default_rng(20261122)


def lowpass(signal: np.ndarray, cutoff: float) -> np.ndarray:
    """Gentle low-pass in the frequency domain. Circular, so loops stay seamless."""
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(signal.size, 1 / RATE)
    spectrum /= np.sqrt(1 + (freqs / cutoff) ** 4)
    return np.fft.irfft(spectrum, signal.size)


def smooth_random(length: int, points: int, seed_scale: float = 1.0) -> np.ndarray:
    """A slow, smooth random curve in 0..1 (wind gusts, swells)."""
    knots = rng.uniform(0, 1, points + 1) * seed_scale
    knots[-1] = knots[0]  # loops
    x = np.linspace(0, points, length)
    i = np.floor(x).astype(int).clip(0, points - 1)
    t = x - i
    t = t * t * (3 - 2 * t)
    return knots[i] * (1 - t) + knots[i + 1] * t


def seamless(signal: np.ndarray, fade_seconds: float = 3.0) -> np.ndarray:
    """Crossfade the tail into the head so the loop has no seam."""
    n = int(fade_seconds * RATE)
    fade = np.linspace(0, 1, n)
    head, body, tail = signal[:n], signal[n:-n], signal[-n:]
    return np.concatenate([head * fade + tail * (1 - fade), body])


def normalise(signal: np.ndarray, peak: float) -> np.ndarray:
    return signal / np.max(np.abs(signal)) * peak


def northern_lights(seconds: int = 48) -> np.ndarray:
    """Wind over a frozen lake at night, with water lapping now and then."""
    n = seconds * RATE
    # Wind: brown-ish noise, slowly swelling and easing.
    wind = lowpass(rng.normal(0, 1, n), 380)
    wind *= 0.35 + 0.65 * smooth_random(n, 9)
    whistle = lowpass(rng.normal(0, 1, n), 1400) * smooth_random(n, 13) ** 3 * 0.25
    # Lapping: short, soft bursts of filtered noise.
    lapping = np.zeros(n)
    for start in rng.uniform(0, seconds - 1.5, 22):
        length = int(rng.uniform(0.25, 0.7) * RATE)
        s = int(start * RATE)
        envelope = np.sin(np.linspace(0, np.pi, length)) ** 2
        lapping[s : s + length] += rng.normal(0, 1, length) * envelope * rng.uniform(0.2, 0.5)
    lapping = lowpass(lapping, 900)
    return normalise(seamless(wind + whistle + lapping * 0.6), 0.5)


def dark_room(seconds: int = 36) -> np.ndarray:
    """A quiet cinema: soft room tone and the low hum of a projector."""
    n = seconds * RATE
    t = np.arange(n) / RATE
    room = lowpass(rng.normal(0, 1, n), 220) * 0.8
    # Whole periods of each tone fit the loop, so it repeats without a click.
    hum = sum(
        amp * np.sin(2 * np.pi * round(freq * seconds) / seconds * t)
        for freq, amp in ((50, 0.05), (100, 0.025), (150, 0.012))
    )
    fan = lowpass(rng.normal(0, 1, n), 2200) * 0.06
    return normalise(seamless(room + hum + fan, 2.0), 0.35)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, make in (("northern_lights", northern_lights), ("dark_room", dark_room)):
        path = OUT / f"theater_ambience_{name}.ogg"
        sf.write(path, make().astype(np.float32), RATE, format="OGG", subtype="VORBIS")
        print(path.name, path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
