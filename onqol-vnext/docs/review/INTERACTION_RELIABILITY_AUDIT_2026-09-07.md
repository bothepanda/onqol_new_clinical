# Interaction Reliability Remediation — Audit & Root Cause (2026-09-07)

Pre-implementation audit for the *Hybrid LLM Language Interpreter + Runtime Interaction Repair* wave.
No code changed yet. Evidence: a raw pilot session export (removed from Git; private store only)
(copied from the reported learner-pilot session).

---

## 1. Root cause

### 1.1 Which path ran, and why

`AI_INTERACTION_V2` is **not** the LLM master switch. Read in code:

- `src/ai/interpreter/interpretTurn.js` — the public interpreter entrypoint calls
  `interpretDeterministically(...)` **unconditionally**. There is no model call on the
  authoritative path, flag or no flag.
- `src/ai/interaction/featureFlags.js` — `AI_INTERACTION_V2` is an opt-in rollback flag,
  default `false`, never read from env.
- `src/core/session/submitLearnerTurn.js:43` — when `AI_INTERACTION_V2` is **true** it additionally
  fires `runSplitSemanticShadow(...)` as a **shadow** promise that is *never awaited by the clinical
  path* and whose output "has no authority and is deliberately kept outside the domain event log".

So `AI_INTERACTION_V2 = false` in the failed session disabled only the **shadow telemetry** of the
Wave 2.3 split-semantic experiment. It did **not** disable "the LLM interpreter" — because there is
no LLM interpreter on the live path in the first place. Every ON QOL learner turn today, pilot
included, is interpreted by the deterministic Russian parser in
`src/ai/interpreter/deterministicInterpreter.js` (948 lines of regex/alias/phrase logic).

`ai_telemetry: []` in the export confirms no model call occurred.

**Corollary:** the pilot is currently running a parser the contracts always intended to be the
*fast path*, as if it were the *whole* interpreter. That is the systemic root cause; the
individual failures below are its symptoms.

### 1.2 No provider available in this environment

`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are both unset. `server/aiGateway.mjs` returns `501
no_provider_configured` without a key; the Wave 2.1/2.2/2.3 scripts all no-op the same way.
The provider seam exists and is clean (`src/ai/providerClient.js`,
`createGatewayProviderClient` → `/api/ai/interpreter`), but the semantic path **cannot be
executed or tested here**. This splits the wave (see §4).

---

## 2. Failed-session symptom → mechanism (all verified in code)

| # | Learner input | Observed | Mechanism | Spec ref |
|---|---|---|---|---|
| A | `‹pilot turn A›` | EXAMINE→CLARIFY(region) + TAKE_HISTORY→EXECUTED; **clock stays 0** | commands OK; but no `consumesMinutes` for history/exam (see F) | §14 |
| B | `‹pilot turn B›` | EXAMINE abdomen OK | — (works) | — |
| C | `‹pilot turn C›` | only `ORDER_TEST cbc`; `оам`, `узи обп` dropped; `‹token›` unmatched | `splitFragments` (`deterministicInterpreter.js:922‑930`) splits on `, ; и` only. `"оак оам узи обп"` is **one** fragment; space‑separated investigation lists are not decomposed, so only the first alias hits. `ост` is genuinely unknown. | §8, §20‑C |
| D | `‹pilot turn D›` | only `ultrasound_abdomen`; `‹token›` dropped | same splitter: `+` is not a separator. `‹token›`/pelvic is unsupported content (see E). | §8, §20‑D |
| E | `‹pilot turn E›` | mapped to `ultrasound_abdomen` (**wrong**) + created a 2nd duplicate US order | `vocabulary.js:28` maps bare `"узи" → ultrasound_abdomen`; there is **no** pelvic alias and **no `pelvic_ultrasound` in `investigation_timing`** (`trajectories.yaml:456`). Bare `узи` greedily matches the qualified phrase. | §7, §20‑E |
| F | history / exam / order / med | `clock.elapsedMinutes` never leaves 0 across 9 turns | `submitLearnerTurn.js` advances time only for a stated wait or `results[].consumesMinutes > 0`. In `executeCommand.js` **only TRANSPORT returns `consumesMinutes`** (line 727). History, examination, ordering, treatment return none → pending results scheduled at `dueAtMinutes 40‑85` never come due. | §14, §15 |
| G | `обезболить` | intent `CLINICAL_REASONING`, 0 commands, unmatched | deterministic parser has no generic‑analgesia intent; bare verb matches nothing → falls through to reasoning no‑op | §10, §20‑F |
| H | `‹pilot turn H›` | intent `CLINICAL_REASONING`, whole string unmatched | `кетотоп` (ketoprofen slang) is not an alias; `дать … мг` without a known drug token matches no medication rule | §7, §20‑G |
| I | `кетопрофен 30 мг` → `в/м` | route **merged** correctly into pending order, then `ORDER_VALIDATION_FAILED` with `reasonKey=null, ruleIds=[], governanceBlocked=[]` | contextual‑ellipsis merge actually **works**. The failure is reporting: `validateMedicationOrder` returns `{ ok:false, code, textRu, classification }`, but `submitLearnerTurn.js:173` reads `result.reasonKey` (wrong field name — it is `code`) and `result.firedRules` (absent). The real reason (ketoprofen IM approved dose is 100 mg q12h, so 30 mg IM = `dose_not_approved`) is computed and then dropped. | §12, §20‑I |
| J | repeated `узи …` | 2nd `ultrasound_abdomen` pending created (`t3-c0`, then `t4-c0`) | no duplicate‑order guard in `executeCommand.js` ORDER_TEST | §13, §20‑J |
| K | — | `revealed.results: ["cbc","ultrasound_abdomen"]` while both `result=null, status=ordered` | `TEST_ORDERED` reducer marks the test id revealed at order time; "known to be pending" and "result shown to learner" are conflated | §16 |

None of these requires an LLM to fix. C, D, E, F, I, J, K are deterministic-layer defects and
are the bulk of what made the session unusable.

---

## 3. Architecture: current vs intended

**Current (live path):**
```
learner text → interpretDeterministically() → commands → validateCommand → executeCommand
                                                                     ↓
                                              (AI_INTERACTION_V2 only) shadow split-semantic, discarded
