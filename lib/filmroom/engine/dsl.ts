// Query language: lexer → Pratt parser → AST → canonical printer.
//
//   query    := expr
//   expr     := expr OR expr          (binding power 10; also "|")
//             | expr [AND] expr       (binding power 20; juxtaposition is AND)
//             | NOT expr | -expr      (prefix, binding power 30)
//             | "(" expr ")" | term
//   term     := field ":" values | +player | word
//   values   := value ("," value | "|" value)*          — a comma is OR within the field
//   value    := [> >= < <= =] atom | atom ".." atom | atom "+" | (+|-) atom | "quoted text"
//
// `lineup:+green -looney` lets signed players continue a lineup term after whitespace. The canonical form of every
// AST is a single deterministic string, which is what the URL stores.

export type Op = "eq" | "gt" | "ge" | "lt" | "le" | "range";
export interface Value {
  op: Op;
  v: string;
  v2?: string;
  sign?: "+" | "-";
}

export type Node =
  | { t: "and"; a: Node[] }
  | { t: "or"; a: Node[] }
  | { t: "not"; a: Node }
  | { t: "term"; field: string; values: Value[]; span: [number, number] }
  | { t: "bare"; word: string; sign?: "+"; span: [number, number] };

export type TokKind = "field" | "value" | "op" | "paren" | "bare" | "not" | "error";
export interface Token {
  kind: TokKind;
  text: string;
  start: number;
  end: number;
}

export interface Diagnostic {
  start: number;
  end: number;
  message: string;
}

interface LexTok {
  k: "LP" | "RP" | "OR" | "AND" | "NOT" | "TERM" | "BARE" | "EOF";
  start: number;
  end: number;
  field?: string;
  raw?: string;
  fieldEnd?: number;
  word?: string;
}

export const LINEUP_FIELDS = new Set(["lineup", "with", "oncourt", "on"]);

function readWord(src: string, i: number): number {
  let inQ = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && (c === " " || c === "\t" || c === "\n" || c === "(" || c === ")")) break;
    i++;
  }
  return i;
}

