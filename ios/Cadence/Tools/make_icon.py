"""Renders Cadence's app icon: a flat white, hand-sketched asterisk on a painted landscape.

The landscape is built in two passes, the way a painting is: first an underpainting (sky,
far mountains in haze, rolling hills, a near meadow, each with its own light), then thousands
of short brush strokes laid over it, large to small, each picking up the underpainting's color
where it lands and following the land's contours. A little canvas grain finishes it.

The asterisk is three uneven strokes drawn like a marker: wobbling a touch along their length,
thicker in the middle, tapering at the ends, not quite evenly spaced. Flat white, no shadow.

Writes three 1024px variants into the folder given as the first argument:
  AppIcon.png         golden-hour landscape (default)
  AppIcon-Dark.png    the same hills at dusk
  AppIcon-Tinted.png  grayscale, for iOS to tint
Run: python3 Tools/make_icon.py Cadence/Assets.xcassets/AppIcon.appiconset   (numpy, scipy, pillow)
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


def vertical(top, bottom, y0, y1):
    """A column gradient from `top` at y0 to `bottom` at y1, as an S×S×3 array."""
    y = np.clip((np.arange(S, dtype=np.float32) - y0) / max(1, y1 - y0), 0, 1)[:, None, None]
    return np.broadcast_to(lerp(hex_rgb(top), hex_rgb(bottom), y), (S, S, 3)).copy()


def ridge(rng, base, amplitude, waves):
    """A hill line across the width: a few soft sine waves plus smoothed noise."""
    x = np.arange(S, dtype=np.float32) / S
    y = np.full(S, base, dtype=np.float32)
    for frequency, weight in waves:
        y += amplitude * weight * np.sin(2 * math.pi * frequency * x + rng.uniform(0, 2 * math.pi))
    y += ndimage.gaussian_filter1d(rng.normal(0, amplitude * 0.5, S), 24)
    return y


def underpainting(palette, rng):
    """Sky, sun glow, haze mountains, hills and meadow, with their outlines for stroke flow."""
    img = vertical(palette["sky_top"], palette["sky_bottom"], 0, S * 0.62)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)

    # A low sun behind the hills: a broad warm glow, not a disc.
    sun = np.exp(-(((xx - S * 0.68) / (S * 0.42)) ** 2 + ((yy - S * 0.56) / (S * 0.3)) ** 2))
    img = lerp(img, np.broadcast_to(hex_rgb(palette["glow"]), img.shape), (sun * palette["glow_strength"])[..., None])

    # Clouds: a few soft banks of overlapping puffs, flat-bottomed, lit from the sun's side.
    clouds = np.zeros((S, S), dtype=np.float32)
    for bank_x, bank_y, spread in ((0.2, 0.2, 0.22), (0.78, 0.13, 0.18), (0.55, 0.32, 0.14)):
        for _ in range(9):
            px = S * (bank_x + rng.normal(0, spread * 0.45))
            py = S * (bank_y + rng.normal(0, 0.02))
            rx, ry = S * rng.uniform(0.05, 0.1), S * rng.uniform(0.03, 0.05)
            puff = ((xx - px) / rx) ** 2 + ((yy - py) / ry) ** 2 <= 1
            clouds = np.maximum(clouds, (puff & (yy <= py + ry * 0.35)).astype(np.float32))
    clouds = ndimage.gaussian_filter(clouds, 14)
    img = lerp(img, np.broadcast_to(hex_rgb(palette["cloud"]), img.shape), (clouds * 0.62)[..., None])

    layers = [
        # (ridge base, amplitude, waves, top color, bottom color)
        (S * 0.50, S * 0.05, [(1.2, 1.0), (2.7, 0.45)], palette["far_top"], palette["far_bottom"]),
        (S * 0.60, S * 0.045, [(0.9, 1.0), (2.1, 0.5)], palette["mid_top"], palette["mid_bottom"]),
        (S * 0.70, S * 0.05, [(0.7, 1.0), (1.9, 0.4)], palette["near_top"], palette["near_bottom"]),
        (S * 0.83, S * 0.035, [(0.6, 1.0), (1.6, 0.5)], palette["front_top"], palette["front_bottom"]),
    ]
    ridges = []
    for base, amplitude, waves, top, bottom in layers:
        line = ridge(rng, base, amplitude, waves)
        ridges.append(line)
        inside = yy >= line[None, :]
        # Each band is lit at its crest and darker toward its foot.
        depth = np.clip((yy - line[None, :]) / (S * 0.22), 0, 1)
        band = lerp(hex_rgb(top), hex_rgb(bottom), depth[..., None])
        # Aerial perspective: the light side of each hill catches the sun.
        lit = np.clip(1 - np.abs(xx - S * 0.68) / (S * 0.9), 0, 1)[..., None] * palette["hill_light"]
        band = lerp(band, np.broadcast_to(hex_rgb(palette["glow"]), band.shape), lit * (1 - depth[..., None]))
        img = np.where(inside[..., None], band, img)
    return np.clip(img, 0, 255), ridges


def flow_angle(x, y, ridges):
    """Strokes follow the slope of the nearest ridge below the sky; in the sky they drift."""
    xi = int(np.clip(x, 1, S - 2))
    for line in reversed(ridges):
        if y >= line[xi] - 6:
            slope = (line[xi + 1] - line[xi - 1]) / 2
            return math.atan(slope)
    return math.radians(-4)


def paint(base, ridges, rng, flecks_amount=1.0):
    """Lays brush strokes over the underpainting, broad to fine, colors picked from beneath."""
    canvas = Image.fromarray(base.astype(np.uint8), "RGB").convert("RGBA")
    passes = [  # (stroke length, width, spacing, jitter, opacity)
        (96, 30, 26, 9, 165),
        (54, 17, 15, 7, 185),
        (28, 9, 9, 5, 205),
    ]
    for length, width, spacing, jitter, alpha in passes:
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        points = [(x, y) for y in range(-spacing, S + spacing, spacing) for x in range(-spacing, S + spacing, spacing)]
        rng.shuffle(points)
        for x0, y0 in points:
            x = x0 + rng.uniform(-spacing, spacing) * 0.6
            y = y0 + rng.uniform(-spacing, spacing) * 0.6
            color = base[int(np.clip(y, 0, S - 1)), int(np.clip(x, 0, S - 1))]
            color = np.clip(color + rng.normal(0, jitter, 3), 0, 255).astype(int)
            angle = flow_angle(x, y, ridges) + rng.normal(0, 0.12)
            half = length * rng.uniform(0.6, 1.0) / 2
            dx, dy = math.cos(angle) * half, math.sin(angle) * half
            w = max(2, int(width * rng.uniform(0.7, 1.1)))
            draw.line([(x - dx, y - dy), (x + dx, y + dy)], fill=(*color, alpha), width=w, joint="curve")
            # Round the stroke's ends, as a brush would.
            r = w / 2
            for cx, cy in ((x - dx, y - dy), (x + dx, y + dy)):
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, alpha))
        canvas = Image.alpha_composite(canvas, layer)
    # Wildflower flecks in the near meadow: small warm dabs, sparse.
    flecks = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flecks)
    front = ridges[-1]
    for _ in range(int(110 * flecks_amount)):
        x = rng.uniform(0, S)
        top = front[int(np.clip(x, 0, S - 1))] + 40
        # Denser toward the bottom, like a field running toward you.
        y = top + (S - top) * math.sqrt(rng.random())
        r = rng.uniform(1.6, 3.4) * (0.7 + 0.6 * (y - top) / max(1, S - top))
        tone = [(250, 226, 168), (246, 206, 196), (252, 248, 236)][int(rng.integers(0, 3))]
        fd.ellipse([x - r * 1.3, y - r, x + r * 1.3, y + r], fill=(*tone, int(200 * flecks_amount)))
    canvas = Image.alpha_composite(canvas, flecks)
    painted = canvas.convert("RGB").filter(ImageFilter.GaussianBlur(0.6))
    # Canvas grain.
    grain = ndimage.gaussian_filter(rng.normal(0, 1, (S, S)).astype(np.float32), 0.8) * 5
    out = np.asarray(painted, dtype=np.float32) + grain[..., None]
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
    base, ridges = underpainting(palette, rng)
    painted = paint(base, ridges, rng, palette["flecks"])
    mark = sketched_asterisk(np.random.default_rng(SEED + 1))[..., None]
    if gray:
        luma = painted @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
        painted = np.repeat(luma[..., None] * 0.55, 3, axis=2)
    out = lerp(painted, np.full_like(painted, 255), mark)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


GOLDEN = {
    "sky_top": "7FA8CC", "sky_bottom": "F6D3A8", "glow": "FFD9A0", "glow_strength": 0.75,
    "cloud": "FBF1E4",
    "far_top": "A9B3C9", "far_bottom": "8E9BB7",
    "mid_top": "93A77F", "mid_bottom": "6F8A63",
    "near_top": "7E9A55", "near_bottom": "5C7A41",
    "front_top": "5F7F3A", "front_bottom": "3E5A2A",
    "hill_light": 0.35,
    "flecks": 1.0,
}

DUSK = {
    "sky_top": "1F2A4A", "sky_bottom": "6A5A7E", "glow": "C98A7A", "glow_strength": 0.55,
    "cloud": "8C7C9A",
    "far_top": "4A5170", "far_bottom": "3C4361",
    "mid_top": "3D4C55", "mid_bottom": "2E3B44",
    "near_top": "2F4036", "near_bottom": "23322A",
    "front_top": "22301F", "front_bottom": "161F14",
    "hill_light": 0.18,
    "flecks": 0.45,
}

if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    compose(GOLDEN, SEED).save(f"{folder}/AppIcon.png")
    compose(DUSK, SEED).save(f"{folder}/AppIcon-Dark.png")
    compose(GOLDEN, SEED, gray=True).save(f"{folder}/AppIcon-Tinted.png")
    print("wrote", folder)
