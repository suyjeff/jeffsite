"""Synthesizes Cadence's UI sounds as 44.1 kHz / 16-bit mono WAVs.

Every sound is short, soft-attack-free (a real transient), and ends in a
5 ms fade so nothing clicks. Peaks are deliberately low: UI sounds should sit
under whatever the person is listening to.
"""
import sys
import wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(t, attack=0.002, tau=0.05):
    a = np.clip(t / attack, 0, 1) if attack > 0 else np.ones_like(t)
    return a * np.exp(-t / tau)


def glide(t, f0, f1, tau):
    """Exponential pitch glide from f0 toward f1; returns phase."""
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    return 2 * np.pi * np.cumsum(f) / SR


def lowpass(x, cutoff):
    # one-pole lowpass, run twice for a gentle 12 dB/oct slope
    a = np.exp(-2 * np.pi * cutoff / SR)
    for _ in range(2):
        y = np.zeros_like(x)
        prev = 0.0
        for i, v in enumerate(x):
            prev = (1 - a) * v + a * prev
            y[i] = prev
        x = y
    return x


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def bell(t, f, tau=0.5, partials=((1, 1.0), (2.0, 0.28), (3.01, 0.1), (4.2, 0.04))):
    out = np.zeros_like(t)
    for ratio, amp in partials:
        out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (tau / ratio ** 0.7))
    return out * np.clip(t / 0.003, 0, 1)


def finish(x, peak):
    x = np.tanh(x * 1.2)  # a touch of warmth
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    fade = int(SR * 0.005)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def write(name, x):
    data = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(f"{OUT}/{name}.wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def tick():
    # A tiny mechanical detent: a damped high partial plus a breath of noise.
    t = t_axis(0.03)
    tone = np.sin(2 * np.pi * 2600 * t) * env(t, 0.0004, 0.004)
    noise = highpass(rng.standard_normal(len(t)), 2000) * env(t, 0.0002, 0.0018) * 0.35
    return finish(tone + noise, 0.22)


def threshold():
    # The "armed" detent when a swipe crosses its commit point.
    t = t_axis(0.06)
    click = np.sin(2 * np.pi * 1900 * t) * env(t, 0.0003, 0.006)
    body = np.sin(glide(t, 320, 180, 0.01)) * env(t, 0.001, 0.014) * 0.8
    noise = highpass(rng.standard_normal(len(t)), 3000) * env(t, 0.0002, 0.002) * 0.25
    return finish(click + body + noise, 0.36)


def check():
    # Rising "bloop" + glassy overtone: reads as positive and finished.
    t = t_axis(0.42)
    pop = np.sin(glide(t, 620, 1180, 0.028)) * env(t, 0.0015, 0.055)
    thump = np.sin(glide(t, 240, 140, 0.02)) * env(t, 0.001, 0.025) * 0.55
    shimmer = bell(t, 2093.0, tau=0.22) * 0.16
    click = highpass(rng.standard_normal(len(t)), 2500) * env(t, 0.0002, 0.0015) * 0.25
    return finish(pop + thump + shimmer + click, 0.55)


def uncheck():
    # The same family, falling and quieter: an undo, not a failure.
    t = t_axis(0.2)
    pop = np.sin(glide(t, 1050, 560, 0.03)) * env(t, 0.0015, 0.04)
    thump = np.sin(glide(t, 200, 130, 0.02)) * env(t, 0.001, 0.02) * 0.4
    return finish(pop + thump, 0.32)


def skip():
    # A soft, low "thup" with a short air sweep, like a card set aside.
    t = t_axis(0.24)
    thup = np.sin(glide(t, 260, 120, 0.04)) * env(t, 0.002, 0.05)
    air = lowpass(rng.standard_normal(len(t)), 1800) * env(t, 0.01, 0.045) * 0.5
    return finish(thup + air, 0.34)


def complete():
    # A short major arpeggio of soft bells for finishing everything today.
    dur = 1.4
    t = t_axis(dur)
    out = np.zeros_like(t)
    notes = [(659.25, 0.0, 0.9), (830.61, 0.075, 0.8), (987.77, 0.15, 0.75), (1318.5, 0.225, 0.6)]
    for f, start, amp in notes:
        i = int(start * SR)
        tt = t[: len(t) - i]
        out[i:] += bell(tt, f, tau=0.55) * amp
    warmth = np.sin(2 * np.pi * 329.63 * t) * env(t, 0.01, 0.35) * 0.25
    return finish(out + warmth, 0.42)


def card():
    # Quiet paper slide for cycling the deck without marking anything.
    t = t_axis(0.16)
    noise = rng.standard_normal(len(t))
    sweep = lowpass(noise, 2600) - lowpass(noise, 500)
    shape = np.sin(np.pi * np.clip(t / 0.16, 0, 1)) ** 2
    tap = np.sin(glide(t, 180, 110, 0.02)) * env(t, 0.001, 0.02) * 0.5
    return finish(sweep * shape + tap, 0.18)


def log():
    # Metric logged: a two-step "ding-dong" up a fifth, lighter than check.
    t = t_axis(0.5)
    a = np.sin(glide(t, 700, 880, 0.02)) * env(t, 0.0015, 0.06)
    i = int(0.07 * SR)
    b = np.zeros_like(t)
    b[i:] = np.sin(glide(t[: len(t) - i], 1050, 1320, 0.02)) * env(t[: len(t) - i], 0.0015, 0.08)
    shimmer = bell(t, 2637.0, tau=0.2) * 0.1
    return finish(a * 0.8 + b + shimmer, 0.5)


if __name__ == "__main__":
    OUT = sys.argv[1]
    for fn in (tick, threshold, check, uncheck, skip, complete, card, log):
        write(fn.__name__, fn())
        print("wrote", fn.__name__)
