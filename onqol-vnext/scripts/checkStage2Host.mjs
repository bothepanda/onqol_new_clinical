import assert from "node:assert/strict";
import { createPilotServer } from "../server/pilotServer.mjs";
import { evidence } from "./stage2Runtime.mjs";

const server = createPilotServer({ env: {} });
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  const api = await fetch(`${base}/api/ai/interpreter`, { method: "POST", body: "{}" });
  const error = await api.json();
  assert.equal(page.status, 200);
  assert.equal(api.status, 501);
  assert.deepEqual(error, { error: "no_provider_configured" });
  evidence("BUILT_HOST", { status: "PASS", pageStatus: page.status, apiStatus: api.status, apiBody: error, externalProviderCalls: 0 });
  console.log("stage2:host-check PASS: built UI 200, gateway 501 (not 404)");
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
