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


def bandpass(signal: np.ndarray, low: float, high: float) -> np.ndarray:
    """Soft band-pass in the frequency domain (circular, loop-safe)."""
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(signal.size, 1 / RATE)
    spectrum *= 1 / np.sqrt(1 + (freqs / high) ** 4) * (1 - 1 / np.sqrt(1 + (freqs / low) ** 4))
    return np.fft.irfft(spectrum, signal.size)


def bursts(n: int, rate_per_second: float, length: tuple, shape) -> np.ndarray:
    """Short events at random times, each `shape(samples) -> array`, wrapped around the loop."""
    out = np.zeros(n)
    for start in rng.uniform(0, n, int(rate_per_second * n / RATE)):
        samples = int(rng.uniform(*length) * RATE)
        idx = (int(start) + np.arange(samples)) % n
        out[idx] += shape(samples)
    return out


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


def grand_theater(seconds: int = 40) -> np.ndarray:
    """A full cinema before the film: soft, indistinct murmur under a warm room tone."""
    n = seconds * RATE
    voices = np.zeros(n)
    for _ in range(16):
        # Each voice: speech-band noise, gated into syllables and phrases.
        syllables = np.clip(smooth_random(n, int(seconds * rng.uniform(3, 5))) * 1.8 - 0.6, 0, 1)
        phrases = np.clip(smooth_random(n, int(seconds * 0.4)) * 2 - 0.5, 0, 1)
        centre = rng.uniform(350, 900)
        voices += bandpass(rng.normal(0, 1, n), centre * 0.6, centre * 2.2) * syllables * phrases * rng.uniform(0.4, 1)
    # Far away: the hall softens the voices.
    voices = lowpass(voices, 1300)
    room = lowpass(rng.normal(0, 1, n), 160) * 0.5
    return normalise(seamless(voices + room, 2.5), 0.32)


def orbital_deck(seconds: int = 40) -> np.ndarray:
    """A starship at rest: the deep hum of its engines, air moving, now and then a soft chime."""
    n = seconds * RATE
    t = np.arange(n) / RATE
    hum = sum(
        amp * np.sin(2 * np.pi * round(freq * seconds) / seconds * t + rng.uniform(0, 6))
        for freq, amp in ((38, 0.5), (57, 0.3), (76.4, 0.2), (114, 0.08))
    )
    rumble = lowpass(rng.normal(0, 1, n), 90) * 1.4
    air = bandpass(rng.normal(0, 1, n), 300, 1200) * 0.12 * (0.7 + 0.3 * smooth_random(n, 6))

    def chime(samples):
        k = np.arange(samples) / RATE
        tone = rng.choice([660, 880, 990, 1320])
        return (np.sin(2 * np.pi * tone * k) + 0.4 * np.sin(2 * np.pi * tone * 1.5 * k)) * np.exp(-k * 7) * 0.06

    chimes = bursts(n, 0.12, (0.5, 0.8), chime)
    return normalise(seamless(hum + rumble + air + chimes, 2.0), 0.4)


def sentinel_hq(seconds: int = 44) -> np.ndarray:
    """High above a city at night: wind against the glass, far-off traffic rising from below."""
    n = seconds * RATE
    traffic = lowpass(rng.normal(0, 1, n), 260) * (0.6 + 0.4 * smooth_random(n, 8))
    wind = bandpass(rng.normal(0, 1, n), 500, 1600) * smooth_random(n, 7) ** 2 * 0.5
    hiss = bandpass(rng.normal(0, 1, n), 2500, 6000) * 0.04
    return normalise(seamless(traffic + wind + hiss, 3.0), 0.38)


def arcane_library(seconds: int = 40) -> np.ndarray:
    """A fire crackling in a stone hearth, in a quiet hall."""
    n = seconds * RATE
    roar = lowpass(rng.normal(0, 1, n), 180) * (0.6 + 0.4 * smooth_random(n, 20))

    def crackle(samples):
        k = np.arange(samples) / RATE
        return rng.normal(0, 1, samples) * np.exp(-k * rng.uniform(120, 400)) * rng.uniform(0.2, 1)

    crackles = bandpass(bursts(n, 9, (0.01, 0.04), crackle), 900, 7000)

    def pop(samples):
        k = np.arange(samples) / RATE
        return rng.normal(0, 1, samples) * np.exp(-k * 60) * 1.4

    pops = bandpass(bursts(n, 0.5, (0.05, 0.1), pop), 400, 4000)
    room = lowpass(rng.normal(0, 1, n), 120) * 0.3
    return normalise(seamless(roar + crackles * 0.8 + pops + room, 2.0), 0.45)


def biolume_grove(seconds: int = 40) -> np.ndarray:
    """An alien jungle at night: a chorus of insects, soft calls, leaves stirring."""
    n = seconds * RATE
    t = np.arange(n) / RATE
    chorus = np.zeros(n)
    for _ in range(7):
        # A cricket-like chirp: a high tone pulsed quickly, in bursts with rests.
        carrier = np.sin(2 * np.pi * rng.uniform(3800, 5600) * t)
        pulse = (np.sin(2 * np.pi * rng.uniform(25, 40) * t) > 0.2).astype(float)
        period = rng.uniform(0.7, 1.6)
        burst = ((t + rng.uniform(0, period)) % period) < rng.uniform(0.2, 0.45)
        chorus += carrier * lowpass(pulse * burst, 600) * rng.uniform(0.3, 1) * (0.5 + 0.5 * smooth_random(n, 5))

    def call(samples):
        k = np.arange(samples) / RATE
        f0 = rng.uniform(380, 700)
        return np.sin(2 * np.pi * (f0 * k - 120 * k**2)) * np.sin(np.pi * k / k[-1]) ** 2 * 0.25

    calls = bursts(n, 0.25, (0.3, 0.6), call)
    leaves = bandpass(rng.normal(0, 1, n), 800, 3500) * smooth_random(n, 9) ** 3 * 0.35
    return normalise(seamless(chorus * 0.35 + calls + leaves, 2.5), 0.4)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, make in (
        ("northern_lights", northern_lights),
        ("dark_room", dark_room),
        ("grand_theater", grand_theater),
        ("orbital_deck", orbital_deck),
        ("sentinel_hq", sentinel_hq),
        ("arcane_library", arcane_library),
        ("biolume_grove", biolume_grove),
    ):
        path = OUT / f"theater_ambience_{name}.ogg"
        sf.write(path, make().astype(np.float32), RATE, format="OGG", subtype="VORBIS")
        print(path.name, path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
