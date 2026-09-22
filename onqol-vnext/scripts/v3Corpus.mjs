import { createHash } from "node:crypto";
import { stage2Corpus } from "./stage2Corpus.mjs";

/**
 * Interpreter v3 evaluation corpus.
 *
 * Two rules keep this honest:
 *
 * 1. The Stage 2 corpus is reused with the SAME development / holdout split (a
 *    function of the group hash). Nine of its 200 rows were built from a raw
 *    resident export and were retired on 2026-09-20 (ids never reused, so every
 *    other id is stable); the holdout fingerprint was regenerated and is recorded
 *    in docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json. `holdoutFingerprint()`
 *    lets any run prove the holdout is that one.
 * 2. Every row added for v3 is DEVELOPMENT-only, by construction, whatever its
 *    group hash would have said. New rows never enter the holdout, so adding
 *    regression cases cannot quietly change what the holdout measures.
 *
 * Surface variants of one base intent share a `group` and therefore a split;
 * metrics count a group once (see v3Metrics.mjs), so three prefixes of one
 * sentence are not three independent examples.
 *
 * All gold here is DRAFT LINGUISTIC intent, never a statement that an order is
 * clinically correct. Clinician adjudication lives in a separate file and never
 * rewrites these labels.
 */
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const splitOfGroup = (group) => (parseInt(hash(group).slice(0, 8), 16) % 4 === 0 ? "HOLDOUT" : "DEVELOPMENT");

const cmd = (type, params = {}, absent = []) => ({ type, params, ...(absent.length ? { absent } : {}) });
const test = (id) => cmd("ORDER_TEST", { testId: id });
const exam = (region) => cmd("EXAMINE", { region });
const ask = (topic) => cmd("ASK_PATIENT", { topic });
const untouched = (type, ...keys) => cmd(type, {}, keys);

/** [base intent, variants, gold commands, disposition, category] */
const V3_CASES = [
  // Deterministic reads free-form imaging language as a physical exam or misses it.
  ["v3-imaging-1", ["осмотрите живот ультразвуком", "ультразвуком осмотрите брюшную полость"], [test("ultrasound_abdomen")], "commands", "v3_correction"],
  ["v3-imaging-2", ["нужно посмотреть желчный пузырь на УЗИ", "гляньте желчный на ультразвуке"], [test("ultrasound_abdomen")], "commands", "v3_correction"],
  ["v3-imaging-3", ["исследуйте брюшную полость на сонографии"], [test("ultrasound_abdomen")], "commands", "v3_correction"],
  // Candidate salvage: a courtesy / address word must not sink a valid order.
  ["v3-salvage-1", ["Уважаемые коллеги, оцените клеточный состав крови"], [test("cbc")], "commands", "v3_salvage"],
  ["v3-salvage-2", ["Доктор, будьте добры, проверьте общий анализ мочи"], [test("urinalysis")], "commands", "v3_salvage"],
  // Patient questions in phrasing the deterministic patterns do not cover.
  ["v3-question-allergy", ["а нет ли у вас реакции на какие-то лекарства?", "скажите, аллергия на препараты бывает?"], [ask("allergies")], "commands", "v3_patient_question"],
  ["v3-question-onset", ["как давно это началось?", "когда у вас всё это началось?"], [ask("onset")], "commands", "v3_patient_question"],
  ["v3-question-nausea", ["тошнило ли вас сегодня?", "бывала ли у вас рвота?"], [ask("nausea_vomiting")], "commands", "v3_patient_question"],
  ["v3-question-pain", ["беспокоит ли вас боль сейчас?", "болит ли у вас что-нибудь?"], [ask("pain")], "commands", "v3_patient_question"],
  ["v3-question-meds", ["какие таблетки вы обычно принимаете?", "принимаете ли вы постоянно какие-нибудь препараты?"], [ask("medications")], "commands", "v3_patient_question"],
  // A category of investigations is not one investigation.
  ["v3-category-1", ["нужны маркеры воспаления в крови", "хочу увидеть воспалительные показатели"], [untouched("ORDER_TEST", "testId")], "clarify", "v3_category"],
  ["v3-category-2", ["сделайте визуализацию живота"], [untouched("ORDER_TEST", "testId")], "clarify", "v3_category"],
  // Compound: one known action plus one novel action.
  ["v3-compound-1", ["оак и гляньте желчный на ультразвуке", "оак, а также гляньте желчный на ультразвуке"], [test("cbc"), test("ultrasound_abdomen")], "commands", "v3_compound"],
  ["v3-compound-2", ["срб и посмотрите брюшную полость на сонографии"], [test("crp"), test("ultrasound_abdomen")], "commands", "v3_compound"],
  ["v3-compound-3", ["пальпирую живот, а также проверьте клеточный состав крови"], [exam("abdomen"), test("cbc")], "commands", "v3_compound"],
  // Promoted preparation / staffing actions in non-canonical wording.
  ["v3-preop-1", ["пусть пациент пока ничего не ест и не пьёт"], [cmd("SET_NPO")], "commands", "v3_preop"],
  ["v3-preop-2", ["поставьте катетер в вену", "обеспечьте венозный доступ, пожалуйста"], [cmd("ESTABLISH_IV_ACCESS")], "commands", "v3_preop"],
  ["v3-staff-1", ["будьте добры, пригласите дежурного хирурга к пациенту"], [cmd("CALL_STAFF", { role: "surgeon" })], "commands", "v3_staff"],
  // Protected classes: never a guessed or invented parameter.
  ["v3-protected-1", ["кетопрофен или кеторолак 30 мг в/м"], [untouched("ORDER_MEDICATION", "drugId")], "clarify", "v3_protected"],
  ["v3-protected-2", ["дайте кетопрофен как обычно"], [cmd("ORDER_MEDICATION", { drugId: "ketoprofen" }, ["doseMg", "dose", "route"])], "clarify", "v3_protected"],
  // Hedged / deferred wording is not a committed action.
  ["v3-hedge-1", ["если станет хуже, то, наверное, прооперируем", "пожалуй, придётся оперировать, но пока не решил"], [], "no_action", "v3_hedge"],
  ["v3-hedge-2", ["может быть, сделаем КТ позже"], [], "no_action", "v3_hedge"],
];

