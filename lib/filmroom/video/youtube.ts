// YouTube as a media element. A thin shim over YouTube's public IFrame Player API that exposes the slice of the
// HTMLVideoElement surface the reel drives — currentTime, paused, play/pause, playbackRate, readyState, and the
// seeked / loadedmetadata / loadeddata / playing / waiting / ended / error events — so official NBA uploads play in
// the same reel, with the same keys, as files and URLs.
//
// What YouTube cannot give: presented-frame callbacks (no requestVideoFrameCallback inside a cross-origin iframe), so
// frame numbers are estimated from currentTime, and playback rates are YouTube's own set (0.25–2×). The reel reads
// both through the same code paths and marks frames as estimated.

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  seekTo(t: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
}

let apiPromise: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube player API failed to load"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** "https://youtu.be/ID", "youtube.com/watch?v=ID&t=..", "/embed/ID", "/shorts/ID", or a bare 11-char id → ID. */
export function youTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return /^[\w-]{11}/.exec(u.pathname.slice(1))?.[0] ?? null;
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
      return m?.[1] ?? null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export class YouTubeMedia extends EventTarget {
  readonly el: HTMLDivElement;
  private mount: HTMLDivElement;
  private player: YTPlayer | null = null;
  private ready: Promise<void> | null = null;
  private videoId: string | null = null;
  private srcAttr: string | null = null;
  private rate = 1;
  private seekPoll = 0;
  private wantPlay = false;
  readyState = 0;
  muted = true;
  playsInline = true;
  preload = "auto";
  disablePictureInPicture = true;
  className = "";

  constructor(host: HTMLElement) {
    super();
    this.el = document.createElement("div");
    this.el.className = "fr-video fr-yt";
    this.el.style.opacity = "0";
    // The film is driven entirely by the workbench keys; the iframe must never take focus or the pointer.
    this.el.style.pointerEvents = "none";
    this.mount = document.createElement("div");
    this.el.appendChild(this.mount);
    host.appendChild(this.el);
  }

  get style() {
    return this.el.style;
  }

  getAttribute(name: string): string | null {
    return name === "src" ? this.srcAttr : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.srcAttr = null;
  }
  set src(v: string) {
    this.srcAttr = v;
    const id = v.startsWith("yt:") ? v.slice(3) : youTubeId(v);
    if (!id) {
      this.dispatchEvent(new Event("error"));
      return;
    }
    void this.open(id);
  }
  get src() {
    return this.srcAttr ?? "";
  }

  private async open(id: string) {
    this.readyState = 0;
    if (this.player && this.videoId === id) {
      this.readyState = 4;
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("loadeddata"));
      return;
    }
    this.videoId = id;
    try {
      await loadYouTubeApi();
    } catch {
      this.dispatchEvent(new Event("error"));
      return;
    }
    if (this.player) {
      this.player.cueVideoById({ videoId: id });
    } else {
      this.ready = new Promise<void>((resolve) => {
        this.player = new window.YT!.Player(this.mount, {
          videoId: id,
          width: "100%",
          height: "100%",
          playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            mute: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              this.player!.mute();
              resolve();
            },
            onStateChange: (e: { data: number }) => this.onState(e.data),
            onError: () => this.dispatchEvent(new Event("error")),
          },
        });
      });
    }
    await this.ready;
    // Metadata: YouTube knows the duration once the video is cued.
    const t0 = performance.now();
    while (this.player && !(this.player.getDuration() > 0) && performance.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
    this.readyState = 4;
    this.dispatchEvent(new Event("loadedmetadata"));
    this.dispatchEvent(new Event("loadeddata"));
  }

  private onState(s: number) {
    if (s === STATE.PLAYING) {
      this.readyState = 4;
      this.dispatchEvent(new Event("playing"));
      if (!this.wantPlay) this.player?.pauseVideo();
    } else if (s === STATE.BUFFERING) this.dispatchEvent(new Event("waiting"));
    else if (s === STATE.ENDED) this.dispatchEvent(new Event("ended"));
  }

  get duration(): number {
    return this.player?.getDuration() ?? NaN;
  }

  get currentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }
  set currentTime(t: number) {
    const p = this.player;
    if (!p) return;
    p.seekTo(Math.max(0, t), true);
    // YouTube has no "seeked" event: resolve once the player reports the new position (or give up after 2 s so a
    // paused, not-yet-buffered player can't hang the reel).
    window.clearInterval(this.seekPoll);
    const t0 = performance.now();
    this.seekPoll = window.setInterval(() => {
      if (Math.abs(p.getCurrentTime() - t) < 0.25 || performance.now() - t0 > 2000) {
        window.clearInterval(this.seekPoll);
        this.dispatchEvent(new Event("seeked"));
      }
    }, 30);
  }

  get paused(): boolean {
    const s = this.player?.getPlayerState();
    return s !== STATE.PLAYING && s !== STATE.BUFFERING;
  }

  play(): Promise<void> {
    this.wantPlay = true;
    this.player?.playVideo();
    return Promise.resolve();
  }
  pause() {
    this.wantPlay = false;
    this.player?.pauseVideo();
  }

  get playbackRate() {
    return this.rate;
  }
  set playbackRate(r: number) {
    const avail = this.player?.getAvailablePlaybackRates?.() ?? [0.25, 0.5, 1, 1.5, 2];
    const best = avail.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 1);
    this.rate = best;
    this.player?.setPlaybackRate(best);
  }

  load() {
    /* nothing to reset: the player keeps its iframe */
  }
  remove() {
    window.clearInterval(this.seekPoll);
    this.player?.destroy();
    this.el.remove();
  }
}
