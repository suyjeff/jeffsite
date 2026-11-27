// Gapless virtual reel over many short clips from many games.
//
// A ring of three <video> elements (active · next · previous) is stacked in one box. The standby elements are
// loaded and *pre-seeked to their in-point* while the active clip plays, so a clip change is a compositor-only
// opacity swap of an element that already holds a decoded frame — no black flash, no decode on the critical path.
// An element is never revealed before it has a frame (readyState ≥ HAVE_CURRENT_DATA after its seek); if the
// user outruns the buffer, the old frame stays up with a buffering flag until the new one is ready.
//
// Clips are addressed relative to their sync anchor t₀ (the shot / turnover / whistle), so every clip in a reel
// lines up on the release point whatever its source: NBA pbp MP4s, a window into full-game film, or proxy film.
// Frame identity comes from requestVideoFrameCallback's mediaTime (presented frame), not currentTime.

import { YouTubeMedia } from "./youtube";

export type ClipKind = "nba" | "local" | "youtube" | "proxy";

/** The media surface the reel drives: a <video>, or YouTube's player behind the same interface. */
type Media = HTMLVideoElement | YouTubeMedia;

export interface Clip {
  key: string;
  src: string;
  kind: ClipKind;
  fps: number;
  /** Media time (s) of the sync anchor t₀ in `src`. */
  t0: number;
  /** Window relative to t₀, in seconds (pre-roll negative). */
  from: number;
  to: number;
}

export interface FrameState {
  index: number;
  key: string;
  kind: ClipKind | null;
  fps: number;
  /** Presented frame number in the media. */
  frame: number;
  /** Frames relative to t₀. */
  rel: number;
  /** Seconds relative to t₀ (frame-quantised). */
  sec: number;
  from: number;
  to: number;
  rate: number;
  playing: boolean;
  buffering: boolean;
  /** Last clip-to-clip transition: command → first presented frame of the new clip, ms. */
  xferMs: number | null;
  /** True once the presented frame is confirmed by rVFC (vs. estimated from currentTime). */
  exact: boolean;
}

interface Slot {
  el: Media;
  clip: Clip | null;
  index: number;
  ready: boolean;
  pending: Promise<void> | null;
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number; presentedFrames: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

const RATES = [1, 2, 4, 8];

export class ReelController {
  private slots: Slot[];
  private active = 0;
  private index = -1;
  private rate = 0; // signed shuttle rate; 0 = paused
  private reverseRaf = 0;
  private rvfc = 0;
  private raf = 0;
  private lastFrame = -1;
  /** Frame a step/seek is heading for; stale rVFC callbacks for earlier frames must not overwrite it. */
  private target: number | null = null;
  private exact = false;
  private xferMs: number | null = null;
  private xferStart = 0;
  private buffering = false;
  private destroyed = false;
  private autoAdvance = true;
  private gen = 0;

  constructor(
    private host: HTMLElement,
    private clipAt: (i: number) => Clip | null,
    private count: () => number,
    private onFrame: (s: FrameState) => void,
    private onIndex: (i: number) => void,
  ) {
    this.slots = [0, 1, 2].map((k) => {
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.disablePictureInPicture = true;
      el.setAttribute("data-slot", String(k));
      el.className = "fr-video";
      el.style.opacity = "0";
      el.addEventListener("waiting", () => this.slotEvent(k, "waiting"));
      el.addEventListener("playing", () => this.slotEvent(k, "playing"));
      el.addEventListener("ended", () => this.slotEvent(k, "ended"));
      host.appendChild(el);
      return { el, clip: null, index: -1, ready: false, pending: null } as Slot;
    });
    this.loop();
  }

