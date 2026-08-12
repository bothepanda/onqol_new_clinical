import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAIGateway } from "./openaiGateway.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(serverDir, "../dist");
const port = Number(process.env.PORT || 4174);
const host = process.env.ONQOL_HOST || "127.0.0.1";
const gateway = createOpenAIGateway({
  apiKey: process.env.OPENAI_API_KEY,
  routerModel: process.env.OPENAI_ROUTER_MODEL,
  simulatorModel: process.env.OPENAI_SIMULATOR_MODEL,
  mentorModel: process.env.OPENAI_MENTOR_MODEL,
  accessToken: process.env.ONQOL_MAIN_ACCESS_TOKEN,
  allowedOrigin: process.env.ONQOL_MAIN_ALLOWED_ORIGIN,
  requireAccessControl: process.env.NODE_ENV === "production",
});

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function staticResponse(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  const requestedPath = path.resolve(distDir, relative);
  if (!requestedPath.startsWith(`${distDir}${path.sep}`) && requestedPath !== distDir) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let filePath = requestedPath;
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("Not a file");
  } catch {
    filePath = path.join(distDir, "index.html");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypes[path.extname(filePath)] || "application/octet-stream");
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  if ((req.url || "").startsWith("/api/v25/openai")) {
    await gateway(req, res);
    return;
  }
  await staticResponse(req, res);
});

server.listen(port, host, () => {
  console.log(`ON QOL V2.5 listening on http://${host}:${port}`);
  console.log(`OpenAI backend: ${process.env.OPENAI_API_KEY ? "configured" : "missing OPENAI_API_KEY"}`);
});
