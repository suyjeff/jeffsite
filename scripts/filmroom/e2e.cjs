// Film-room end-to-end acceptance, keyboard only. Run against a dev or static server:
//
//   node scripts/filmroom/e2e.cjs http://localhost:3000/filmroom
//
// Asserts: golden query → exactly its positives · <50 ms filter · frame stepping lands on the exact frame
// (read back from the burned-in barcode in the decoded video, not from our own counter) · clip-to-clip transition
// < 100 ms with no blank frame · chord tagging from the keyboard · URL round-trips query + play + frame + view ·
// CLS = 0. Needs the `playwright` package and a Chromium.

const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:3123/filmroom";
const GOLDEN = "shooter:curry shot:3pt zone:right_wing action:pindown closeouts:2+ lineup:+green opp.div:pacific q:3 result:make ast:true";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function readBarcode(page) {
  return page.evaluate(() => {
    const vids = [...document.querySelectorAll("video.fr-video")];
    const v = vids.find((x) => x.style.opacity === "1" && x.style.zIndex === "2") || vids.find((x) => x.style.opacity === "1");
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0);
    const sx = c.width / 640;
    const sy = c.height / 360;
    const lum = (x, y) => {
      const d = ctx.getImageData(Math.round(x * sx), Math.round(y * sy), 1, 1).data;
      return (d[0] + d[1] + d[2]) / 3;
    };
    if (lum(48, 350) < 50) return null; // guard block missing: not proxy film
    let n = 0;
    for (let b = 0; b < 16; b++) n = n * 2 + (lum(64 + b * 32 + 15, 350) > 55 ? 1 : 0);
    return n;
  });
}

// Minimal PNG decoder (8-bit, non-interlaced RGB/RGBA) for reading compositor screenshots: cross-origin film taints
// canvas readback, but what reached the screen can always be read back from a screenshot.
function decodePng(buf) {
  const zlib = require("zlib");
  let w = 0, h = 0, ct = 0;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * stride + x] = r & 255;
    }
  }
  return { w, h, lum: (x, y) => { const i = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * bpp; return (px[i] + px[i + 1] + px[i + 2]) / 3; } };
}

async function readBarcodeScreen(page) {
  const r = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video.fr-video")];
    const v = vids.find((x) => x.style.opacity === "1" && x.style.zIndex === "2") || vids.find((x) => x.style.opacity === "1");
    if (!v || !v.videoWidth) return null;
    const b = v.getBoundingClientRect();
    const s = Math.min(b.width / v.videoWidth, b.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    return { x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2, width: w, height: h };
  });
  if (!r) return null;
  const hide = (v) => page.evaluate((v) => document.querySelectorAll("[data-testid=viewport] > :not([class*=stage])").forEach((e) => (e.style.visibility = v)), v);
  await hide("hidden");
  const img = decodePng(await page.screenshot({ clip: r }));
  await hide("");
  const sx = img.w / 640, sy = img.h / 360;
  const lum = (x, y) => img.lum(Math.round(x * sx), Math.round(y * sy));
  if (lum(48, 350) < 50) return null;
  let n = 0;
  for (let b = 0; b < 16; b++) n = n * 2 + (lum(64 + b * 32 + 15, 350) > 55 ? 1 : 0);
  return n;
}

