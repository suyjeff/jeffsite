import sys
from PIL import Image, ImageDraw, ImageFilter
S = 1024
SS = 4  # supersample
W = S * SS
def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
top, bottom = (0x8C, 0x7B, 0x8F), (0x4F, 0x41, 0x51)
bg = Image.new("RGB", (W, W))
d = ImageDraw.Draw(bg)
for y in range(W):
    d.line([(0, y), (W, y)], fill=lerp(top, bottom, y / W))
def card(img, box, r, fill, shadow_alpha):
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([box[0], box[1] + 28 * SS, box[2], box[3] + 28 * SS], r, fill=(30, 20, 32, shadow_alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(40 * SS))
    img.alpha_composite(sh)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, r, fill=fill)
    img.alpha_composite(layer)
img = bg.convert("RGBA")
m = 250 * SS
# back card: narrower, peeking above
card(img, [m + 46 * SS, 268 * SS, W - m - 46 * SS, 700 * SS], 64 * SS, (0xE9, 0xE3, 0xEA, 255), 70)
# front card
card(img, [m, 318 * SS, W - m, 774 * SS], 72 * SS, (0xFA, 0xFA, 0xFA, 255), 110)
# checkmark on the front card
ck = ImageDraw.Draw(img)
pts = [(392 * SS, 548 * SS), (478 * SS, 630 * SS), (640 * SS, 462 * SS)]
ck.line(pts, fill=(0x79, 0x69, 0x7B, 255), width=44 * SS, joint="curve")
for p in (pts[0], pts[2]):
    rr = 22 * SS
    ck.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=(0x79, 0x69, 0x7B, 255))
img = img.convert("RGB").resize((S, S), Image.LANCZOS)
img.save(sys.argv[1])
