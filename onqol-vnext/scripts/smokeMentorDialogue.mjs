// One synthetic development exchange, never a resident/holdout measurement.
import process from "node:process";
import { Readable } from "node:stream";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { createMentorGateway } from "../server/mentorGateway.mjs";
import { fileBudgetStore } from "../server/budgetStore.mjs";
const env = { ...process.env, ...loadEnv("development", process.cwd(), ""), ONQOL_EXPERIMENTAL_MENTOR: "true" };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = "private/mentor-experiment";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const gateway = createMentorGateway({ env, budgetStore: fileBudgetStore(".onqol-mentor-smoke-budget.json"), limits: { pilotMaxUsd: 0.10 } });
const request = { sessionId: `mentor-smoke-${stamp}`, context: { casePresetId: "APP-004", sessionPurpose: "internal_development", locale: "ru",
  text: "Объясни, почему боль может сначала быть около пупка, а потом локализоваться справа внизу. Я спрашиваю о механизме, не о диагнозе конкретного пациента.", history: [], facts: [], historyTruncated: false } };
const started = Date.now();
const req = Readable.from([JSON.stringify(request)]); req.url = "/api/mentor/dialogue"; req.method = "POST"; req.headers = {}; req.socket = { remoteAddress: "local-smoke" };
const result = await new Promise((resolve, reject) => gateway(req, { statusCode: 200, setHeader() {}, end(text) { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } } }, () => reject(new Error("unhandled"))));
const file = `${dir}/smoke-${stamp}.json`;
writeFileSync(file, JSON.stringify({ purpose: "synthetic_development_smoke_not_quality_evaluation", request, result, elapsedMs: Date.now() - started }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ status: result.audit?.status, errorCode: result.audit?.errorCode, calls: result.audit?.calls?.length, models: result.audit?.calls?.map((x) => x.meta?.model ?? null), costUsd: result.audit?.calls?.reduce((n, x) => n + (x.meta?.costUsd ?? 0), 0), text: result.text, evidenceFile: file, elapsedMs: Date.now() - started }, null, 2));
if (result.audit?.status !== "accepted") process.exitCode = 1;