const hudFrame = async (page) => Number((await page.textContent("[data-testid=hud-frame]")).match(/F (\d+)/)[1]);
const settle = (page, ms = 250) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        if (!e.hadRecentInput) {
          window.__cls += e.value;
          window.__shifts.push(`${e.value.toExponential(2)} @${Math.round(e.startTime)}ms ` + (e.sources || []).map((s) => `${s.node && s.node.nodeName === "#text" ? "text:" + (s.node.parentElement && s.node.parentElement.className) : s.node && s.node.className} ${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)}`).join(" | "));
        }
    }).observe({ type: "layout-shift", buffered: true });
    try {
      localStorage.clear();
    } catch {}
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForSelector("[data-testid=inspector]");
  await settle(page, 800);

  // 1 · query entry from the keyboard, golden compound query
  await page.keyboard.press("/");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(GOLDEN, { delay: 0 });
  await page.keyboard.press("Escape"); // close suggestions
  await page.keyboard.press("Enter");
  await settle(page, 600);
  const count = await page.textContent("[data-testid=count]");
  check("golden query returns exactly 2 verified clips", /^2 plays/.test(count.trim()), count.trim());
  const ms = Number((await page.textContent("[data-testid=filter-ms]")).replace("ms", ""));
  check("filter execution < 50 ms", ms < 50, `${ms} ms`);
  const desc = await page.textContent("[data-testid=inspector]");
  check("first result is the 2023-11-30 Curry make (Q3 10:34)", /Q3 10:34/.test(desc) && /Curry/.test(desc));

  // 2 · frame-accurate stepping, verified against the decoded frame's barcode
  await page.keyboard.press("0");
  await settle(page, 400);
  let ok = true;
  const trail = [];
  for (const key of [".", ".", ".", ",", ">", "<", ",", "."]) {
    await page.keyboard.press(key);
    await settle(page, 180);
    const bar = await readBarcode(page);
    const hud = await hudFrame(page);
    trail.push(`${key}:${hud}/${bar}`);
    if (bar === null || Math.abs(bar - hud) > 0) ok = false;
  }
  const at0 = await page.textContent("[data-testid=hud-rel]");
  check("frame stepping: HUD frame equals decoded barcode on every step (±0)", ok, trail.join(" "));
  void at0;

  // 3 · reel transitions on a bigger reel
  await page.keyboard.press("/");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("shooter:curry shot:3pt result:make opp.div:pacific", { delay: 0 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await settle(page, 1200);
  const xfers = [];
  let blank = 0;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("]");
    await settle(page, 450);
    const x = (await page.textContent("[data-testid=hud-xfer]")).match(/(\d+)ms/);
    if (x) xfers.push(Number(x[1]));
    const visible = await page.evaluate(() => [...document.querySelectorAll("video.fr-video")].filter((v) => v.style.opacity === "1" && v.readyState >= 2).length);
    if (visible < 1) blank++;
  }
  xfers.sort((a, b) => a - b);
  const med = xfers[Math.floor(xfers.length / 2)];
  check("clip-to-clip transition < 100 ms (median of 8)", med < 100, `median ${med} ms · all ${xfers.join(",")}`);
  check("no blank frame on transitions (a decoded element is always revealed)", blank === 0, `${blank} blank`);

  // 4 · playback + JKL shuttle
  await page.keyboard.press("l");
  await settle(page, 300);
  await page.keyboard.press("l");
  await settle(page, 300);
  const rate = await page.textContent("[data-testid=hud-rate]");
  await page.keyboard.press("k");
  check("L L shuttles to 2×, K stops", /2×/.test(rate), rate);

  // 5 · chord tagging: mark window, T p d 2 ⏎, then repeat on next clip with Shift+T
  await page.keyboard.press("0");
  await settle(page, 200);
  for (let i = 0; i < 30; i++) await page.keyboard.press(",");
  await page.keyboard.press("i");
  await page.keyboard.press("0");
  await page.keyboard.press("o");
  await page.keyboard.press("t");
  const chordShown = await page.isVisible("[data-testid=chord]");
  await page.keyboard.press("p");
  await page.keyboard.press("d");
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await settle(page, 200);
  await page.keyboard.press("]");
  await settle(page, 400);
  await page.keyboard.press("Shift+T");
  await settle(page, 200);
  const tags = await page.evaluate(() => JSON.parse(localStorage.getItem("filmroom.tags.v1") || "[]"));
  check("chord tagging stamps (action, coverage, closeouts) on [t_in, t_out] and Shift+T repeats", chordShown && tags.length === 2 && tags[0].act === "pindown" && tags[0].cov === "drop" && tags[0].co === "2" && Math.abs(tags[0].tIn + 30 / 29.97) < 0.04 && tags[0].tOut === 0, JSON.stringify(tags.map((t) => [t.act, t.cov, t.co, t.tIn, t.tOut])));
  await page.keyboard.press("/");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("action:pindown cov:drop closeouts:2+", { delay: 0 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await settle(page, 600);
  const tc = (await page.textContent("[data-testid=count]")).trim();
  check("fresh tags are immediately queryable", /^2 plays/.test(tc), tc);

  // 6 · views
  for (const v of ["tape", "shotmap", "timeline"]) {
    await page.keyboard.press("v");
    await settle(page, 300);
    check(`V cycles to ${v}`, await page.isVisible(`[data-testid=${v}]`));
  }

  // 7 · deterministic URL: step to a frame, share, reopen in a fresh page
  await page.keyboard.press("/");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("shooter:curry shot:3pt zone:corner_3 q:4", { delay: 0 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await settle(page, 800);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await settle(page, 500);
  await page.keyboard.press("0");
  for (let i = 0; i < 7; i++) await page.keyboard.press(".");
  await page.keyboard.press("v");
  await settle(page, 800);
  const url = page.url();
  const frameHere = await hudFrame(page);
  const clipHere = await page.textContent("[data-testid=clip-index]");
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await p2.goto(url, { waitUntil: "networkidle" });
  await p2.waitForSelector("[data-testid=inspector]");
  await settle(p2, 1500);
  const frameThere = await hudFrame(p2);
  const clipThere = await p2.textContent("[data-testid=clip-index]");
  const viewThere = await p2.isVisible("[data-testid=tape]");
  check("URL restores query, clip, exact frame and view", frameHere === frameThere && clipHere === clipThere && viewThere, `${url.split("?")[1]} · frame ${frameHere}→${frameThere} · clip ${clipHere}→${clipThere}`);

  // 8 · local game film: open a file for this game, sync t₀ with Shift+A, and t₀ now lands on that frame
  const film = require("path").join(__dirname, "../../public/filmroom-assets/proxy/p3.webm");
  await page.setInputFiles('input[type=file][accept="video/*"]', film);
  await settle(page, 1200);
  const badge = await page.textContent("[data-testid=viewport]");
  for (let i = 0; i < 5; i++) await page.keyboard.press(">");
  await settle(page, 300);
  const anchorFrame = await hudFrame(page);
  await page.keyboard.press("Shift+A");
  await settle(page, 800);
  await page.keyboard.press(">");
  await settle(page, 300);
  await page.keyboard.press("0");
  await settle(page, 400);
  const backAt = await hudFrame(page);
  const bar = await readBarcode(page);
  check("local film: GAME FILM source, Shift+A anchors t₀ to the frame on screen", /GAME FILM/.test(badge) && backAt === anchorFrame && bar === anchorFrame, `anchor ${anchorFrame} · t₀ now ${backAt} · decoded ${bar}`);

  // 9 · real film from another origin: attach by URL, pin in film view (S), then every play in the game maps by
  // wall clock. Frames are read back from the screen, since cross-origin film can't be read through a canvas.
  const { spawn } = require("child_process");
  const host = spawn(process.execPath, [require("path").join(__dirname, "serve-static.cjs"), require("path").join(__dirname, "../../public/filmroom-assets/proxy"), "4181"], { stdio: "ignore" });
  await settle(page, 500);
  try {
    await page.keyboard.press("/");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("game:2023-11-28 side:off", { delay: 0 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await settle(page, 800);
    await page.keyboard.press("Home");
    await settle(page, 600);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("http://localhost:4181/p2.webm", { delay: 0 });
    await settle(page, 200);
    await page.keyboard.press("Enter");
    await settle(page, 1500);
    const fv = await page.textContent("[data-testid=film-badge]");
    await page.keyboard.press("k");
    await page.keyboard.press("0");
    for (let i = 0; i < 3; i++) await page.keyboard.press(">");
    await settle(page, 500);
    const pinned = await hudFrame(page);
    const pinnedScreen = await readBarcodeScreen(page);
    await page.keyboard.press("s");
    await settle(page, 200);
    await page.keyboard.press("[");
    await page.keyboard.press("f");
    await settle(page, 1200);
    await page.keyboard.press("0");
    await settle(page, 500);
    const clipBadge = await page.textContent("[data-testid=film-badge]");
    const atT0 = await hudFrame(page);
    const atT0Screen = await readBarcodeScreen(page);
    check(
      "URL film (cross-origin): film view, S pins the frame on screen, the play then plays from real film at t₀",
      /FILM VIEW/.test(fv) && /GAME FILM/.test(clipBadge) && pinned === pinnedScreen && atT0 === pinned && atT0Screen === pinned,
      `pinned ${pinned} (screen ${pinnedScreen}) · clip t₀ ${atT0} (screen ${atT0Screen}) · ${fv.trim()} → ${clipBadge.trim()}`,
    );
    const shared = page.url();
    const p3 = await browser.newPage({ viewport: { width: 1600, height: 960 } });
    await p3.goto(shared, { waitUntil: "networkidle" });
    await p3.waitForSelector("[data-testid=inspector]");
    await settle(p3, 1500);
    await p3.keyboard.press("0");
    await settle(p3, 600);
    const again = await hudFrame(p3);
    check("share link carries the film and its pins to a fresh browser", /film=/.test(shared) && /GAME FILM/.test(await p3.textContent("[data-testid=film-badge]")) && again === pinned, `t₀ frame ${again}`);
    await p3.close();
  } finally {
    host.kill();
  }

  // 10 · layout stability
  const cls = await page.evaluate(() => window.__cls);
  check("CLS = 0", cls === 0, cls === 0 ? "0" : `${cls} · ${(await page.evaluate(() => window.__shifts)).join(" ;; ")}`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  await page.screenshot({ path: process.env.SHOT || "/tmp/filmroom-e2e.png" });
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
