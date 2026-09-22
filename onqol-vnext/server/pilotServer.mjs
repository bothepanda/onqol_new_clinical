import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createAiGateway } from "./aiGateway.mjs";
import { fileBudgetStore } from "./budgetStore.mjs";
import { createMentorGateway } from "./mentorGateway.mjs";

export function createPilotServer({ env = process.env, fetchImpl } = {}) {
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  const gateway = createAiGateway({ env, fetchImpl, budgetStore: fileBudgetStore(fileURLToPath(new URL("../.onqol-stage2-budget.json", import.meta.url))) });
  const mentorGateway = createMentorGateway({ env, fetchImpl });
  return createServer((req, res) => mentorGateway(req, res, () => gateway(req, res, () => {
    void serve(req, res).catch(() => { res.statusCode = 404; res.end("Not found"); });
  })));
  async function serve(req, res) {
    if (!["GET", "HEAD"].includes(req.method)) { res.statusCode = 405; res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (file !== path.resolve(root) && !file.startsWith(root)) { res.statusCode = 403; res.end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      if (path.extname(pathname)) { res.statusCode = 404; res.end(); return; }
      file = path.join(root, "index.html");
    }
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
    res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(file).on("error", () => { res.destroy(); }).pipe(res);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4180);
  createPilotServer().listen(port, "127.0.0.1", () => console.log(`ON QOL: http://127.0.0.1:${port}`));
}
