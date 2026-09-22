import { test } from "node:test";
import assert from "node:assert/strict";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };
import { emptyRoster, participantKeyOf, participantOfSession, registerParticipant, assignSession } from "./residentParticipants.mjs";
import { COLLECTION_TARGETS, SPLIT, assertParticipantDisjoint, assignParticipants, classifyTurn, emptyPlan, planOnlyAppends } from "./residentSplits.mjs";
import { buildResidentManifest, classifyLedger, emptyLedger, emptyReadings, harvestExport, ingest, ledgerSummary, markExposure } from "./residentTurnCollection.mjs";
import { labelVocabulary } from "./goldReview.mjs";
import { applyResidentAdjudication, assertBlindPacket, buildReleasedRows, buildResidentPacket, checkResidentReview, compareReviews, emptyResidentLabel, reviewRecord, toEvaluationGold, validateResidentLabel } from "./residentGold.mjs";
import { findContentViolations, findGovernanceViolations } from "./evidenceGovernance.mjs";

const vocabulary = labelVocabulary(withShared(disease, shared));

// ------------------------------------------------------------------ participants

test("a participant is an alias, never a name; the tracked key cannot be recomputed without the private salt", () => {
  const roster = registerParticipant(emptyRoster(), "P07");
  for (const bad of ["Aigerim", "aigerim.k@nu.edu.kz", "Dr. A", "P7", "", undefined]) assert.throws(() => registerParticipant(emptyRoster(), bad), /participant_alias_invalid/);
  const other = registerParticipant(emptyRoster(), "P07");
  assert.notEqual(participantKeyOf(roster, "P07"), participantKeyOf(other, "P07"), "a different salt gives a different key");
  assert.match(roster.participants.P07.key, /^PK[0-9a-f]{10}$/);
});

test("a session belongs to exactly one participant, forever", () => {
  let roster = registerParticipant(registerParticipant(emptyRoster(), "P01"), "P02");
  roster = assignSession(roster, "Sabc", "P01");
  assert.equal(participantOfSession(roster, "Sabc").alias, "P01");
  assert.equal(assignSession(roster, "Sabc", "P01"), roster, "idempotent");
  assert.throws(() => assignSession(roster, "Sabc", "P02"), /session_already_assigned/);
  assert.throws(() => assignSession(roster, "Sxyz", "P99"), /participant_not_registered/);
  assert.equal(participantOfSession(roster, "Snone"), null);
});

// ------------------------------------------------------------------ participant-grouped splits

const keys = Array.from({ length: 10 }, (_, i) => `PK${String(i).padStart(10, "0")}`);

test("splits are per participant, deterministic regardless of arrival order, and near the target share", () => {
  const a = assignParticipants(emptyPlan(), keys.map((participantKey) => ({ participantKey })));
  const b = assignParticipants(emptyPlan(), [...keys].reverse().map((participantKey) => ({ participantKey })));
  assert.deepEqual(Object.fromEntries(Object.entries(a.assignments).map(([k, v]) => [k, v.split])), Object.fromEntries(Object.entries(b.assignments).map(([k, v]) => [k, v.split])));
  const evaluation = Object.values(a.assignments).filter((x) => x.split === SPLIT.EVALUATION).length;
  assert.ok(evaluation >= 3 && evaluation <= 5, `evaluation participants ${evaluation} of 10`);
});

test("assignment is append-only: a later batch never moves an existing participant", () => {
  const first = assignParticipants(emptyPlan(), keys.slice(0, 4).map((participantKey) => ({ participantKey })));
  const second = assignParticipants(first, keys.map((participantKey) => ({ participantKey })));
  assert.ok(planOnlyAppends(first, second));
  for (const key of keys.slice(0, 4)) assert.deepEqual(second.assignments[key], first.assignments[key]);
  assert.notEqual(first.chain, second.chain);
  const tampered = structuredClone(second);
  tampered.assignments[keys[0]].split = tampered.assignments[keys[0]].split === SPLIT.EVALUATION ? SPLIT.DEVELOPMENT : SPLIT.EVALUATION;
  assert.equal(planOnlyAppends(first, tampered), false);
});

