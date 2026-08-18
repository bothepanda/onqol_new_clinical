# ON QOL Clinical Evidence and Content Governance Specification

**Version:** 1.0  
**Date:** 2026-08-13  
**Status:** Safety and clinical content contract  
**Applies to:** all clinical modules, patient generation, mentor teaching, safety rules, pathway logic and future assessment

## 1. Why this document exists

ON QOL is intended for repeated educational use by surgical residents and may eventually be used at institutional or national scale.

At that scale, a plausible-sounding simulator is not enough.

The product must be able to answer a more important question:

> For every clinical fact or rule that can influence what the learner sees, what the patient does, what the mentor teaches or what the system evaluates, where did that rule come from, who reviewed it, which population and setting does it apply to, and which version is currently active?

The product must therefore separate generative language from clinical authority.

---

## 2. Non-negotiable principle

> No language model is a source of clinical truth.

The model may:

- understand free text;
- map language to reviewed concepts;
- summarize reviewed facts;
- formulate mentor feedback;
- explain a reviewed rule;
- generate natural dialogue.

The model may not create:

- a disease rule;
- a drug dose;
- a fluid dose;
- a threshold;
- an indication;
- a contraindication;
- an operative decision rule;
- a patient finding;
- a pathway transition;
- a safety classification;
- a score key.

Those must come from versioned, reviewable content.

---

## 3. V1 exclusion rule

The experimental V1 transcripts are a behavioral and UX reference only.

They must not be:

- imported into the clinical evidence corpus;
- used as RAG evidence;
- parsed into dose rules;
- parsed into thresholds;
- used to create expected actions;
- used to create safety rules;
- used to create scoring rules;
- cited to learners as medical sources.

This prohibition applies even when a V1 statement happens to be medically correct.

A claim from V1 enters the product only if it is independently sourced and reviewed through the normal clinical content process.

---

## 4. Three independent truth layers

### 4.1 Patient truth

Defines:

- disease state;
- phenotype;
- severity;
- physiology;
- findings;
- progression;
- response to treatment;
- complications;
- outcome.

### 4.2 Clinical rule truth

Defines:

- what actions are available;
- what actions are indicated, optional, unnecessary or unsafe;
- what thresholds matter;
- what treatment parameters are acceptable;
- what pathway transitions are permitted;
- what resource limitations alter the safe path.

### 4.3 Learner assessment truth

Defines:

- what is being measured;
- what counts as observed;
- what counts as omitted;
- whether timing is relevant;
- whether a score is validated for the intended use.

These layers must not be silently substituted for one another.

---

## 5. Source hierarchy

Clinical content authors should preferentially use:

1. Current national clinical protocols and official local standards relevant to the deployment jurisdiction.
2. Current international professional society guidelines.
3. High-quality systematic reviews and meta-analyses.
4. Landmark randomized or prospective studies when guidelines do not yet incorporate a relevant result.
5. Major reference texts for stable background knowledge.
6. Explicit expert consensus only where stronger evidence is unavailable.

The hierarchy is not automatic.

A more recent publication does not silently override a jurisdiction-specific rule.

Conflicts must be represented explicitly.

---

## 6. Rule provenance contract

Every clinical rule that can influence runtime behavior must have machine-readable provenance.

Suggested minimum schema:

```json
{
  "rule_id": "AP-FLUID-001",
  "module": "acute_pancreatitis",
  "rule_type": "management",
  "claim": "human-readable reviewed claim",
  "conditions": [],
  "exceptions": [],
  "jurisdiction": "reference | KZ | local_site",
  "resource_context": [],
  "source": {
    "organization": "professional body or authority",
    "title": "source title",
    "publication_year": 2024,
    "version": "if applicable",
    "identifier": "DOI/PMID/protocol id",
    "accessed_at": "YYYY-MM-DD"
  },
  "evidence_strength": "as_reported_by_source | not_graded",
  "review_status": "draft | reviewed | approved_for_training | deprecated",
  "reviewed_by": [],
  "reviewed_at": "YYYY-MM-DD",
  "next_review_due": "YYYY-MM-DD",
  "supersedes": null
}
```

Exact field names may evolve.

The core requirement is traceability.

---

## 7. Content states

Use explicit lifecycle states.

### `draft`

Authored but not independently reviewed.

Runtime effect:

- no scoring;
- no safety stop;
- no patient truth;
- no authoritative mentor teaching.

### `reviewed`

A clinician has reviewed it, but it is not yet approved for learner-facing production use.

Runtime effect should remain limited.

### `approved_for_training`

May influence:

