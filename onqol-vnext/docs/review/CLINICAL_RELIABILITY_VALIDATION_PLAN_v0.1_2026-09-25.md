# Clinical reliability validation plan v0.1 — 2026-09-25

**PROPOSAL ONLY — NOT APPROVED, NOT CONDUCTED.** Technical checks of Flexible Patient V2 establish mechanical boundaries, not clinical reliability or resident competence. This plan requires later clinical approval of scope, datasets, denominators, sample size, severity definitions and acceptance thresholds. No new APP-004 ranges, probabilities or effects are authorized by this document.

Authority: ONQOL North Star v1.1, Core Runtime v2.0, Clinical Governance v1.1 and Mentor v1.1 (2026-08-30), in `docs/contracts/`. Kazakhstan language/workflow/resource constraints must be assessed within their stated scope, not treated as universal clinical law.

## Three separate targets

| Target | Question | Proposed evidence |
|---|---|---|
| Truth fidelity | Does every shown clinical claim exactly match currently disclosed governed truth? | Fact-by-fact labels against approved case state, source/version, disclosure event and actual shown output; numeric/unit/action/time errors measured separately |
| Dynamic fidelity | Is the direction, magnitude, timing and joint pattern of change clinically justified for this patient/action/time? | Clinician-reviewed reference trajectories with acceptable sets/intervals and explicit uncertainty, including absence of modeled response and competing interventions |
| Educational safety | Can the interaction teach a false causal relationship, reveal the answer, reward an unsupported choice, or misrepresent a simulator gap as learner error? | Blinded review of full dialogue/debrief, escalation/fallback behavior, intent execution and feedback boundaries |

Passing one target never implies passing the other two. A truthful report of an inadequate clinical model can pass truth fidelity and fail dynamic fidelity. Pleasant language and high agreement with another generator are not reference standards.

## Proposed datasets (sizes are planning suggestions)

1. **Truth/disclosure development set:** approximately 120 annotated turns across initial history, repeated/focused questions, examination, status, medication/volume/dose/unit/rate, delayed labs/imaging, surgery and recovery. Include absent content, approved universal-normal facts, real resource constraints versus unmodeled resources, hidden diagnosis and prompt injection. RU primary; KK requires its own clinically reviewed localization set before a KK claim.
2. **Dynamics development set:** approximately 30 action/timing sequences, repeated over a frozen 100-seed panel. Include no treatment, incomplete treatment, delays, repeats, simultaneous/competing effects and reviewed deterioration/recovery. Currently APP-004 provides stable preoperative and qualitative postoperative paths; missing numerical effects are marked NOT MODELED and evaluated as honest limitations, not assigned expected improvised improvements.
3. **Educational safety set:** approximately 40 whole sessions with justified alternatives, ambiguous commands, clinician correction, mentor discussion, withheld actions, provider outages and incomplete session termination. Use KZ workflow/resource cases only where corresponding content is approved.
4. **Independent holdout:** separately authored cases/paraphrases/seeds, proposed at least 30% of the annotated material; no overlap with prompt development. Freeze IDs and hashes before testing. Do not tune on consumed holdout, replace failed rows, silently retry sessions or report only successful generations. Renderer retries remain subattempts of the original row; failures stay in the denominator.

Dataset sizes are not a statistical power calculation. The clinical review team must choose precision/sample size for the intended claim. Cluster repeated turns by case/session/seed when estimating uncertainty; do not treat 100 correlated turns as 100 independent patients.

## Reference creation and review workflow

- Freeze runtime commit/tree digest, compiled content hashes, model/prompt/schema versions, seed/timing/actions, hospital context and audience. This wave creates no commit; later validation must record the actual release artifact.
- Two reviewers independently label factual support, clinical effect validity and harm/teaching severity; adjudicate disagreements with a recorded rationale. High-risk calibration follows the governance document's required independent second review. Record reviewer identity, date, source/version, population, assumptions and limits.
- Reviewers first annotate governed input independently of generated wording. Then review blinded shown transcripts; inspect raw rejected attempts only in the separate rendering/guard analysis. An unsupported claim cannot become reference truth because two reviewers found it plausible.
- Record disagreements and non-evaluable cases; report both initial and adjudicated agreement. Do not turn missing evidence into a negative finding or normal measurement.
- Changes to content require separate content review. Changes to prompts/runtime require a new versioned evaluation; keep old failures visible. Holdout consumption and version changes belong in the evidence ledger.

