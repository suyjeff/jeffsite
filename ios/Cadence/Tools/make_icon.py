"""Renders Cadence's app icon: one thick asterisk made of frosted glass.

The glass is shaded from a height map (a blurred mask of the shape), so the arms read as
rounded and lit from the top left: a soft body gradient, a bright specular edge where the
light catches, a darker refracted rim on the far side, and a contact shadow below.

Writes three 1024px variants into the folder given as the first argument:
  AppIcon.png         plum background (default)
  AppIcon-Dark.png    glass on a transparent background (iOS draws the dark backdrop)
  AppIcon-Tinted.png  grayscale glass on transparent (iOS applies the tint)
"""
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage   # pip install scipy numpy pillow

S = 1024
SS = 2           # supersampling
W = S * SS


def capsule_mask(angle_deg, length, thickness):
    """A rounded bar through the center, rotated by angle."""
    layer = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(layer)
    cx = cy = W / 2
    half = length / 2
    r = thickness / 2
    d.rounded_rectangle([cx - half, cy - r, cx + half, cy + r], radius=r, fill=255)
    return layer.rotate(angle_deg, resample=Image.BICUBIC, center=(cx, cy))


def asterisk_mask():
    length, thickness = 600 * SS, 168 * SS
    mask = np.zeros((W, W), dtype=np.float32)
    for angle in (90, 30, -30):
        mask = np.maximum(mask, np.asarray(capsule_mask(angle, length, thickness), dtype=np.float32) / 255)
    return mask


def blur(arr, radius):
    return ndimage.gaussian_filter(arr.astype(np.float32), sigma=radius / 2)


def background():
    y = np.linspace(0, 1, W)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    top = np.array([0x93, 0x81, 0x96], dtype=np.float32) / 255
    bottom = np.array([0x45, 0x37, 0x48], dtype=np.float32) / 255
    t = np.clip(0.75 * y + 0.25 * x, 0, 1)[..., None]
    bg = top * (1 - t) + bottom * t
    # A faint glow behind the mark, so the glass has something to refract.
    r = np.sqrt((x - 0.5) ** 2 + (y - 0.46) ** 2)
    glow = np.clip(1 - r / 0.55, 0, 1) ** 2 * 0.10
    return np.clip(bg + glow[..., None], 0, 1)


ARM_RADIUS = 84 * SS


def shade_glass(mask, behind, gray=False):
    """Returns (rgb, alpha) for the glass mark composited over `behind`."""
    # A true rounded cross-section: height from the exact distance to the edge.
    inside = mask > 0.5
    dist = ndimage.distance_transform_edt(inside).astype(np.float32)
    t = np.clip(dist / ARM_RADIUS, 0, 1)
    height = np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1)) * ARM_RADIUS * 0.55
    height = ndimage.gaussian_filter(height, 2 * SS)
    gy, gx = np.gradient(height)
    normal = np.dstack([-gx, -gy, np.ones_like(height)])
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)

    light = np.array([-0.45, -0.7, 0.55])
    light /= np.linalg.norm(light)
    lambert = np.clip((normal * light).sum(axis=2), 0, 1)
    half = light + np.array([0.0, 0.0, 1.0])
    half /= np.linalg.norm(half)
    spec = np.clip((normal * half).sum(axis=2), 0, 1) ** 90

    tilt = np.clip(1 - normal[..., 2], 0, 1)
    facing = normal[..., 0] * light[0] + normal[..., 1] * light[1]
    toward = np.clip(facing / (np.hypot(light[0], light[1]) + 1e-6), 0, 1)
    away = np.clip(-facing / (np.hypot(light[0], light[1]) + 1e-6), 0, 1)

    # Frosted body: the backdrop blurred and lifted, so its color shows through.
    frosted = np.dstack([blur(behind[..., c], 30 * SS) for c in range(3)])
    body = frosted * 0.58 + 0.42
    y = np.linspace(0, 1, W)[:, None, None]
    body = body * (1.05 - 0.14 * y)
    body = body * (0.78 + 0.26 * lambert[..., None])
    # Bright caustic where light enters; a darker, plum-tinted refraction on the far edge.
    body = body + (0.55 * (toward * tilt) ** 1.2)[..., None]
    tint = np.array([0x55, 0x43, 0x59], dtype=np.float32) / 255
    k = np.clip((away * tilt) ** 0.9 * 1.4, 0, 0.7)[..., None]
    body = body * (1 - k) + tint * k
    body = body + 0.85 * spec[..., None]
    # Light passing through exits as a soft glow just inside the far edge (the caustic
    # that makes a solid read as glass rather than plastic).
    band = np.exp(-((t - 0.38) / 0.16) ** 2)
    caustic = ndimage.gaussian_filter(band * away, 6 * SS)
    body = body + (0.38 * caustic)[..., None]
    # A hairline bright edge all around, like the lip of a glass bead.
    lip = np.clip(1 - dist / (2.5 * SS), 0, 1) * mask
    body = body + 0.25 * lip[..., None]
    body = np.clip(body, 0, 1)

    if gray:
        lum = body @ np.array([0.299, 0.587, 0.114])
        body = np.dstack([lum, lum, lum])

    alpha = np.clip(mask * (0.9 + 0.1 * tilt), 0, 1)
    return body, alpha


def composite(under_rgb, under_a, over_rgb, over_a):
    out_a = over_a + under_a * (1 - over_a)
    safe = np.maximum(out_a, 1e-6)[..., None]
    out_rgb = (over_rgb * over_a[..., None] + under_rgb * under_a[..., None] * (1 - over_a[..., None])) / safe
    return out_rgb, out_a


def contact_shadow(mask, strength):
    shifted = np.roll(mask, 26 * SS, axis=0)
    soft = blur(shifted, 30 * SS) * strength
    return np.zeros((W, W, 3), dtype=np.float32) + np.array([0.14, 0.09, 0.15]), soft


def save(rgb, alpha, path, keep_alpha):
    rgba = np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)])
    img = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA").resize((S, S), Image.LANCZOS)
    if not keep_alpha:
        img = img.convert("RGB")   # the App Store icon must be opaque
    img.save(path)


def main(out_dir):
    mask = asterisk_mask()

    # Default: glass on the plum gradient.
    bg = background()
    ones = np.ones((W, W), dtype=np.float32)
    sh_rgb, sh_a = contact_shadow(mask, 0.45)
    rgb, a = composite(bg, ones, sh_rgb, sh_a)
    glass_rgb, glass_a = shade_glass(mask, rgb)
    rgb, a = composite(rgb, a, glass_rgb, glass_a)
    save(rgb, a, f"{out_dir}/AppIcon.png", keep_alpha=False)

    # Dark: transparent background, glass refracting a dark plum.
    dark_behind = np.zeros((W, W, 3), dtype=np.float32) + np.array([0.22, 0.17, 0.23])
    sh_rgb, sh_a = contact_shadow(mask, 0.5)
    glass_rgb, glass_a = shade_glass(mask, dark_behind)
    rgb, a = composite(sh_rgb, sh_a, glass_rgb, glass_a)
    save(rgb, a, f"{out_dir}/AppIcon-Dark.png", keep_alpha=True)

    # Tinted: grayscale glass, transparent background.
    glass_rgb, glass_a = shade_glass(mask, dark_behind, gray=True)
    save(glass_rgb, glass_a, f"{out_dir}/AppIcon-Tinted.png", keep_alpha=True)


if __name__ == "__main__":
    main(sys.argv[1])