- patient engine;
- reviewed management rules;
- mentor teaching;
- safety gates;
- expected clinical transitions.

### `deprecated`

Retained for audit and replay compatibility but not used for new sessions.

Do not delete old rule versions if historical replay depends on them.

---

## 8. High-risk rule class

Rules involving the following require stricter review:

- medication dose;
- fluid dose or rate;
- anticoagulation;
- antibiotics;
- blood products;
- vasoactive drugs;
- airway or ventilation parameters;
- invasive procedures;
- operative indications;
- timing of source control;
- ICU criteria;
- transfer criteria;
- contraindications;
- thresholds that trigger emergency action.

For scale use, a high-risk rule should not become `approved_for_training` solely from one person's unchecked entry.

At minimum require independent clinical review appropriate to the domain.

Where the rule crosses specialties, review should include the relevant specialty.

---

## 9. Clinical content unit

Do not store a guideline as a giant prompt.

Convert evidence into small reviewed rules.

A disease module should include structured units such as:

- diagnostic criteria;
- severity definitions;
- high-risk alternatives;
- initial stabilization;
- investigations with purpose and timing;
- treatment;
- reassessment;
- operative or procedural indications;
- postoperative care;
- deterioration;
- complications;
- disposition;
- resource adaptation.

A source may support multiple rules.

A rule may require multiple sources.

---

## 10. Evidence versus scenario

A guideline is not a scenario.

Scenario authors may use approved rules to build:

- phenotype;
- timing;
- trajectory;
- findings;
- complications;
- resource branches.

But the scenario must not introduce a new clinical rule simply because it makes the case more interesting.

If a needed rule does not exist:

1. create a rule proposal;
2. source it;
3. review it;
4. approve it;
5. then use it in a scenario.

---

## 11. Clinical fact generation

Randomization is allowed only within reviewed constraints.

For example, the engine may vary:

- age within phenotype range;
- symptom duration;
- compatible vital signs;
- compatible laboratory values;
- resource delays;
- sequence timing;

only when the generated combination remains internally coherent and clinically reviewed.

Do not independently randomize every field.

Patient generation must preserve phenotype-level coherence.

---

## 12. Parameter safety

Any learner-entered numeric treatment parameter should be classified as:

```text
recognized
unrecognized
reviewed_safe
reviewed_questionable
reviewed_unsafe
not_yet_reviewed
```

Only reviewed rules can determine safe versus unsafe.

`not_yet_reviewed` must not be silently treated as safe.

The mentor may say that a parameter is not validated by the training content, but should not invent a correction.

---

## 13. Source conflict handling

When sources disagree, do not merge them into a synthetic rule without review.

Record:

- source A;
- source B;
- population differences;
- resource assumptions;
- strength of recommendation;
- jurisdiction;
- reviewer decision.

The runtime may support more than one legitimate pathway.

Example conceptual distinction:

```text
reference_full_resource_path
local_safe_path
resource_constrained_path
```

A local limitation may change the feasible pathway but must not redefine what is biologically true.

---

## 14. Kazakhstan deployment layer

Kazakhstan-facing modules should support:

- current clinical protocols of the Ministry of Health where applicable;
- local hospital SOPs;
- formulary constraints;
- diagnostic availability;
- transfer pathways;
- staffing;
- time-of-day availability;
- regional resource variation.

Local practice habits that are not supported by an approved protocol or explicit expert-review rule must be labelled as such.

Do not silently equate "what our department usually does" with evidence.

---

## 15. Reference versus local path

The product should be able to distinguish:

### Reference path

What would be considered evidence-based care under adequate resources.

### Local safe path

What is safely achievable in the current simulated facility.

### Resource consequence

What clinical risk or delay results from the resource limitation.

The mentor can discuss this difference if the relevant rules are approved.

---

## 16. Updating evidence

Every approved module requires an update process.

Trigger review when:

- a source guideline is replaced;
- a major new guideline is released;
- a relevant local protocol changes;
- a safety concern is identified;
- pilot data reveal a content inconsistency;
- an SME disputes a runtime rule;
- an important new trial changes practice.

Operationally, the project should maintain:

- a source registry;
- last checked date;
- next planned review;
- superseded sources;
- affected rule IDs.

Do not rely on memory that a guideline is "probably still current".

---

## 17. Change impact analysis

When a clinical rule changes, identify all dependent objects:

- disease cards;
- phenotypes;
- safety rules;
- mentor rules;
- expected actions;
- pathway transitions;
- scenario presets;
- debrief content;
- tests;
- analytics definitions.

