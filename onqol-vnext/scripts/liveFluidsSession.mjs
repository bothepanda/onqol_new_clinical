#!/usr/bin/env node
/**
 * Live-provider session runner for fluids_01 (Wave B acceptance, ТЗ §12).
 *
 * One invocation = one learner turn through the SAME pipeline the app runs:
 *   semantic-first interpreter (live model) -> submitLearnerTurn -> renderTurnMessages
 *   -> grounded stateful mentor (live draft + independent verifier, one bounded
 *   regeneration, safe fallback) -> what the resident sees.
 *
 * The session is event-sourced, so it is persisted as the recorded learner turns
 * (text + the structured interpretation) and rebuilt by deterministic replay on
 * the next call; only the NEW turn touches the network.
 *
 *   node scripts/liveFluidsSession.mjs --session A --new --style "concise, strong" --say "измеряю давление и пульс"
 *   node scripts/liveFluidsSession.mjs --session A --say "болюс 500 мл стерофундина"
 *   node scripts/liveFluidsSession.mjs --session A --show          # print the transcript so far
 *   ... --offline                                                  # deterministic interpreter + deterministic mentor text, no network
 *
 * Spend: separate, lower-ceiling ledgers (`.onqol-wave-b-*-budget.json`); the
 * existing ledgers are never touched. Stored records hold learner input,
 * structured actions, world events, issue / pending / scaffold state, the cards
 * offered and cited, the mentor's draft and the verifier's verdict, the
 * regeneration count and the visible reply. Never chain-of-thought (the models
 * are asked for schema-constrained JSON only; nothing else exists to store).
 */
import process from "node:process";
import path from "node:path";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn, recordGroundedMentorResponse } from "../src/core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../src/core/state/learnerView.js";
import { hospitalIso } from "../src/core/time/clock.js";
import { withShared } from "../src/core/content/loadBundle.js";
import { renderTurnMessages, toMessage } from "../src/app/session/renderTurn.js";
import { renderMentorResponse } from "../src/app/session/renderMentorResponse.js";
import { buildChatTurnContext } from "../src/app/session/interpreterContext.js";
import { interpretSemanticFirst } from "../src/ai/interpreter/semanticFirstInterpreter.js";
import { selectCardsForIssue, buildRetrievalView } from "../src/ai/mentor/cardRetrieval.js";
import { buildDebrief } from "../src/core/replay/buildDebrief.js";
import { createMentorGateway } from "../server/mentorGateway.mjs";
import { fileBudgetStore } from "../server/budgetStore.mjs";
import { loadStage2Env, liveGateway, root } from "./stage2Runtime.mjs";
import disease from "../src/content/generated/fluids_01.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };
import library from "../src/content/mentor/fluids01-library.json" with { type: "json" };

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const name = value("session");
if (!name || !/^[A-Za-z0-9_-]{1,40}$/.test(name)) throw new Error("--session <name> required");
const OFFLINE = flag("offline");
const dir = path.join(root, "private/wave-b-live");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stateFile = path.join(dir, `${name}.json`);
const bundle = withShared(disease, shared);
const START_ISO = "2026-09-25T02:10:00+05:00";

const store = existsSync(stateFile) && !flag("new")
  ? JSON.parse(readFileSync(stateFile, "utf8"))
  : { name, seed: value("seed") ?? `live-${name}`, style: value("style") ?? "unspecified", createdAt: new Date().toISOString(), purpose: "synthetic_resident_scripted_by_the_developer_not_a_real_resident", turns: [] };
const save = () => writeFileSync(stateFile, JSON.stringify(store, null, 2), { mode: 0o600 });

const arrivalOf = (session) => session.events.find((event) => event.type === "PATIENT_ARRIVED").payload.handoffRu;