export function lex(src: string): { toks: LexTok[]; tokens: Token[] } {
  const toks: LexTok[] = [];
  const tokens: Token[] = [];
  let i = 0;
  const lastTerm = () => {
    const t = toks[toks.length - 1];
    return t && t.k === "TERM" && LINEUP_FIELDS.has(t.field!.toLowerCase()) ? t : null;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      toks.push({ k: c === "(" ? "LP" : "RP", start: i, end: i + 1 });
      tokens.push({ kind: "paren", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    // Signed players continuing a lineup term: `lineup:+green -looney`.
    const lt = lastTerm();
    if (lt && (c === "+" || c === "-") && i + 1 < src.length && /[\w"]/.test(src[i + 1])) {
      const end = readWord(src, i);
      const w = src.slice(i, end);
      if (!w.includes(":")) {
        lt.raw += "," + w;
        lt.end = end;
        tokens.push({ kind: "value", text: w, start: i, end });
        i = end;
        continue;
      }
    }
    if ((c === "-" || c === "!") && i + 1 < src.length && src[i + 1] !== " ") {
      toks.push({ k: "NOT", start: i, end: i + 1 });
      tokens.push({ kind: "not", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "|") {
      toks.push({ k: "OR", start: i, end: i + 1 });
      tokens.push({ kind: "op", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    const end = readWord(src, i);
    const w = src.slice(i, end);
    const colon = w.indexOf(":");
    if (colon > 0 && !w.slice(0, colon).includes('"')) {
      toks.push({ k: "TERM", start: i, end, field: w.slice(0, colon), raw: w.slice(colon + 1), fieldEnd: i + colon + 1 });
      tokens.push({ kind: "field", text: w.slice(0, colon + 1), start: i, end: i + colon + 1 });
      if (colon + 1 < w.length) tokens.push({ kind: "value", text: w.slice(colon + 1), start: i + colon + 1, end });
    } else if (/^(or|OR)$/.test(w)) {
      toks.push({ k: "OR", start: i, end });
      tokens.push({ kind: "op", text: w, start: i, end });
    } else if (/^(and|AND)$/.test(w)) {
      toks.push({ k: "AND", start: i, end });
      tokens.push({ kind: "op", text: w, start: i, end });
    } else if (/^(not|NOT)$/.test(w)) {
      toks.push({ k: "NOT", start: i, end });
      tokens.push({ kind: "not", text: w, start: i, end });
    } else {
      toks.push({ k: "BARE", start: i, end, word: w });
      tokens.push({ kind: "bare", text: w, start: i, end });
    }
    i = end;
  }
  toks.push({ k: "EOF", start: src.length, end: src.length });
  return { toks, tokens };
}

export function parseValues(raw: string): Value[] {
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if (!inQ && (ch === "," || ch === "|")) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const out: Value[] = [];
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    let sign: "+" | "-" | undefined;
    if ((p[0] === "+" || p[0] === "-") && p.length > 1 && !/^-?\d/.test(p.slice(0, 2).replace("+", ""))) {
      // +green / -looney (signed player), but not -5 (a number)
      if (!/^[+-]\d/.test(p)) {
        sign = p[0] as "+" | "-";
        p = p.slice(1);
      }
    }
    const unq = (s: string) => (s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s);
    const m = /^(>=|<=|>|<|=)(.+)$/.exec(p);
    if (m) {
      const op = ({ ">=": "ge", "<=": "le", ">": "gt", "<": "lt", "=": "eq" } as const)[m[1] as ">=" | "<=" | ">" | "<" | "="];
      out.push({ op, v: unq(m[2]) });
      continue;
    }
    const r = /^(.+?)\.\.(.+)$/.exec(p);
    if (r) {
      out.push({ op: "range", v: unq(r[1]), v2: unq(r[2]) });
      continue;
    }
    const plus = /^(-?\d+(?:\.\d+)?)\+$/.exec(p);
    if (plus) {
      out.push({ op: "ge", v: plus[1] });
      continue;
    }
    out.push(sign ? { op: "eq", v: unq(p), sign } : { op: "eq", v: unq(p) });
  }
  return out;
}

export interface ParseResult {
  ast: Node | null;
  tokens: Token[];
  diagnostics: Diagnostic[];
}

export function parse(src: string): ParseResult {
  const { toks, tokens } = lex(src);
  const diagnostics: Diagnostic[] = [];
  let pos = 0;
  let depth = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const startsUnary = (t: LexTok) => t.k === "TERM" || t.k === "BARE" || t.k === "LP" || t.k === "NOT";

  const nud = (t: LexTok): Node | null => {
    switch (t.k) {
      case "TERM": {
        const values = parseValues(t.raw ?? "");
        if (!values.length) diagnostics.push({ start: t.start, end: t.end, message: `${t.field}: needs a value` });
        return { t: "term", field: t.field!.toLowerCase(), values, span: [t.start, t.end] };
      }
      case "BARE": {
        const w = t.word!;
        if (w.startsWith("+") && w.length > 1) return { t: "bare", word: w.slice(1).toLowerCase(), sign: "+", span: [t.start, t.end] };
        return { t: "bare", word: w.toLowerCase(), span: [t.start, t.end] };
      }
      case "NOT": {
        const a = expr(30);
        return a ? { t: "not", a } : null;
      }
      case "LP": {
        depth++;
        const a = expr(0);
        depth--;
        if (peek().k === "RP") next();
        else diagnostics.push({ start: t.start, end: t.end, message: "unclosed (" });
        return a;
      }
      case "RP":
        diagnostics.push({ start: t.start, end: t.end, message: "unexpected )" });
        return null;
      default:
        return null;
    }
  };

  const join = (k: "and" | "or", l: Node, r: Node): Node => {
    const a = [...(l.t === k ? l.a : [l]), ...(r.t === k ? r.a : [r])];
    return { t: k, a } as Node;
  };

  function expr(rbp: number): Node | null {
    let t = next();
    while (t.k === "AND" || t.k === "OR") t = next(); // dangling operator at the start
    if (t.k === "EOF") return null;
    let left = nud(t);
    for (;;) {
      const p = peek();
      if (p.k === "OR") {
        if (10 <= rbp) break;
        next();
        const r = expr(10);
        if (r) left = left ? join("or", left, r) : r;
      } else if (p.k === "AND" || startsUnary(p)) {
        if (20 <= rbp) break;
        if (p.k === "AND") next();
        const r = expr(20);
        if (r) left = left ? join("and", left, r) : r;
        else break;
      } else if (p.k === "RP" && depth === 0) {
        // stray close paren at top level
        diagnostics.push({ start: p.start, end: p.end, message: "unexpected )" });
        next();
      } else break;
    }
    return left;
  }

  let ast: Node | null = null;
  while (peek().k !== "EOF") {
    const r = expr(0);
    if (r) ast = ast ? join("and", ast, r) : r;
    else if (peek().k !== "EOF") next();
  }
  return { ast, tokens, diagnostics };
}

// ───────────────────────── canonical printer ─────────────────────────

const quote = (s: string) => (/[\s,|()"]/.test(s) ? `"${s.replace(/"/g, "")}"` : s);

export function printValue(v: Value): string {
  const s = v.sign ?? "";
  switch (v.op) {
    case "eq":
      return s + quote(v.v);
    case "gt":
      return ">" + quote(v.v);
    case "ge":
      return ">=" + quote(v.v);
    case "lt":
      return "<" + quote(v.v);
    case "le":
      return "<=" + quote(v.v);
    case "range":
      return `${quote(v.v)}..${quote(v.v2 ?? "")}`;
  }
}

export function print(n: Node | null, parent: "and" | "or" | "not" | null = null): string {
  if (!n) return "";
  switch (n.t) {
    case "term":
      return `${n.field}:${n.values.map(printValue).join(",")}`;
    case "bare":
      return (n.sign ?? "") + quote(n.word);
    case "not": {
      const inner = print(n.a, "not");
      return `-${n.a.t === "term" || n.a.t === "bare" ? inner : `(${print(n.a)})`}`;
    }
    case "and": {
      const s = n.a.map((c) => print(c, "and")).join(" ");
      return parent === "not" ? `(${s})` : s;
    }
    case "or": {
      const s = n.a.map((c) => print(c, "or")).join(" OR ");
      return parent === "and" || parent === "not" ? `(${s})` : s;
    }
  }
}

/** Walk every term in an AST. */
export function terms(n: Node | null, out: (Node & { t: "term" | "bare" })[] = []) {
  if (!n) return out;
  if (n.t === "term" || n.t === "bare") out.push(n);
  else if (n.t === "not") terms(n.a, out);
  else for (const c of n.a) terms(c, out);
  return out;
}
