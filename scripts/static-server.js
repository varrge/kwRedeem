import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const targetDirArg = process.argv[2];
const portArg = Number(process.argv[3] || 4173);

if (!targetDirArg) {
  console.error("Usage: node scripts/static-server.js <dir> <port>");
  process.exit(1);
}

const rootDir = path.resolve(projectRoot, targetDirArg);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}

function resolveFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "/index.html" : cleanPath;
  const absolutePath = path.resolve(rootDir, `.${relativePath}`);

  if (!absolutePath.startsWith(rootDir)) {
    return null;
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return absolutePath;
  }

  const fallback = path.join(rootDir, "index.html");
  return fs.existsSync(fallback) ? fallback : null;
}

const server = http.createServer((request, response) => {
  const filePath = resolveFilePath(request.url || "/");
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  sendFile(response, filePath);
});

server.listen(portArg, "127.0.0.1", () => {
  console.log(`Static server ready: http://127.0.0.1:${portArg} -> ${targetDirArg}`);
});