function replay() {
  let session = createSession({
    sessionId: `wave-b-${name}`, seed: store.seed, mode: "reference", casePresetId: "FLUIDS-01", sessionPurpose: "internal_development",
    interactionFlags: { FLUIDS_VERTICAL_SLICE_V1: true, STATEFUL_GROUNDED_MENTOR_V1: true }, bundle, locale: "ru", startIso: START_ISO,
  });
  const messages = [{ id: "m0", role: "env", speakerRu: "Приёмный покой", textRu: arrivalOf(session) }];
  for (const turn of store.turns) {
    const learnerVisibleBefore = buildLearnerVisibleState(session.state);
    const result = submitLearnerTurn({ session, text: turn.text, interpreted: turn.interpreted });
    session = result.session;
    void learnerVisibleBefore;
    messages.push(...turn.messages);
  }
  return { session, messages };
}

function print(turn) {
  console.log(`\n>>> ${turn.text}`);
  console.log(`    ACTIONS: ${JSON.stringify(turn.actions)}${turn.reasoning ? `  REASONING: ${JSON.stringify(turn.reasoning)}` : ""}`);
  for (const m of turn.messages.filter((x) => x.role === "env")) console.log(`    [${m.speakerRu ?? m.role}] ${m.textRu}`);
  console.log(`    MENTOR ISSUE: ${turn.diagnostics.issue ?? "-"}  scaffold=${turn.diagnostics.scaffolding ?? "-"}  pending=${turn.diagnostics.pending ?? "-"}  streak=${turn.diagnostics.probingStreak}  adequacy=${turn.diagnostics.adequacy ?? "-"}`);
  const mentor = turn.messages.find((x) => x.role === "mentor");
  console.log(`    MENTOR: ${mentor ? mentor.textRu : "(silent)"}${turn.diagnostics.grounded ? `   [grounded: ${turn.diagnostics.grounded.status}, cards=${JSON.stringify(turn.diagnostics.grounded.cardIds)}, regen=${turn.diagnostics.grounded.regenerations}${turn.diagnostics.grounded.reasons?.length ? `, reasons=${JSON.stringify(turn.diagnostics.grounded.reasons)}` : ""}]` : ""}`);
}

if (flag("show")) {
  console.log(`# ${name} (${store.style}) - arrival: ${arrivalOf(replay().session)}`);
  store.turns.forEach(print);
  process.exit(0);
}
if (flag("debrief")) {
  const { session } = replay();
  const debrief = buildDebrief({ session, bundle });
  console.log(JSON.stringify({ status: session.state.session.status, teachingIssues: debrief.teachingIssues, observedBehavior: debrief.observedBehavior.length, simulatorLimitations: debrief.simulatorLimitations }, null, 2));
  process.exit(0);
}

const text = value("say");
if (!text) throw new Error("--say <text> required");

let { session, messages } = replay();
let teardown = async () => {};
let interpreted;
let fetchImpl;