  /** YouTube film lives in its own slot (one player, one video at a time), created on first use. */
  private ytSlot(): number {
    let k = this.slots.findIndex((s) => s.el instanceof YouTubeMedia);
    if (k >= 0) return k;
    const el = new YouTubeMedia(this.host);
    k = this.slots.length;
    const idx = k;
    el.addEventListener("waiting", () => this.slotEvent(idx, "waiting"));
    el.addEventListener("playing", () => this.slotEvent(idx, "playing"));
    el.addEventListener("ended", () => this.slotEvent(idx, "ended"));
    this.slots.push({ el, clip: null, index: -1, ready: false, pending: null });
    return k;
  }
  private isYt = (k: number) => this.slots[k]?.el instanceof YouTubeMedia;

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.reverseRaf);
    for (const s of this.slots) {
      s.el.pause();
      s.el.removeAttribute("src");
      s.el.load();
      s.el.remove();
    }
  }

  get current(): Clip | null {
    return this.slots[this.active].clip;
  }
  get activeElement(): Media {
    return this.slots[this.active].el;
  }

  setAutoAdvance(v: boolean) {
    this.autoAdvance = v;
  }

  private slotEvent(k: number, kind: string) {
    if (k !== this.active) return;
    if (kind === "waiting") this.buffering = true;
    if (kind === "playing") this.buffering = false;
    if (kind === "ended" && this.rate > 0) {
      // Film view is one free-running film, not a reel of clips: its end is the end.
      if (this.current?.key.endsWith("@filmview")) this.pause();
      else this.advance();
    }
  }

  /** Load clip i into slot s and seek to the in-point (or `rel` seconds from t₀). */
  private prepare(s: Slot, i: number, rel?: number): Promise<void> {
    const clip = this.clipAt(i);
    if (!clip) {
      s.clip = null;
      s.index = -1;
      s.ready = false;
      return Promise.resolve();
    }
    const target = clip.t0 + (rel ?? clip.from);
    if (s.clip?.key === clip.key && s.index === i && s.ready && rel === undefined && s.el.getAttribute("src") === clip.src && Math.abs(s.el.currentTime - target) < 0.5 / clip.fps)
      return Promise.resolve();
    s.clip = clip;
    s.index = i;
    s.ready = false;
    const el = s.el;
    const myGen = ++this.gen;
    const p = new Promise<void>((resolve) => {
      const seek = () => {
        const t = Math.max(0, frameTime(target, clip.fps));
        const done = () => {
          el.removeEventListener("seeked", done);
          if (s.clip?.key !== clip.key) return resolve();
          const fin = () => {
            s.ready = true;
            resolve();
          };
          if (el.readyState >= 2) fin();
          else el.addEventListener("loadeddata", fin, { once: true });
        };
        el.addEventListener("seeked", done);
        el.currentTime = t;
      };
      if (el.getAttribute("src") !== clip.src) {
        el.src = clip.src;
        el.addEventListener("loadedmetadata", seek, { once: true });
        el.addEventListener(
          "error",
          () => {
            s.ready = true; // surface the error frame rather than hang the reel
            resolve();
          },
          { once: true },
        );
      } else if (el.readyState >= 1) seek();
      else el.addEventListener("loadedmetadata", seek, { once: true });
    });
    void myGen;
    s.pending = p;
    return p;
  }

  /** Keep the standby slots aimed at the neighbours of `i`. */
  private warm(i: number) {
    const n = this.count();
    const want = [i + 1, i - 1].filter((k) => k >= 0 && k < n);
    const free = this.slots.map((_, k) => k).filter((k) => k !== this.active && !this.isYt(k));
    for (const target of want) {
      const already = this.slots.findIndex((s, k) => k !== this.active && s.index === target && s.clip?.key === this.clipAt(target)?.key);
      if (already >= 0) {
        free.splice(free.indexOf(already), 1);
        continue;
      }
    }
    for (const target of want) {
      if (this.slots.some((s, k) => k !== this.active && s.index === target)) continue;
      if (this.clipAt(target)?.kind === "youtube") continue; // one YouTube player: it loads when we get there
      const k = free.shift();
      if (k === undefined) break;
      void this.prepare(this.slots[k], target);
    }
    // Range-prefetch the head of the next few clips so their moov atoms and first GOPs are in the HTTP cache.
    for (let k = i + 2; k < Math.min(n, i + 5); k++) prefetchHead(this.clipAt(k));
  }

  /** Jump to clip i. `rel` (seconds from t₀) restores an exact frame, e.g. from a shared URL. */
  async goto(i: number, opts: { rel?: number; play?: boolean } = {}) {
    const n = this.count();
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    const wasPlaying = opts.play ?? this.rate > 0;
    this.xferStart = performance.now();
    this.xferMs = null;
    const prevRate = this.rate;
    this.stopReverse();
    const want = this.clipAt(i);
    let k: number;
    if (want?.kind === "youtube") k = this.ytSlot();
    else {
      k = this.slots.findIndex((s, j) => !this.isYt(j) && s.index === i && s.clip?.key === want?.key);
      if (k < 0) k = this.slots.findIndex((_, j) => !this.isYt(j) && j !== this.active && this.slots[j].index !== this.index + 1 && this.slots[j].index !== this.index - 1);
      if (k < 0) k = (this.active + 1) % 3;
      if (k === this.active && this.isYt(k)) k = 0;
    }
    const s = this.slots[k];
    this.index = i;
    this.onIndex(i);
    this.buffering = !s.ready;
    await this.prepare(s, i, opts.rel);
    if (this.index !== i || this.destroyed) return;
    // Reveal: the incoming element already holds its frame. Swap in one frame; pause the outgoing one.
    const out = this.slots[this.active];
    if (k !== this.active) {
      s.el.style.opacity = "1";
      s.el.style.zIndex = "2";
      out.el.style.zIndex = "1";
      out.el.pause();
      const outEl = out.el;
      requestAnimationFrame(() => {
        if (this.slots[this.active].el !== outEl) outEl.style.opacity = "0";
      });
      this.active = k;
    }
    this.buffering = false;
    this.lastFrame = -1;
    this.target = null;
    this.exact = false;
    this.armRVFC();
    // Paused swaps present no new video frame, so rVFC may stay silent: time to the first painted frame instead.
    const started = this.xferStart;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.xferMs === null && this.xferStart === started) {
          this.xferMs = performance.now() - started;
          this.emit();
        }
      }),
    );
    if (wasPlaying) {
      this.rate = prevRate > 0 ? prevRate : 1;
      s.el.playbackRate = this.rate;
      s.el.play().catch(() => undefined);
    } else {
      this.rate = 0;
      s.el.pause();
    }
    this.warm(i);
    this.emit();
  }

  next() {
    if (this.index < this.count() - 1) void this.goto(this.index + 1);
  }
  prev() {
    if (this.index > 0) void this.goto(this.index - 1);
  }

  private advance() {
    if (!this.autoAdvance) return this.pause();
    if (this.index < this.count() - 1) void this.goto(this.index + 1, { play: true });
    else this.pause();
  }

  play() {
    this.stopReverse();
    this.target = null;
    const el = this.activeElement;
    const c = this.current;
    if (c && el.currentTime >= c.t0 + c.to - 0.5 / c.fps) el.currentTime = frameTime(c.t0 + c.from, c.fps);
    this.rate = 1;
    el.playbackRate = 1;
    el.play().catch(() => undefined);
    this.emit();
  }
  pause() {
    this.stopReverse();
    this.target = null;
    this.rate = 0;
    this.activeElement.pause();
    this.emit();
  }
  toggle() {
    if (this.rate !== 0) this.pause();
    else this.play();
  }

  /** J/L shuttle: each press in a direction doubles the speed (1→2→4→8); the other direction slows/reverses. */
  shuttle(dir: 1 | -1) {
    const cur = this.rate;
    let next: number;
    if (dir > 0) next = cur <= 0 ? 1 : RATES[Math.min(RATES.length - 1, RATES.indexOf(cur) + 1)];
    else next = cur >= 0 ? -1 : -RATES[Math.min(RATES.length - 1, RATES.indexOf(-cur) + 1)];
    this.setRate(next);
  }

  setRate(r: number) {
    this.rate = r;
    const el = this.activeElement;
    if (r > 0) {
      this.stopReverse();
      el.playbackRate = r;
      this.rate = el.playbackRate || r; // YouTube clamps to its own rates (max 2×): show what actually plays
      el.play().catch(() => undefined);
    } else if (r < 0) {
      el.pause();
      this.startReverse();
    } else this.pause();
    this.emit();
  }

  private stopReverse() {
    cancelAnimationFrame(this.reverseRaf);
    this.reverseRaf = 0;
  }
  /** HTMLMediaElement can't play backwards; step the playhead back at |rate|× wall time, one seek in flight. */
  private startReverse() {
    this.stopReverse();
    let last = performance.now();
    let inflight = false;
    const tick = (now: number) => {
      const el = this.activeElement;
      const c = this.current;
      if (!c || this.rate >= 0) return;
      const dt = (now - last) / 1000;
      if (!inflight) {
        last = now;
        const t = el.currentTime + this.rate * dt;
        const floor = c.t0 + c.from;
        if (t <= floor) {
          el.currentTime = floor;
          this.rate = 0;
          this.emit();
          return;
        }
        inflight = true;
        el.addEventListener("seeked", () => (inflight = false), { once: true });
        el.currentTime = t;
      }
      this.reverseRaf = requestAnimationFrame(tick);
    };
    this.reverseRaf = requestAnimationFrame(tick);
  }

  /** Step ±n frames from the presented frame, landing mid-frame so rounding can't drop to the neighbour. */
  step(n: number) {
    const c = this.current;
    if (!c) return;
    this.stopReverse();
    this.rate = 0;
    const el = this.activeElement;
    el.pause();
    const cur = this.lastFrame >= 0 ? this.lastFrame : Math.round(el.currentTime * c.fps);
    const target = Math.max(0, cur + n);
    this.lastFrame = target; // so rapid presses accumulate before the seek lands
    this.target = target;
    el.currentTime = (target + 0.5) / c.fps;
    this.exact = false;
    this.emit();
  }

  /** Seek to `rel` seconds from t₀. */
  seekRel(rel: number) {
    const c = this.current;
    if (!c) return;
    const el = this.activeElement;
    el.currentTime = frameTime(c.t0 + rel, c.fps);
    this.target = Math.round(c.t0 * c.fps + rel * c.fps);
    this.lastFrame = this.target;
    this.exact = false;
    this.emit();
  }

  /** Re-time the current clip (e.g. pre/post-roll changed) without moving the playhead. */
  refresh() {
    const i = this.index;
    for (const s of this.slots) if (s.index !== i) {
      s.index = -1;
      s.clip = null;
      s.ready = false;
    }
    const c = this.clipAt(i);
    if (c) this.slots[this.active].clip = c;
    this.warm(i);
    this.emit();
  }

  private armRVFC() {
    const el = this.activeElement as VideoWithRVFC;
    if (!el.requestVideoFrameCallback) return;
    if (this.rvfc && el.cancelVideoFrameCallback) el.cancelVideoFrameCallback(this.rvfc);
    const cb = (_now: number, md: { mediaTime: number }) => {
      if (el !== this.activeElement || this.destroyed) return;
      const c = this.current;
      if (c) {
        const presented = Math.round(md.mediaTime * c.fps);
        if (this.target !== null && presented !== this.target) {
          // A frame from before the latest step: keep heading for the target.
        } else {
          this.target = null;
          this.lastFrame = presented;
          this.exact = true;
        }
        if (this.xferMs === null && this.xferStart) this.xferMs = performance.now() - this.xferStart;
      }
      this.rvfc = el.requestVideoFrameCallback!(cb);
    };
    this.rvfc = el.requestVideoFrameCallback(cb);
  }

  private loop = () => {
    if (this.destroyed) return;
    const c = this.current;
    const el = this.activeElement;
    if (c && this.rate > 0 && !el.paused && el.currentTime >= c.t0 + c.to) this.advance();
    if (!(el as VideoWithRVFC).requestVideoFrameCallback && c) {
      // No rVFC (older Firefox): estimate from currentTime.
      this.lastFrame = Math.round(el.currentTime * c.fps - 0.5);
      if (this.xferMs === null && this.xferStart) this.xferMs = performance.now() - this.xferStart;
    }
    this.emit();
    this.raf = requestAnimationFrame(this.loop);
  };

  private lastEmit = "";
  private emit() {
    const c = this.current;
    const el = this.activeElement;
    const fps = c?.fps ?? 30;
    const frame = this.lastFrame >= 0 ? this.lastFrame : Math.round(el.currentTime * fps - 0.5);
    const t0f = c ? Math.round(c.t0 * fps) : 0;
    const rel = frame - t0f;
    const s: FrameState = {
      index: this.index,
      key: c?.key ?? "",
      kind: c?.kind ?? null,
      fps,
      frame,
      rel,
      sec: rel / fps,
      from: c?.from ?? 0,
      to: c?.to ?? 0,
      rate: this.rate,
      playing: this.rate !== 0,
      buffering: this.buffering,
      xferMs: this.xferMs,
      exact: this.exact,
    };
    const sig = `${s.index}|${s.frame}|${s.rate}|${s.buffering}|${s.xferMs}|${s.exact}|${s.key}`;
    if (sig === this.lastEmit) return;
    this.lastEmit = sig;
    this.onFrame(s);
  }
}

/** Media time of the frame that contains `t`, nudged to mid-frame so the decoder lands on it, not its neighbour. */
export function frameTime(t: number, fps: number): number {
  return (Math.round(t * fps) + 0.5) / fps;
}

const prefetched = new Set<string>();
function prefetchHead(c: Clip | null) {
  if (!c || c.kind === "local" || c.kind === "youtube" || prefetched.has(c.src)) return;
  prefetched.add(c.src);
  try {
    const sameOrigin = c.src.startsWith("/") || c.src.startsWith(location.origin);
    void fetch(c.src, { headers: { Range: "bytes=0-524287" }, mode: sameOrigin ? "same-origin" : "no-cors", priority: "low" } as RequestInit).catch(() => undefined);
  } catch {
    /* best effort */
  }
}