test("a participant whose words the developers have seen can only be development", () => {
  const plan = assignParticipants(emptyPlan(), [{ participantKey: keys[0], forcedSplit: SPLIT.DEVELOPMENT }, ...keys.slice(1).map((participantKey) => ({ participantKey }))]);
  assert.equal(plan.assignments[keys[0]].split, SPLIT.DEVELOPMENT);
  const turn = { exposure: "seen_by_developers" };
  assert.equal(classifyTurn({ turn, participantKey: keys[0], plan }).evaluationEligible, false);
  const evalKey = Object.entries(plan.assignments).find(([, v]) => v.split === SPLIT.EVALUATION)[0];
  assert.equal(classifyTurn({ turn: { exposure: "unseen" }, participantKey: evalKey, plan }).evaluationEligible, true);
  assert.equal(classifyTurn({ turn: { exposure: "seen_by_developers" }, participantKey: evalKey, plan }).evaluationEligible, false, "seen words are never evaluation data");
});

test("an unlinked session is quarantined: in no split, never evaluation-eligible", () => {
  const c = classifyTurn({ turn: {}, participantKey: null, plan: emptyPlan() });
  assert.deepEqual([c.split, c.evaluationEligible, c.reasons], [null, false, ["session_not_linked_to_a_participant"]]);
});

test("assertParticipantDisjoint refuses a participant in both splits", () => {
  assert.ok(assertParticipantDisjoint([{ participantKey: "PK1", split: SPLIT.DEVELOPMENT }, { participantKey: "PK1", split: SPLIT.DEVELOPMENT }, { participantKey: null, split: null }]));
  assert.throws(() => assertParticipantDisjoint([{ participantKey: "PK1", split: SPLIT.DEVELOPMENT }, { participantKey: "PK1", split: SPLIT.EVALUATION }]), /participant_in_both_splits/);
});

// ------------------------------------------------------------------ scale: 150-250 turns, 60 is a floor

const exportOf = (id, count) => ({ export_schema_version: "1.0.0", session: { id, purpose: "learner_pilot" }, learner_turns: Array.from({ length: count }, (_, i) => ({ rawText: `реплика ${id} номер ${i}`, intent: "CLINICAL_ACTION", unmatchedFragments: [], interpretedCommands: [], commandOutcomes: [] })) });

test("the collection scales to 250 turns from several participants; nothing caps it at 60, and the gates say so", () => {
  let roster = emptyRoster();
  const harvested = [];
  for (let p = 1; p <= 8; p += 1) {
    const alias = `P${String(p).padStart(2, "0")}`;
    roster = registerParticipant(roster, alias);
    for (let s = 0; s < 2; s += 1) harvested.push(harvestExport(exportOf(`session-${p}-${s}`, 16), { fileName: `f${p}${s}.json`, fileHash: `h${p}${s}` }));
  }
  const state = ingest({ ledger: emptyLedger(), readings: emptyReadings() }, harvested);
  assert.equal(ledgerSummary(state.ledger).turns, 256);
  assert.equal(ledgerSummary(state.ledger).minimumReadinessTurns, 60);
  assert.deepEqual(ledgerSummary(state.ledger).plannedTurns, { min: 150, max: 250 });
  harvested.forEach((item, index) => { roster = assignSession(roster, item.sessionKey, `P${String(Math.floor(index / 2) + 1).padStart(2, "0")}`); });
  const plan = assignParticipants(emptyPlan(), Object.values(roster.participants).map((p) => ({ participantKey: p.key })));
  const classified = classifyLedger(state.ledger, { roster, plan });
  assert.ok(assertParticipantDisjoint(classified));
  const manifest = buildResidentManifest(state.ledger, { roster, plan });
  assert.equal(manifest.turnCount, 256);
  assert.equal(manifest.counts.development + manifest.counts.evaluation, 256);
  assert.equal(manifest.counts.quarantinedNoParticipant, 0);
  assert.ok(manifest.counts.evaluationEligible >= COLLECTION_TARGETS.minimumEvaluationTurns, "enough untouched evaluation turns when collected naturally");
  // every participant is in exactly one split, and both splits have participants
  assert.ok(manifest.participants.every((p) => [SPLIT.DEVELOPMENT, SPLIT.EVALUATION].includes(p.split)));
  assert.ok(new Set(manifest.participants.map((p) => p.split)).size === 2);
});

