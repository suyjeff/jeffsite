// Dense bitset over play rows. At this cardinality (~10⁴–10⁵ rows) a flat Uint32Array is the right container —
// it is what a Roaring bitmap would pick for most facets here anyway — and every intersection is a tight loop over
// a few thousand words: microseconds, not milliseconds.

export class Bitset {
  readonly words: Uint32Array;
  constructor(readonly size: number, words?: Uint32Array) {
    this.words = words ?? new Uint32Array((size + 31) >>> 5);
  }

  static full(size: number): Bitset {
    const b = new Bitset(size);
    b.words.fill(0xffffffff);
    b.trim();
    return b;
  }

  static from(size: number, indices: Iterable<number>): Bitset {
    const b = new Bitset(size);
    for (const i of indices) b.set(i);
    return b;
  }

  private trim() {
    const r = this.size & 31;
    if (r) this.words[this.words.length - 1] &= (1 << r) - 1 || 0xffffffff;
  }

  set(i: number) {
    this.words[i >>> 5] |= 1 << (i & 31);
  }
  has(i: number): boolean {
    return (this.words[i >>> 5] & (1 << (i & 31))) !== 0;
  }

  clone(): Bitset {
    return new Bitset(this.size, this.words.slice());
  }

  and(o: Bitset): Bitset {
    const w = new Uint32Array(this.words.length);
    for (let i = 0; i < w.length; i++) w[i] = this.words[i] & o.words[i];
    return new Bitset(this.size, w);
  }
  or(o: Bitset): Bitset {
    const w = new Uint32Array(this.words.length);
    for (let i = 0; i < w.length; i++) w[i] = this.words[i] | o.words[i];
    return new Bitset(this.size, w);
  }
  andNot(o: Bitset): Bitset {
    const w = new Uint32Array(this.words.length);
    for (let i = 0; i < w.length; i++) w[i] = this.words[i] & ~o.words[i];
    return new Bitset(this.size, w);
  }
  not(): Bitset {
    const w = new Uint32Array(this.words.length);
    for (let i = 0; i < w.length; i++) w[i] = ~this.words[i];
    const b = new Bitset(this.size, w);
    b.trim();
    return b;
  }
  /** In-place OR, for building. */
  orInPlace(o: Bitset): this {
    for (let i = 0; i < this.words.length; i++) this.words[i] |= o.words[i];
    return this;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.words.length; i++) n += popcnt(this.words[i]);
    return n;
  }
  /** |this ∧ o| without allocating — used for live suggestion counts. */
  andCount(o: Bitset): number {
    let n = 0;
    for (let i = 0; i < this.words.length; i++) n += popcnt(this.words[i] & o.words[i]);
    return n;
  }

  /** Set row indices in ascending order. */
  toArray(): Uint32Array {
    const out = new Uint32Array(this.count());
    let k = 0;
    for (let i = 0; i < this.words.length; i++) {
      let w = this.words[i];
      while (w) {
        const t = w & -w;
        out[k++] = (i << 5) + (31 - Math.clz32(t));
        w ^= t;
      }
    }
    return out;
  }
}

function popcnt(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