export function v3Corpus() {
  const original = stage2Corpus().map((row) => ({ ...row, split: splitOfGroup(row.group), corpusVersion: "stage2" }));
  const added = [];
  for (const [group, variants, commands, disposition, category] of V3_CASES) {
    for (const text of variants) {
      added.push({
        id: `v3-${String(added.length + 1).padStart(3, "0")}`, category, group, text, turnContext: {}, provenance: { kind: "synthetic", wave: "interpreter_v3" },
        gold: { commands, disposition, reviewStatus: "draft_linguistic", reviewer: null }, split: "DEVELOPMENT", corpusVersion: "v3",
      });
    }
  }
  return [...original, ...added];
}

export const suiteRows = (rows, suite) => rows.filter((row) => row.split === suite);

/** Same recipe as prepareStage2.mjs: hash of the raw split rows. Equals the hash in the clean holdout manifest. */
export function holdoutFingerprint() {
  const rows = stage2Corpus().filter((row) => splitOfGroup(row.group) === "HOLDOUT");
  return { rows: rows.length, hash: hash(JSON.stringify(rows)) };
}

/**
 * Clinician adjudication template. It is a SEPARATE artifact: it references
 * rows by id and records a hash of the draft gold it reviewed, so a decision can
 * never silently drift from the label it was made against. Nothing here is
 * adjudicated until a named clinician fills `decision`.
 */
export function goldAdjudicationTemplate(rows) {
  return {
    schema: "onqol-gold-adjudication-v1",
    status: "PENDING_CLINICIAN_ADJUDICATION",
    note: "Draft linguistic gold is not clinically approved. Decisions: confirm | amend | exclude. An amend carries a full replacement gold.",
    rows: Object.fromEntries(rows.map((row) => [row.id, {
      draftGoldHash: hash(JSON.stringify(row.gold)), decision: null, adjudicator: null, adjudicatedAt: null, amendedGold: null, notes: null,
    }])),
  };
}

export function effectiveGold(row, adjudication) {
  const entry = adjudication?.rows?.[row.id];
  if (entry?.decision === "amend" && entry.amendedGold) return { gold: entry.amendedGold, source: "adjudicated_amended" };
  if (entry?.decision === "confirm") return { gold: row.gold, source: "adjudicated_confirmed" };
  if (entry?.decision === "exclude") return { gold: null, source: "adjudicated_excluded" };
  return { gold: row.gold, source: "draft_linguistic" };
}
