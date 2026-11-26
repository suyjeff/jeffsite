// Streaming RFC 4180 reader: quoted fields may hold commas, doubled quotes and newlines (the pbpstats mirror
// stores whole possession transcripts in one cell). Runs over 200 MB season files without loading them whole.

import { createReadStream } from "fs";

export async function* readCsv(path: string): AsyncGenerator<string[]> {
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let pendingQuote = false; // saw a quote inside a quoted field; next char decides (escape vs close)
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream as AsyncIterable<string>) {
    const out: string[][] = [];
    let start = 0;
    const s = chunk;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (inQuotes) {
        if (pendingQuote) {
          pendingQuote = false;
          if (c === 34) {
            field += '"';
            start = i + 1;
            continue;
          }
          inQuotes = false;
          // fall through to unquoted handling of this char
        } else if (c === 34) {
          field += s.slice(start, i);
          pendingQuote = true;
          start = i + 1;
          continue;
        } else {
          continue;
        }
      }
      if (c === 44) {
        row.push(field + s.slice(start, i));
        field = "";
        start = i + 1;
      } else if (c === 10) {
        let end = i;
        if (end > start && s.charCodeAt(end - 1) === 13) end--;
        row.push(field + s.slice(start, end));
        field = "";
        out.push(row);
        row = [];
        start = i + 1;
      } else if (c === 34 && field === "" && i === start) {
        inQuotes = true;
        start = i + 1;
      }
    }
    if (!pendingQuote) field += s.slice(start);
    for (const r of out) yield r;
  }
  if (field !== "" || row.length) {
    row.push(field);
    yield row;
  }
}

/** Rows as objects keyed by the header, optionally pre-filtered on the raw cells before object construction. */
export async function* readCsvObjects(
  path: string,
  keep?: (cells: string[], col: (name: string) => number) => boolean,
): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  let index: Map<string, number> = new Map();
  const col = (name: string) => index.get(name) ?? -1;
  for await (const cells of readCsv(path)) {
    if (!header) {
      header = cells;
      index = new Map(header.map((h, i) => [h, i]));
      continue;
    }
    if (keep && !keep(cells, col)) continue;
    const o: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = cells[i] ?? "";
    yield o;
  }
}
