"""Renders Cadence's app icon: a flat white, hand-sketched asterisk on a painted landscape.

The landscape is suggested rather than drawn: soft bands of color (sky, a warm horizon,
land) laid down first, then loaded brush strokes on top, broad to fine, each a bundle of
bristle lines that shows the texture of the paint, mostly horizontal with a quick hand's
drift. A few light and dark accent strokes and some canvas grain finish it.

The asterisk is three uneven strokes drawn like a marker: wobbling a touch along their length,
thicker in the middle, tapering at the ends, not quite evenly spaced. Flat white, no shadow.

Writes three 1024px variants into the folder given as the first argument:
  AppIcon.png         golden hour (default)
  AppIcon-Dark.png    the same at dusk
  AppIcon-Tinted.png  grayscale, for iOS to tint
Run: python3 Tools/make_icon.py Cadence/Assets.xcassets/AppIcon.appiconset   (numpy, scipy, pillow)
     python3 Tools/make_icon.py --launch Cadence/Assets.xcassets/LaunchMark.imageset
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

S = 1024
SEED = 7


def lerp(a, b, t):
    return a + (b - a) * t


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def field(stops, rng):
    """The underpainting: soft horizontal bands of color (sky, a warm horizon, land) with a
    gently wavering horizon. No shapes: the brushwork on top does the describing."""
    y = np.arange(S, dtype=np.float32)[:, None] / S
    x = np.arange(S, dtype=np.float32)[None, :] / S
    # The horizon wavers a little across the width, as a quick wash would.
    wave = 0.018 * np.sin(2 * math.pi * (x * 0.9 + rng.uniform(0, 1))) + 0.01 * np.sin(2 * math.pi * (x * 2.3 + rng.uniform(0, 1)))
    t = np.clip(y + wave, 0, 1)
    positions = np.array([p for p, _ in stops], dtype=np.float32)
    colors = np.stack([hex_rgb(c) for _, c in stops])
    out = np.zeros((S, S, 3), dtype=np.float32)
    for channel in range(3):
        out[..., channel] = np.interp(t.ravel(), positions, colors[:, channel]).reshape(S, S)
    return out


def bristle_stroke(draw, rng, x, y, angle, length, width, color, alpha):
    """One loaded brush stroke: a bundle of bristle lines across its width, each a slightly
    different tone and length, so the stroke shows its texture and dry edges."""
    ux, uy = math.cos(angle), math.sin(angle)
    nx, ny = -uy, ux
    bristles = max(4, int(width / 3))
    for b in range(bristles):
        across = (b / (bristles - 1) - 0.5) * width
        start = rng.uniform(0, 0.12) * length
        stop = length * rng.uniform(0.82, 1.0)
        tone = np.clip(color + rng.normal(0, 10, 3), 0, 255).astype(int)
        a = alpha * rng.uniform(0.5, 1.0)
        # Bristles bow along the stroke, and each lifts off at its ends (paint running dry).
        bow = rng.normal(0, width * 0.12)
        w = max(2, int(width / bristles * rng.uniform(1.3, 2.1)))
        steps = 8
        previous = None
        for k in range(steps + 1):
            f = start + (stop - start) * k / steps
            curve = bow * math.sin(math.pi * k / steps)
            px = x + ux * (f - length / 2) + nx * (across + curve)
            py = y + uy * (f - length / 2) + ny * (across + curve)
            if previous is not None:
                edge = min(k, steps + 1 - k) / 2.5
                fade = int(a * min(1.0, edge))
                draw.line([previous, (px, py)], fill=(*tone, fade), width=w)
            previous = (px, py)


def paint(base, rng, accents):
    """Lays loaded strokes over the bands, broad to fine, each taking its color from the
    band beneath it, mostly horizontal with the drift of a quick hand. Then a few light and
    dark accent strokes, and canvas grain."""
    canvas = Image.fromarray(base.astype(np.uint8), "RGB").convert("RGBA")
    passes = [  # (length, width, spacing, angle spread, alpha)
        (300, 70, 54, 0.10, 190),
        (170, 40, 32, 0.14, 205),
        (80, 18, 18, 0.2, 215),
    ]
    for length, width, spacing, spread, alpha in passes:
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        points = [(x, y) for y in range(-spacing, S + spacing, spacing) for x in range(-spacing * 2, S + spacing * 2, spacing * 2)]
        rng.shuffle(points)
        for x0, y0 in points:
            x = x0 + rng.uniform(-spacing, spacing)
            y = y0 + rng.uniform(-spacing, spacing) * 0.5
            color = base[int(np.clip(y, 0, S - 1)), int(np.clip(x, 0, S - 1))] + rng.normal(0, 11, 3)
            # Sky strokes lean a little; land strokes lie flatter.
            lean = -0.07 if y < S * 0.5 else 0.02
            angle = lean + rng.normal(0, spread * (1.5 if y < S * 0.45 else 1.0))
            bristle_stroke(draw, rng, x, y, angle, length * rng.uniform(0.7, 1.15), width * rng.uniform(0.75, 1.1), color, alpha)
        canvas = Image.alpha_composite(canvas, layer)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for hexcolor, band, count, alpha in accents:
        for _ in range(count):
            x = rng.uniform(0, S)
            y = rng.uniform(band[0], band[1]) * S
            bristle_stroke(draw, rng, x, y, rng.normal(0, 0.12), rng.uniform(60, 130), rng.uniform(22, 38), hex_rgb(hexcolor), alpha)
    canvas = Image.alpha_composite(canvas, layer)

    painted = canvas.convert("RGB").filter(ImageFilter.GaussianBlur(0.5))
    grain = ndimage.gaussian_filter(rng.normal(0, 1, (S, S)).astype(np.float32), 0.7) * 6
    weave = (np.sin(np.arange(S)[:, None] * 1.9) * np.sin(np.arange(S)[None, :] * 1.9)) * 1.6
    out = np.asarray(painted, dtype=np.float32) + (grain + weave)[..., None]
    return np.clip(out, 0, 255)


def sketched_asterisk(rng):
    """A white, hand-drawn asterisk as an alpha mask: three marker strokes, each its own.

    Each stroke bends a little and wanders along its length, swells and thins unevenly, ends
    in a round marker tip, and crosses near (not exactly at) the center, the way a quick
    sketch does. Drawn at 4x and downsampled for clean edges.
    """
    scale = 4
    W = S * scale
    mask = Image.new("L", (W, W), 0)
    draw = ImageDraw.Draw(mask)
    strokes = [  # angle, reach on each side, weight, bend
        (94, 0.300, 0.262, 1.00, 0.012),
        (31, 0.286, 0.298, 0.92, -0.010),
        (-27, 0.305, 0.270, 1.06, 0.008),
    ]
    for angle_deg, reach_a, reach_b, weight, bend in strokes:
        angle = math.radians(angle_deg + rng.normal(0, 1.5))
        ux, uy = math.cos(angle), -math.sin(angle)
        nx, ny = -uy, ux
        cx = W * (0.5 + rng.normal(0, 0.006))
        cy = W * (0.5 + rng.normal(0, 0.006))
        steps = 140
        wander = ndimage.gaussian_filter1d(rng.normal(0, 1, steps), 12) * W * 0.004
        swell = 1 + ndimage.gaussian_filter1d(rng.normal(0, 1, steps), 10) * 0.9
        for i in range(steps):
            s_ = i / (steps - 1)
            t = lerp(-reach_b, reach_a, s_)
            # A gentle arc plus a little wander off the line.
            off = bend * W * (1 - (2 * s_ - 1) ** 2) + wander[i]
            x = cx + ux * t * W + nx * off
            y = cy + uy * t * W + ny * off
            # Marker weight: even-ish, swelling unevenly, easing slightly at the tips.
            w = W * 0.064 * weight * float(np.clip(swell[i], 0.82, 1.18)) * (0.88 + 0.12 * math.sin(math.pi * s_))
            r = w / 2
            draw.ellipse([x - r, y - r, x + r, y + r], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(scale * 0.35)).resize((S, S), Image.LANCZOS)
    return np.asarray(mask, dtype=np.float32) / 255


def compose(palette, seed, gray=False):
    rng = np.random.default_rng(seed)
    painted = paint(field(palette["stops"], rng), rng, palette["accents"])
    mark = sketched_asterisk(np.random.default_rng(SEED + 1))[..., None]
    if gray:
        luma = painted @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
        painted = np.repeat(luma[..., None] * 0.55, 3, axis=2)
    out = lerp(painted, np.full_like(painted, 255), mark)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


# Color stops top to bottom (sky, a warm horizon, land) and accent strokes:
# (color, band of the height they land in, how many, opacity).
GOLDEN = {
    "stops": [(0.0, "7FA4C9"), (0.3, "A8C1D7"), (0.47, "F1D3B0"), (0.55, "E2BE92"), (0.63, "A7B47E"), (1.0, "4E6D3A")],
    "accents": [("FBEBD2", (0.4, 0.55), 7, 120), ("DCE6EE", (0.06, 0.3), 5, 100), ("3F5A2E", (0.76, 1.0), 4, 100)],
}

DUSK = {
    "stops": [(0.0, "1C2442"), (0.32, "3E3F68"), (0.47, "8C6D88"), (0.55, "6F5B76"), (0.63, "3B4B46"), (1.0, "151E17")],
    "accents": [("C99A9C", (0.42, 0.55), 6, 110), ("5A5F8C", (0.08, 0.3), 5, 100), ("10170F", (0.78, 1.0), 4, 100)],
}


def launch_mark(folder, points=96):
    """The asterisk alone, white on clear, for the launch screen: 1x, 2x and 3x."""
    mask = sketched_asterisk(np.random.default_rng(SEED + 1))
    # The asterisk spans about 62% of the icon; crop to it so `points` is the mark's own size.
    ys, xs = np.nonzero(mask > 0.02)
    pad = 8
    crop = mask[max(0, ys.min() - pad):ys.max() + pad, max(0, xs.min() - pad):xs.max() + pad]
    side = max(crop.shape)
    square = np.zeros((side, side), dtype=np.float32)
    oy, ox = (side - crop.shape[0]) // 2, (side - crop.shape[1]) // 2
    square[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = crop
    alpha = Image.fromarray((square * 255).astype(np.uint8), "L")
    for scale, suffix in ((1, ""), (2, "@2x"), (3, "@3x")):
        size = points * scale
        a = alpha.resize((size, size), Image.LANCZOS)
        img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        img.putalpha(a)
        img.save(f"{folder}/LaunchMark{suffix}.png")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--launch":
        launch_mark(sys.argv[2])
        print("wrote launch mark to", sys.argv[2])
        sys.exit()
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    compose(GOLDEN, SEED).save(f"{folder}/AppIcon.png")
    compose(DUSK, SEED).save(f"{folder}/AppIcon-Dark.png")
    compose(GOLDEN, SEED, gray=True).save(f"{folder}/AppIcon-Tinted.png")
    print("wrote", folder)