if (!OFFLINE) {
  loadStage2Env();
  const interp = await liveGateway({ budgetFile: ".onqol-wave-b-interp-budget.json", limits: { pilotMaxUsd: 1.5 }, journalDir: path.join(dir, "provider-journal") });
  const mentorGateway = createMentorGateway({
    env: { ...process.env, STATEFUL_GROUNDED_MENTOR_V1: "true" },
    budgetStore: fileBudgetStore(path.join(root, ".onqol-wave-b-mentor-budget.json")),
    limits: { pilotMaxUsd: 1.5 },
    logger: { error() {} },
  });
  const server = createServer((req, res) => mentorGateway(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fetchImpl = (url, init) => fetch(`${base}${url}`, init);
  teardown = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await interp.close(); };
  interpreted = await interpretSemanticFirst({
    text,
    turnContext: buildChatTurnContext(session, messages),
    bundle: session.bundle,
    idPrefix: `t${session.state.turn}`,
    provider: interp.provider(`wave-b-${name}-interp`),
    locale: "ru",
  });
}

const learnerVisibleBefore = buildLearnerVisibleState(session.state);
const turn = submitLearnerTurn({ session, text, interpreted });
let mentorTextRu = turn.mentor?.textRu ?? null;
let grounded = null;
let offered = [];
if (turn.mentor?.textRu && !OFFLINE) {
  const issueId = turn.mentor.openQuestion?.issueId ?? turn.mentor.ruleId ?? null;
  offered = selectCardsForIssue({ issueId, learnerText: text, library, visibleState: buildRetrievalView(buildLearnerVisibleState(turn.session.state)), concepts: turn.mentor.concepts ?? [], casePresetId: "FLUIDS-01" }).map((c) => c.id);
  grounded = await renderMentorResponse({ session: turn.session, mentor: turn.mentor, messages, text, fetchImpl });
}
let after = turn.session;
if (grounded) {
  mentorTextRu = grounded.text;
  after = recordGroundedMentorResponse(turn.session, { mode: turn.mentor.mode, ...grounded.audit }, hospitalIso(turn.session.clockRoot, turn.session.state.clock.elapsedMinutes));
}
const rendered = renderTurnMessages({ turn, bundle, learnerVisibleBefore, interpreted: turn.interpreted, mentorTextRu: null }).filter(Boolean);
if (mentorTextRu) rendered.push({ role: "mentor", speakerRu: "Наставник", textRu: mentorTextRu });
const stamp = rendered.map((m, i) => ({ id: `m${messages.length + i * 1 + 1}-${store.turns.length}`, role: m.role, speakerRu: m.speakerRu ?? null, textRu: m.textRu, ...(m.kind ? { kind: m.kind } : {}) }));
const learnerMsg = { id: `l${store.turns.length}`, role: "learner", speakerRu: null, textRu: text };

const calls = grounded?.audit?.calls ?? [];
const draftCall = calls.filter((c) => c.task === "mentor_draft");
const verifyCall = calls.filter((c) => c.task === "mentor_verification");
const cost = calls.reduce((n, c) => n + (c.meta?.costUsd ?? 0), 0);
const record = {
  text,
  atMinutes: after.state.clock.elapsedMinutes,
  interpreted: JSON.parse(JSON.stringify({ ...turn.interpreted, semanticTelemetry: undefined })),
  actions: turn.interpreted.commands.map((c) => ({ type: c.type, params: c.params })),
  reasoning: turn.interpreted.mentorSignal ? { mentorSignal: turn.interpreted.mentorSignal } : null,
  interpreterMode: turn.interpreted.mode ?? "deterministic",
  messages: [learnerMsg, ...stamp],
  worldEvents: [...(turn.timeEvents ?? []), ...(turn.afterEvents ?? [])].map((e) => e.type),
  diagnostics: {
    issue: turn.mentor?.openQuestion?.issueId ?? turn.mentor?.ruleId ?? null,
    mode: turn.mentor?.mode ?? null,
    scaffolding: turn.mentor?.scaffolding ?? null,
    adequacy: turn.mentor?.adequacy ?? null,
    pending: after.state.mentor.pendingMentorQuestion?.issueId ?? null,
    pendingScaffold: after.state.mentor.pendingMentorQuestion?.scaffoldingLevel ?? null,
    probingStreak: after.state.mentor.probingStreak,
    deferred: after.state.mentor.deferredMentorIssues,
    deterministicText: turn.mentor?.textRu ?? null,
    firedRules: turn.outcomes.flatMap((o) => (o.firedRules ?? []).map((r) => r.id)),
    grounded: grounded ? {
      status: grounded.audit.status,
      errorCode: grounded.audit.errorCode ?? null,
      cardsOffered: offered,
      cardIds: grounded.audit.cardIds ?? [],
      regenerations: grounded.audit.regenerations ?? 0,
      reasons: grounded.audit.reasons ?? [],
      drafts: draftCall.map((c) => c.raw),
      verdicts: verifyCall.map((c) => c.raw),
      costUsd: Number(cost.toFixed(5)),
    } : null,
  },
};
store.turns.push(record);
// The rebuilt session must be consumed by replay only - keep the messages ids stable.
void toMessage;
save();
print(record);
if (!OFFLINE) console.log(`    [spend this turn: $${cost.toFixed(4)} mentor; interpreter via journal]`);
await teardown();
