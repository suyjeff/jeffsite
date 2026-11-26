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


def mallet(t, f, decay=0.45, brightness=1.0):
    """A struck glass bar: a sine fundamental plus inharmonic overtones that die fast,
    with a tiny noise click on the strike."""
    out = np.sin(2 * np.pi * f * t) * np.exp(-t / decay)
    out += 0.32 * brightness * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / (decay * 0.22))
    out += 0.10 * brightness * np.sin(2 * np.pi * f * 5.40 * t) * np.exp(-t / (decay * 0.08))
    out *= np.clip(t / 0.0015, 0, 1)
    click = highpass(rng.standard_normal(len(t)), 3500) * np.exp(-t / 0.0012) * 0.12 * brightness
    return out + click


def two_notes(f1, f2, gap, d1, d2, total, b1=1.0, b2=1.0, a1=0.7, a2=1.0):
    t = t_axis(total)
    out = a1 * mallet(t, f1, d1, b1)
    i = int(gap * SR)
    tt = t[: len(t) - i]
    out[i:] += a2 * mallet(tt, f2, d2, b2)
    return out


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
    # "Da-ding": a short note, then a fifth above that rings. The second strike lands at
    # 85 ms, the same moment as the second haptic tap.
    x = two_notes(987.77, 1479.98, 0.085, 0.07, 0.42, 0.6, a1=0.55, a2=1.0)
    t = t_axis(0.6)
    body = np.sin(glide(t, 220, 150, 0.02)) * env(t, 0.001, 0.03) * 0.35   # a little weight
    return finish(x + body, 0.55)


def uncheck():
    # "Ding-da": the same two notes falling and softer, so undo sounds like check reversed.
    x = two_notes(1479.98, 987.77, 0.075, 0.05, 0.16, 0.32, b1=0.7, b2=0.6, a1=0.6, a2=0.8)
    return finish(x, 0.34)


def skip():
    # "Not today": two low, muted strikes falling a fourth. Soft and warm, never an error buzz.
    x = two_notes(392.0, 293.66, 0.09, 0.05, 0.12, 0.32, b1=0.25, b2=0.2, a1=0.8, a2=1.0)
    x = lowpass(x, 1400)
    t = t_axis(0.32)
    thump = np.sin(glide(t, 180, 110, 0.03)) * env(t, 0.001, 0.04) * 0.6
    return finish(x + thump, 0.36)


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
    # Metric logged: the same mallet, up a fourth instead of a fifth.
    x = two_notes(880.0, 1174.66, 0.085, 0.07, 0.36, 0.5, a1=0.55, a2=0.9)
    return finish(x, 0.5)


if __name__ == "__main__":
    OUT = sys.argv[1]
    for fn in (tick, threshold, check, uncheck, skip, complete, card, log):
        write(fn.__name__, fn())
        print("wrote", fn.__name__)