```

**Intended (contracts + this wave):**
```
learner text
  → normalization / trivial deterministic fast path (unambiguous: ОАК, в/м, да)
  → semantic interpretation when needed (compound, slang, typos, ellipsis, mixed channels)   [LLM]
  → structured interpretation object (actions / reasoningClaims / patientQuestions / … / unresolved)
  → deterministic schema + concept-registry validation                                        [code]
  → command pipeline → Clinical Rules / Patient Engine / Hospital                              [code]
```
LLM never mutates state or executes; it only proposes structure, which the registry must then accept.

---

## 4. Proposed split (because no provider key is present here)

### Stage 1 — deterministic interaction repair (no key needed, fully testable now)
1. **Multi-action decomposition** (C, D): decompose space-separated investigation lists and `+`/`и`/`,`/`;`
   joined lists into independent `ORDER_TEST` commands; keep reasoning+action both (§8).
2. **Concept resolution guard** (E): a qualified `узи … (малого таза|тазовое|омт)` must **not** fall back
   to bare `ultrasound_abdomen`; emit an unresolved fragment + operational clarification. Same for `ост`, `оам`
   only if unsupported. (`оам`/urinalysis **is** supported — add the alias.)
3. **Explainable validation failure** (I): fix the `code`→`reasonKey` field mapping in `submitLearnerTurn.js`
   and thread `code` + `textRu` + `classification` into the trail event and the learner-facing renderer. Never
   emit `ORDER_VALIDATION_FAILED` with all-null context again. Never label a not-reviewable numeric "unsafe".
4. **Duplicate-order guard** (J): ORDER_TEST for an id already `ordered|queued|in_progress` and not an explicit
   repeat → operational "уже заказано, результат ожидается", no new pending, not scored as error.
5. **Clinical clock** (F): make history / examination / investigation-ordering / treatment-ordering advance
   simulated time using existing timing. **Open question for you:** `investigation_timing` has result ETAs but
   there is **no authored duration for "take history" / "perform examination"**. Per §14 I will *report this
   gap*, not invent a number — unless you point me to an approved value. Minimum acceptable fix: ordering a test
   advances the clock enough that its own `dueAtMinutes` is reachable and pending results deliver (§15).
6. **Revealed-state integrity** (K): separate `investigations.ordered` (pending, known) from `revealed.results`
   (result actually shown). Keep replay/export back-compat.
7. **Generic clinical intent** (G, H): `обезболить` / `антибиотик` / `инфузия` → recognised action intent with
   missing drug/dose/route → operational clarification from the hospital, never an auto-picked drug. `кетотоп`
   → resolve to `ketoprofen` **only** as an alias in the controlled registry, else ask which drug.
8. **Interpreter-mode telemetry** (§17): record the interpreter mode actually used (`deterministic` / `hybrid`)
   in the session export so a reader can tell which path ran.
9. **Russian clinical-language regression corpus** (§21) + **negative/injection tests** (§22), run against the
   deterministic path and a mocked interpreter.

### Stage 2 — hybrid semantic interpreter (needs `OPENAI_API_KEY` or another provider)
10. Semantic interpreter task behind the existing `ProviderClient` seam, schema-constrained output,
    low-variance config, fail-closed on ambiguity, structured-only.
11. Recorded structured interpretation in events so **replay never re-calls the model** (§19).
12. Provider/model/latency/token telemetry (§18).
13. Live semantic smoke (§24) + the §25 fresh-session acceptance demo.

**CI stays mock-only; live provider test is separate and optional (§24).**

---

## 5. Contract-conflict watch

No conflict found yet. One content **gap** (not a conflict): `pelvic_ultrasound` is not supported
content. This wave will treat pelvic-US requests as unsupported/clarify; adding it is a separate
content+clinical-review item, out of scope here (§2, and clinical content is frozen for this wave).

---

## 6. Recommendation

Proceed with **Stage 1 now** — it closes most of the failed session and is verifiable without a
provider. **Stage 2 is NO-GO in this environment** until a provider key is supplied. Do not report
`GO_FOR_LEARNER_PILOT` until Stage 2 is done and the §25 demo passes with a real model.