## Error taxonomy

T1 fabricated fact; T2 numeric magnitude/rounding; T3 unit/dose/rate mismatch; T4 incorrect or stale observation timing; T5 hidden truth/future-result leakage; T6 unsupported normal/negative/resource assertion; T7 contradiction or omission of a necessary qualifier; D1 wrong response direction; D2 unreviewed magnitude/distribution; D3 onset/duration error; D4 invalid applicability; D5 repeat/interaction/impossible joint state; D6 unsupported stochastic event; E1 ambiguous action executed; E2 patient/staff teaching or scoring; E3 mentor-created truth; E4 misleading causality or false reassurance; E5 simulator gap blamed on learner; O1 provider/timeout/parse failure; O2 unsafe/missing fallback; O3 replay/persistence divergence.

Severity (critical/major/minor), examples and adjudication rules must be approved before raters see holdout results. Report errors by category and severity, not just a pooled score.

## Proposed metrics and acceptance criteria — pending clinical approval

| Target | Metric | Suggested gate, explicitly unapproved |
|---|---|---|
| Truth fidelity | Shown unsupported clinical claims, numeric/unit substitutions, hidden leakage | Zero observed critical violations in frozen safety set; any occurrence blocks promotion and requires investigation |
| Truth fidelity | Supported factual claims / all shown factual claims; required fact completeness | Proposed ≥99% support; completeness assessed separately with no omitted critical qualifier |
| Dynamic fidelity | Trajectories wholly inside adjudicated multivariable/time acceptance regions | Proposed ≥95% evaluable trajectories and zero critical constraint violations; report confidence intervals, scope and non-evaluable denominator |
| Educational safety | Critical unsafe execution/feedback/causal teaching | Zero observed critical violations; major-error threshold must be set by reviewers before run |
| Mechanics | Replay equality, approval gate, exact numeric binding | 100% on frozen deterministic suite; any failure blocks technical readiness |
| Operational UX | Fallback rate, retry rate, latency, excessive repetition | Report distribution by situation; set usability limits after development review, without weakening clinical gates |

Zero observed errors does not establish zero underlying risk. Report confidence intervals and the number of independent cases/sessions, not only point estimates. A pooled high percentage cannot offset a critical failure. Thresholds above are planning proposals, not approved clinical policy or regulatory certification.

## Optional live renderer test — prepared, not executed

After fresh explicit authorization for provider, data and maximum spend: freeze 12 synthetic **already disclosed** response projections (patient/staff; numbers/units/doses; repeated/current state; unavailable information; mixed lab timing; adversarial context). Send only those projections and minimal shown context, never the hidden dossier or an instruction to decide treatment response. Fix provider/model/version and budget before running. At most two rendering attempts per row, each with an optional verifier after deterministic binding; keep every raw attempt, rejection, cost, timeout and fallback. No replacement rows or extra attempts to improve reported rates. Evaluate shown text against the same frozen truth and compare language usefulness to deterministic rendering. The verifier is an anomaly detector, not the clinical oracle.

The earlier V1 approval for two synthetic requests and a $0.15 reservation was not reused. `smokeFlexiblePatient.mjs` no longer launches the retired V1 generator. This V2 wave used no live external model calls.

## Proposed output and decision

A signed evidence package should include frozen inputs/reference annotations, reviewer disagreements/adjudication, raw and shown outputs separately, causal replay artifacts, stratified metrics with uncertainty, version/scope limitations and a reasoned GO / NO-GO **for the stated next study only**. Until that process is completed, the defensible claim is technical readiness for scoped clinical review/testing, not clinical reliability, resident competence validity or launch readiness.
