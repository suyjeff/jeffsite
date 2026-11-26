// Minimal static server for the exported site (out/), with HTTP Range support so <video> can seek, and
// GitHub Pages' "/path" → "/path.html" rule. Usage: node scripts/filmroom/serve-static.cjs out 4173
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.resolve(process.argv[2] || "out");
const port = Number(process.argv[3] || 4173);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webm": "video/webm", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".gz": "application/gzip", ".png": "image/png", ".pdf": "application/pdf" };
http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(root, p);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (!fs.existsSync(file)) return res.writeHead(404).end("not found");
    const stat = fs.statSync(file);
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