test("the tracked manifest carries no words, no alias, no system reading; exposure marks are irreversible facts", () => {
  let roster = registerParticipant(emptyRoster(), "P05");
  const state = ingest({ ledger: emptyLedger(), readings: emptyReadings() }, [harvestExport(exportOf("session-x", 3), { fileName: "a", fileHash: "h" })]);
  const sessionKey = Object.keys(state.ledger.sessions)[0];
  roster = assignSession(roster, sessionKey, "P05");
  const plan = assignParticipants(emptyPlan(), [{ participantKey: roster.participants.P05.key }]);
  const text = JSON.stringify(buildResidentManifest(state.ledger, { roster, plan }));
  for (const forbidden of ["реплика", "P05", "interpretedCommands", "\"text\":", "turnContext"]) assert.equal(text.includes(forbidden), false, forbidden);
  const seen = markExposure(state.ledger, [sessionKey]);
  assert.ok(Object.values(seen.turns).every((t) => t.exposure === "seen_by_developers"));
  assert.equal(buildResidentManifest(seen, { roster, plan }).counts.seenByDevelopers, 3);
  assert.equal(buildResidentManifest(seen, { roster, plan }).counts.evaluationEligible, 0);
});

// ------------------------------------------------------------------ label v2

const words = "Сначала ОАК, затем, возможно, КТ. Как давно болит? Думаю, это аппендицит, кетопрофен назначу позже";
const label = (extra = {}) => ({ ...emptyResidentLabel(), ...extra });
const cbc = { type: "ORDER_TEST", params: { testId: "cbc" }, commitment: "COMMITTED", sequenceStep: 1, evidence: "ОАК" };
const ct = { type: "ORDER_TEST", params: { testId: "ct_abdomen" }, commitment: "TENTATIVE", sequenceStep: 2, evidence: "возможно, КТ" };
const later = { type: "ORDER_MEDICATION", params: { drugId: "ketoprofen" }, commitment: "FUTURE_PLAN", evidence: "кетопрофен назначу позже" };
const full = label({ actions: [cbc, ct, later], patientQuestions: [{ topic: "onset", evidence: "Как давно болит" }], reasoning: [{ kind: "WORKING_DIAGNOSIS", evidence: "это аппендицит" }] });

test("a label v2 captures actions, commitment, questions, reasoning and ambiguity, and evidence must be the learner's own words", () => {
  assert.deepEqual(validateResidentLabel(full, { vocabulary, text: words }), []);
  const bad = (change) => validateResidentLabel(change, { vocabulary, text: words });
  assert.ok(bad(label({ actions: [{ ...cbc, commitment: "MAYBE" }] })).includes("actions[0].commitment_invalid"));
  assert.ok(bad(label({ actions: [{ ...cbc, evidence: "срочно ОАК" }] })).includes("actions[0].evidence_not_in_the_words"));
  assert.ok(bad(label({ actions: [{ ...cbc, sequenceStep: 0 }] })).includes("actions[0].sequenceStep_invalid"));
  assert.ok(bad(label({ patientQuestions: [{ topic: "nonsense", evidence: "Как давно болит" }] })).includes("patientQuestions[0].topic_unknown"));
  assert.ok(bad(label({ reasoning: [{ kind: "GUESS", evidence: "это аппендицит" }] })).includes("reasoning[0].kind_invalid"));
  assert.ok(bad(label({ ambiguity: { genuine: false, kinds: ["unclear_target"] } })).includes("ambiguity.kinds_without_genuine_ambiguity"));
  assert.ok(bad(label({ ambiguity: { genuine: true, kinds: [] } })).includes("ambiguity.kinds_missing"));
  assert.ok(bad(label({ ambiguity: { genuine: true, kinds: ["missing_parameter"] } })).includes("ambiguity.missing_parameter_without_absent_keys"));
  assert.ok(bad(label({ ambiguity: { genuine: true, kinds: ["unclear_commitment"] } })).includes("ambiguity.unclear_commitment_without_action"));
  assert.deepEqual(bad(label({ actions: [{ ...cbc, params: {}, absent: ["testId"] }], ambiguity: { genuine: true, kinds: ["missing_parameter"] } })), []);
});