A clinical rule update should trigger targeted regression tests.

---

## 18. Clinical review matrix

Maintain a review table with at least:

```text
module
rule_id
rule_type
risk_class
source
source_date
review_status
reviewer
second_reviewer_if_required
last_reviewed
next_review
runtime_effects
tests
```

This table is a release artifact, not optional documentation.

---

## 19. Release gates

A module may enter internal development with incomplete review.

A module may enter learner pilot only when:

- all patient truth used in the pilot is reviewed;
- all safety-critical actions are reviewed;
- all learner-facing doses and thresholds are reviewed;
- all critical pathway transitions are reviewed;
- unresolved expert decisions are clearly isolated from scoring;
- no draft clinical rule can silently influence the patient.

A module intended for broad institutional use requires a stronger gate:

- complete source registry;
- independent clinical review;
- versioned module;
- tested replay determinism;
- adverse-content reporting mechanism;
- update owner;
- defined review cycle.

---

## 20. Mentor evidence contract

The mentor must receive clinical teaching content as structured approved facts or rules.

Example:

```json
{
  "rule_id": "RULE-123",
  "status": "approved_for_training",
  "teaching_point": "reviewed teaching content",
  "conditions_met": true,
  "allowed_to_state": true
}
```

The mentor may phrase this naturally.

It may not expand the rule with additional medical claims from model memory.

---

## 21. Debrief evidence contract

Every clinical correction in the debrief should be traceable to:

- learner action;
- approved clinical rule;
- source identifier.

The learner-facing UI does not need to display a citation after every sentence, but the system should be able to provide provenance.

For educator review, every correction should be inspectable.

---

## 22. Assessment governance

Formative feedback and validated assessment are different products.

Until a rubric is validated for the intended learner population:

- do not interpret numerical scores as competence;
- do not use the tool for credentialing;
- do not rank residents based on unvalidated scores;
- do not present precision that the evidence does not support.

The system may track observable behaviors and use them for formative feedback.

Any future summative use requires separate validation.

---

## 23. Clinical error reporting

At scale, users and educators need a structured way to flag:

- wrong patient fact;
- wrong dose;
- wrong threshold;
- inappropriate mentor correction;
- pathway inconsistency;
- outdated rule;
- local protocol conflict;
- missing alternative.

A report should capture:

- session/replay id;
- case version;
- rule version;
- learner-visible context;
- disputed content.

Clinical reports should enter a review queue, not disappear into generic product feedback.

---

## 24. Auditability

For every completed session, it should be possible to reconstruct:

- which case version ran;
- which disease card version;
- which rule versions were active;
- which resources were simulated;
- what the learner wrote;
- what actions were parsed;
- what the patient engine did;
- what mentor issues were considered;
- which approved facts the mentor used;
- which fallbacks occurred.

This is necessary for quality improvement and for investigating disputed clinical teaching.

---

## 25. Evidence source examples for current modules

Examples of appropriate source classes include:

### Appendicitis

Current WSES Jerusalem guideline edition for acute appendicitis, plus applicable Kazakhstan protocols and reviewed local pathways.

### Acute pancreatitis

Current professional society guidelines, including current ACG and IAP guidance, plus relevant critical-care and surgical guidance for complications.

The exact rule set must be built from the source documents. Do not copy clinical rules from experimental V1 transcripts.

---

## 26. Simulation education governance

Clinical accuracy alone is not enough.

The educational design should also be reviewed for:

- clear learning objectives;
- appropriate level of challenge;
- facilitation strategy;
- scaffolding;
- debrief quality;
- learner psychological safety;
- fidelity appropriate to the learning objective;
- outcome evaluation.

The mentor behavior specification and clinical rule system should remain separate so that pedagogical changes do not silently alter medicine.

---

## 27. Scale readiness checklist

Before ON QOL is distributed to hundreds or thousands of residents, verify:

- every active clinical rule has provenance;
- every high-risk rule has appropriate review;
- current sources have been checked;
- local versus reference pathways are explicit;
- V1 content is excluded from clinical evidence;
- mentor cannot invent medical truth;
- unsupported numeric parameters fail safely;
- every module has an update owner;
- disputed content can be reported and traced;
- assessment claims match the level of validation;
- replay and version history can reproduce what a learner was taught.

---

## 28. Clinical governance north star

The product should be able to defend every important teaching statement with:

> This is the rule that fired. This is the source. This is the version. These are the conditions. This is who reviewed it. This is why it applied to this patient.

If ON QOL cannot do that, the statement should not be allowed to become authoritative clinical teaching.
