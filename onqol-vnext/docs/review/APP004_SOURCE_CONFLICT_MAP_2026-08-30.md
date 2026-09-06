# APP-004 source conflict map — 2026-08-30 (resolved 2026-08-31)

Status: C-01, C-02 and C-03 were resolved by the Clinical Lead (2026-08-31) and Sarina T.T.
(2026-08-31) for APP-004 pilot scope. C-04 remains deferred (out of APP-004 scope). No
conflict was resolved by averaging claims. Reference evidence and KZ jurisdiction are kept
as distinct layers, never merged.

## C-01 — operation timing

- source_A: Kazakhstan acute appendicitis protocol, revision 2018, Protocol No. 61 (approved 2019-03-04)
- source_B: WSES Jerusalem Guidelines, 2025 edition (JAMA Surgery 2026; DOI 10.1001/jamasurg.2025.6218)
- claim_A: acute appendicitis is an indication for emergency operation
- claim_B: uncomplicated appendicitis selected for surgery may be delayed in hospital within 24 hours
- jurisdiction: Kazakhstan versus international reference
- population: adults with uncomplicated acute appendicitis
- resource_assumptions: hospital observation and operative capacity within the stated window
- reviewer_decision (2026-08-31): **RESOLVED.** Reference Hospital uses claim_B — WSES
  contemporary evidence: for uncomplicated appendicitis selected for surgery, appendectomy
  may be safely scheduled within an in-hospital window up to 24 h when clinically
  appropriate. This is permission, not a target delay and not a requirement to wait. The
  older KZ "emergency operation" framing (claim_A) remains jurisdictional context and is
  only surfaced, labelled as a KZ jurisdictional difference, when KZ context is discussed.
  The two are not averaged or merged.
- reviewers: Clinical Lead 2026-08-31; Sarina T.T. 2026-08-31
- runtime_layer: clinical_rule
- runtime_effect: `RULE-DELAY-BEYOND-24H-UNCOMPLICATED` (`approved_for_training`,
  `SRC-WSES-2025`, second review recorded). Non-immediate appendectomy is not penalised;
  only delay beyond the reviewed window may be challenged.
- status: RESOLVED_APP004_PILOT

## C-02 — analgesia

- source_A: Kazakhstan acute appendicitis protocol, revision 2018/2019
- source_B: current international practice represented in the supplied 2026 evidence packet; drug-specific response still lacks reviewed calibration
- claim_A: prehospital analgesics are prohibited
- claim_B: the local prehospital prohibition must not be generalized into universal clinical truth
- jurisdiction: Kazakhstan prehospital statement versus reference-hospital care
- population: suspected acute appendicitis, with care setting material to interpretation
- resource_assumptions: medication and monitoring availability depend on hospital profile
- reviewer_decision (2026-08-31): **RESOLVED.** The KZ prehospital analgesia prohibition
  (claim_A) is not generalized into universal in-hospital Reference care. Reviewed
  in-hospital analgesia is permitted and must not be withheld to preserve abdominal
  examination findings. Local/KZ formulary options (metamizole, ketoprofen) remain
  explicitly local, formulary-aware alternatives — not mandatory universal care. Drug
  identity/dose/route/safety are approved; numeric response envelopes are **not** approved
  and remain a separate pending calibration.
- reviewers: Clinical Lead 2026-08-31; Sarina T.T. 2026-08-31
- runtime_layer: clinical_rule
- runtime_effect: `MED-PARACETAMOL/IBUPROFEN/TRAMADOL/METAMIZOLE-KZ/KETOPROFEN-KZ-PILOT`
  and `MED-NSAID-SUITABILITY-CHECKS` approved; `EFFECT-ANALGESIA-*` response envelopes stay
  `pending` and out of APP-004 scope.
- status: RESOLVED_APP004_PILOT (response-magnitude calibration still pending, out of scope)

## C-03 — imaging sequence

- source_A: older/local ultrasound-first pathways
- source_B: IDSA 2024 guideline update for complicated intra-abdominal infections
- claim_A: ultrasound precedes CT
- claim_B: CT may be initial imaging in nonpregnant adults; ultrasound is not a universal gate
- jurisdiction: local workflow versus international reference
- population: nonpregnant adults with suspected appendicitis when imaging is indicated
- resource_assumptions: CT availability, contrast capability and pregnancy status are explicit hospital/patient facts
- reviewer_decision (2026-08-31): **RESOLVED.** CT abdomen/pelvis may be the first imaging
  test in a non-pregnant adult when imaging is indicated; ultrasound is not a mandatory
  prerequisite and a nondiagnostic/nonvisualized ultrasound is not a negative study. CT is a
  whole abdomen/pelvis study. `RULE-US-BEFORE-CT` is not restored. No universal
  "creatinine required before contrast CT" rule — where present at all it is a
  hospital/radiology policy in the hospital layer. Any local US-first workflow stays in the
  hospital/jurisdiction layer.
- reviewers: Clinical Lead 2026-08-31; Sarina T.T. 2026-08-31
- runtime_layer: hospital_rule (local sequencing) / clinical_rule (CT-first permitted)
- runtime_effect: `app004Remediation.test.js` t13/t14/t21 and `coreRuntimeContract.test.js`
  PBC-9 assert CT without prior US and nondiagnostic US not rendered negative.
- status: RESOLVED_APP004_PILOT

## C-04 — postoperative antibiotics in complicated appendicitis

- source_A: older surgical textbooks describing 4–5 day courses
- source_B: WSES Jerusalem Guidelines, 2025 edition
- claim_A: postoperative treatment commonly lasts 4–5 days
- claim_B: shorter 2–3 day postoperative courses are reported after adequate source control
- jurisdiction: international; future KZ reconciliation required
- population: complicated appendicitis after adequate source control, not the current uncomplicated APP-004 phenotype
- resource_assumptions: adequate source control and relevant phenotype are confirmed
- reviewer_decision: deferred. Newer disease-specific guideline (claim_B) takes precedence
  for a future reference rule, subject to jurisdictional review, once a reviewed complicated
  phenotype exists. Complicated appendicitis is outside APP-004 v1.
- runtime_layer: clinical_rule
- status: CLOSED_DEFERRED_OUT_OF_SCOPE

No conflict was resolved by averaging claims. Reference evidence and KZ jurisdiction remain
distinct layers.