test("evaluation gold: only COMMITTED actions and patient questions are commands; everything else must not execute", () => {
  const gold = toEvaluationGold(full);
  assert.deepEqual(gold.commands.map((c) => `${c.type}:${c.params.testId ?? c.params.topic}`), ["ORDER_TEST:cbc", "ASK_PATIENT:onset"]);
  assert.deepEqual(gold.mustNotExecute.map((c) => c.commitment), ["TENTATIVE", "FUTURE_PLAN"]);
  assert.equal(gold.disposition, "commands");
  const clarify = toEvaluationGold(label({ actions: [{ type: "ORDER_MEDICATION", params: { drugId: "ketoprofen" }, absent: ["doseMg"], commitment: "COMMITTED", evidence: "кетопрофен" }], ambiguity: { genuine: true, kinds: ["missing_parameter"] } }));
  assert.equal(clarify.disposition, "clarify");
  assert.equal(toEvaluationGold(label({ actions: [ct] })).disposition, "no_action");
  assert.equal(toEvaluationGold(label({ ambiguity: { genuine: true, kinds: ["multiple_readings"] } })).disposition, "unresolved");
});

// ------------------------------------------------------------------ blind packet, independent reviews, adjudication

const item = (id, text) => ({ id, text, turnContext: {} });

test("the blind packet holds words + context and the empty label, and refuses any leak of the system, the split or a person", () => {
  const leaky = { ...item("T1", "ОАК"), interpretedCommands: [{ type: "ORDER_TEST" }], split: "RESIDENT_EVALUATION", participantKey: "PK1", exposure: "unseen", gold: {} };
  const packet = buildResidentPacket({ items: [leaky, item("T2", "КТ?")], vocabulary, packetId: "RP-test" });
  const serialized = JSON.stringify(packet.items);
  for (const forbidden of ["interpretedCommands", "RESIDENT_EVALUATION", "PK1", "exposure", "gold", "ORDER_TEST\"}"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.ok(packet.items.every((entry) => Object.keys(entry).sort().join() === "context,itemId,label,text"));
  assert.throws(() => assertBlindPacket({ items: [{ itemId: "T1", text: "x", context: "", label: {}, interpretedCommands: [] }] }), /blind_packet/);
  assert.throws(() => assertBlindPacket({ items: [{ itemId: "T1", text: "x", context: "", label: { readings: 1 } }] }), /blind_packet_leaks/);
});

const packetOf = (texts) => buildResidentPacket({ items: Object.entries(texts).map(([id, text]) => item(id, text)), vocabulary, packetId: "RP-t" });
const fill = (packet, labels) => ({ packetId: packet.packetId, items: packet.items.map((entry) => ({ itemId: entry.itemId, label: labels[entry.itemId] })) });
const TEXTS = { T1: "ОАК и УЗИ ОБП", T2: "может быть КТ" };
const L1 = label({ actions: [{ type: "ORDER_TEST", params: { testId: "cbc" }, commitment: "COMMITTED", evidence: "ОАК" }, { type: "ORDER_TEST", params: { testId: "ultrasound_abdomen" }, commitment: "COMMITTED", evidence: "УЗИ ОБП" }] });
const L2 = label({ actions: [{ type: "ORDER_TEST", params: { testId: "ct_abdomen" }, commitment: "TENTATIVE", evidence: "КТ" }] });
const L2b = label({ actions: [{ type: "ORDER_TEST", params: { testId: "ct_abdomen" }, commitment: "COMMITTED", evidence: "КТ" }] });

test("an independent review is by an alias, is for this packet, and is validated against the learner's words", () => {
  const packet = packetOf(TEXTS);
  const ok = checkResidentReview({ packet, review: fill(packet, { T1: L1, T2: L2 }), reviewer: "R01", vocabulary });
  assert.equal(ok.ok, true);
  assert.equal(checkResidentReview({ packet, review: fill(packet, { T1: L1, T2: L2 }), reviewer: "Dr Aigerim", vocabulary }).errors[0], "reviewer_must_be_an_alias");
  assert.equal(checkResidentReview({ packet, review: fill(packet, { T1: L1, T2: L2 }), reviewer: "Claude", vocabulary }).errors[0], "reviewer_is_the_gold_author");
  assert.ok(checkResidentReview({ packet, review: { ...fill(packet, { T1: L1, T2: L2 }), packetId: "other" }, reviewer: "R01", vocabulary }).errors.includes("review_is_for_another_packet"));
  assert.ok(checkResidentReview({ packet, review: fill(packet, { T1: L1 }), reviewer: "R01", vocabulary }).errors.some((e) => e.startsWith("T2:")));
});

test("two independent reviews are compared field by field; a commitment-state difference is named; the same reviewer twice is refused", () => {
  const packet = packetOf(TEXTS);
  const a = reviewRecord({ packet, check: checkResidentReview({ packet, review: fill(packet, { T1: L1, T2: L2 }), reviewer: "R01", vocabulary }), completedAt: "2026-10-01T09:00:00Z" });
  const b = reviewRecord({ packet, check: checkResidentReview({ packet, review: fill(packet, { T1: L1, T2: L2b }), reviewer: "R02", vocabulary }), completedAt: "2026-10-01T10:00:00Z" });
  const result = compareReviews(a, b);
  assert.deepEqual([result.compared, result.agree, result.disagreements.length, result.commitmentStateOnlyDisagreements], [2, 1, 1, 1]);
  assert.deepEqual(result.disagreements[0].differsIn, ["actions"]);
  assert.throws(() => compareReviews(a, a), /reviewers_must_be_different_people/);
  assert.equal(a.reviewer, "R01");
  assert.ok(!JSON.stringify(a).includes("interpreted"));
});

test("adjudication is a third person's separate act: alias, attested de-identification, no overwrite", () => {
  const packet = packetOf(TEXTS);
  const rec = (alias, labels) => reviewRecord({ packet, check: checkResidentReview({ packet, review: fill(packet, labels), reviewer: alias, vocabulary }), completedAt: "2026-10-01T09:00:00Z" });
  const a = rec("R01", { T1: L1, T2: L2 }); const b = rec("R02", { T1: L1, T2: L2b });
  const base = { adjudicatedAt: "2026-10-02T09:00:00Z", deidentified: true };
  const run = (decisions, adjudication) => applyResidentAdjudication({ adjudication, decisions, reviewA: a, reviewB: b, vocabulary, texts: TEXTS });
  assert.ok(run({ T2: { ...base, choice: "accept_A", adjudicator: "Dr Bota" } }).errors[0].endsWith("adjudicator_must_be_an_alias"));
  assert.ok(run({ T2: { ...base, choice: "accept_A", adjudicator: "R01" } }).errors[0].endsWith("adjudicator_must_be_an_alias"));
  assert.ok(run({ T2: { ...base, choice: "accept_A", adjudicator: "A01", deidentified: false } }).errors[0].endsWith("deidentification_not_attested"));
  assert.ok(run({ T2: { ...base, choice: "amend", adjudicator: "A01", finalLabel: label({ actions: [{ ...L2.actions[0], evidence: "нет такого" }] }) } }).errors[0].includes("evidence_not_in_the_words"));
  const done = run({ T2: { ...base, choice: "accept_A", adjudicator: "A01" }, T1: { ...base, choice: "accept_B", adjudicator: "A01" } });
  assert.deepEqual([done.errors, done.adjudicated, done.adjudication.items.T2.independentAgreement, done.adjudication.items.T1.independentAgreement], [[], 2, false, true]);
  assert.ok(run({ T2: { ...base, choice: "accept_B", adjudicator: "A01" } }, done.adjudication).errors[0].endsWith("already_adjudicated"));
  const excluded = run({ T2: { choice: "exclude", adjudicator: "A01", adjudicatedAt: base.adjudicatedAt } });
  assert.equal(excluded.adjudication.items.T2.finalLabel, null);
});

test("release: development rows carry words and label; evaluation rows stay hash-only until the evaluation is completed; quarantined turns never leave", () => {
  const adjudication = { items: {
    T1: { finalLabel: L1, adjudicator: "A01", independentAgreement: true },
    T2: { finalLabel: L2, adjudicator: "A01", independentAgreement: false },
    T3: { finalLabel: L1, adjudicator: "A01", independentAgreement: true },
  } };
  const classified = [{ turnKey: "T1", participantKey: "PK1", split: SPLIT.DEVELOPMENT }, { turnKey: "T2", participantKey: "PK2", split: SPLIT.EVALUATION }, { turnKey: "T3", participantKey: null, split: null }];
  const texts = { T1: "ОАК и УЗИ ОБП", T2: "может быть КТ", T3: "ОАК и УЗИ ОБП" };
  const sealed = buildReleasedRows({ adjudication, texts, classified });
  assert.deepEqual(sealed.rows.map((r) => [r.id, r.sealed]), [["T1", false], ["T2", true]]);
  assert.equal(sealed.rows[1].text, undefined);
  assert.ok(!JSON.stringify(sealed).includes("может быть КТ"));
  assert.ok(sealed.rows[0].gold.commands.length === 2 && sealed.rows[0].text);
  const opened = buildReleasedRows({ adjudication, texts, classified, evaluationCompleted: true });
  assert.equal(opened.rows[1].sealed, false);
  assert.equal(opened.rows[1].gold.mustNotExecute[0].commitment, "TENTATIVE");
  // The released file is tracked: it must pass the governance content check and carry no participant alias.
  assert.deepEqual(findContentViolations(["x.json"], () => JSON.stringify(opened)), []);
});

// ------------------------------------------------------------------ governance covers every new private class

test("participant rosters, split plans, packets, reviews and working adjudication are forbidden in Git by name and by content", () => {
  const byName = ["private/participants/PARTICIPANT_ROSTER.json", "docs/x/REVIEWER_ROSTER.json", "docs/x/SESSION_PARTICIPANT_MAP.json", "docs/x/RESIDENT_SPLIT_PLAN.json", "docs/x/RESIDENT_PACKET_RP-1.json", "docs/x/RESIDENT_REVIEW_RP-1_R01.json", "docs/x/RESIDENT_ADJUDICATION_WORKING_RP-1.json"];
  assert.deepEqual(findGovernanceViolations(byName, { legacy: {} }).violations.map((v) => v.file), byName);
  const markers = ["onqol-participant-roster-v1", "onqol-reviewer-roster-v1", "onqol-resident-split-plan-v1", "onqol-resident-blind-packet-v1", "onqol-resident-review-v1", "onqol-gold-blind-review-v1", "onqol-resident-turn-ledger-v1", "onqol-resident-turn-system-readings-v1"];
  for (const marker of markers) assert.equal(findContentViolations(["renamed.json"], () => `{"schema": "${marker}"}`).length, 1, marker);
  assert.equal(findContentViolations(["a.json"], () => JSON.stringify({ export_schema_version: "1", session: { id: "session-1789", purpose: "learner_pilot" } })).length, 1);
  assert.equal(findContentViolations(["a.json"], () => JSON.stringify({ export_schema_version: "1", session: { id: "acceptance-run", purpose: "learner_pilot" } })).length, 0, "a scripted engineering session is not resident data");
});
