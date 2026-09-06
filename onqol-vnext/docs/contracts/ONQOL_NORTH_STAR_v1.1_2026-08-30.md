# ON QOL North Star

**Version:** 1.1  
**Date:** 2026-08-30  
**Status:** Product constitution  
**Applies to:** all ON QOL modules, runtime redesign, clinical content, mentor behavior, assessment, localization, and future expansion

## 1. What ON QOL is

**ON QOL Clinical Trainer** is a longitudinal simulator of surgical patient management from first handoff to a safe terminal outcome.

The learner should feel that they are managing a patient inside a functioning hospital, not solving a diagnosis quiz, completing an OSCE checklist, or discovering a hidden sequence of phrases that makes software advance.

A typical journey may include:

**EMS or referral handoff -> triage and stabilization -> history and examination -> differential diagnosis -> investigations -> treatment and reassessment -> operative or non-operative decision -> preoperative preparation -> operation when indicated -> recovery, ward or ICU care -> deterioration or complication -> further treatment -> discharge, transfer, or death.**

The educational goal is not merely to identify a diagnosis. ON QOL should help learners develop the ability to:

- structure a clinical problem;
- recognize instability and time-sensitive threats;
- form and revise hypotheses;
- choose and justify investigations and treatments;
- reassess after interventions and after time has passed;
- adapt to resource constraints without confusing them with biological truth;
- escalate appropriately while retaining responsibility for immediate care;
- make, recognize, and correct non-catastrophic mistakes;
- reason through operative and postoperative decisions;
- reach a safe disposition.

## 2. The desired learner experience

At the end of a strong session, a resident should be able to say:

> I received a patient I did not already know. I could ask, examine, order, treat, wait, reassess, operate, call for help, make decisions under real constraints, and see what happened. The senior surgeon mostly let me work, but intervened when it mattered.

The resident should not feel:

> I learned how to satisfy the simulator's hidden checklist.

## 3. The simulated world

Each session creates a clinically coherent patient from reviewed content. The system may select disease, phenotype, stage or severity, anatomy, age, sex, comorbidities, baseline physiology, relevant mimics, communication modifiers, resource context, and reviewed probabilistic events.

The patient changes over simulated clinical time and may respond to treatment, delayed treatment, deterioration, source control, postoperative recovery, complications, and resource-caused delays.

The learner sees only information that is naturally available at that moment through handoff, history, examination, monitoring, investigations, staff communication, procedures, operation, observation, or outcome.

## 4. Six authorities that must remain separate

ON QOL has six conceptually separate authorities.

1. **Patient Engine**  
   Owns hidden biological and clinical state: disease, phenotype, physiology, findings, progression, treatment response, complications, and outcome.

2. **Hospital / World Engine**  
   Owns location, resources, staff availability, queues, transport, test turnaround, operating-room capacity, ICU capacity, outages, delays, and other environmental events.

3. **Clinical Rule Layer**  
   Owns reviewed medical authority: indications, contraindications, treatment parameters, safety classification, treatment effects, critical prerequisites, pathway constraints, and authoritative teaching rules.

4. **Language Interpreter**  
   Converts learner language into explicit structured actions, questions, and reasoning claims. It may understand abbreviations, spelling mistakes, synonyms, and conversational clinical language. It may not invent an omitted action or missing order parameter.

5. **Mentor**  
   Acts as an adaptive senior surgeon. It decides whether and how to teach using learner-visible information and approved clinical rules. It does not own patient truth, hospital truth, or clinical rules.

6. **Event / Causal History**  
   Records what happened, when it happened, what changed, and why. It must support deterministic replay, audit, debrief, research, and investigation of disputed teaching.

No component may silently assume another component's authority.

## 5. The role of AI

A language model may:

- understand free clinical language;
- map language to reviewed concepts;
- recognize explicit learner reasoning;
- generate natural patient and staff speech from structured truth;
- phrase mentor feedback from approved teaching content;
- summarize structured session history.

A language model may not create clinical truth.

It may not invent:

- a disease fact;
- a patient finding;
- a dose;
- a threshold;
- an indication or contraindication;
- a safety level;
- a treatment effect;
- a pathway transition;
- an operative rule;
- a score key;
- a complication merely to make the case interesting.

Clinical authority must remain versioned, reviewable, and auditable.

## 6. Reference Hospital and Real-world Hospital

ON QOL supports two first-class resource contexts.

### Reference Hospital

Represents adequately resourced, contemporary evidence-based care. It removes artificial resource barriers but not clinical time or real workflow. Tests, transport, preparation, procedures, and recovery still take time.

### Real-world Hospital

Represents care under actual operational constraints. Resources may be absent, delayed, occupied, broken, unavailable at night, limited by staffing, or available only after transfer.

The same patient biology must remain separate from resources.

For any important decision, the product should be able to distinguish:

- the evidence-based reference pathway;
- the safest feasible local pathway;
- the consequence of the resource limitation.

A resource limitation may alter what can safely be done now. It must not redefine biological or clinical truth.

## 7. Kazakhstan deployment layer

Kazakhstan-facing simulation may include:

- current Ministry of Health clinical protocols and standards;
- local hospital SOPs;
- local formulary and stock;
- diagnostic availability;
- staffing patterns;
- transfer pathways;
- time-of-day constraints;
- regional resource variation.

Local or jurisdictional requirements must be represented explicitly and separately from the Reference Hospital pathway.

If a Kazakhstan protocol conflicts with newer international evidence, the conflict is recorded and reviewed. The system must not silently merge the two into a synthetic rule.

## 8. Patient generation principles

A patient is generated as a coherent phenotype, not as an independent random collection of symptoms and laboratory numbers.

Randomization is allowed only inside reviewed constraints that preserve internal coherence.

Important principles:

- phenotypes are first-class clinical content;
- age, sex, anatomy, comorbidities, and stage may change what rules apply;
- investigations may be equivocal or nondiagnostic where clinically appropriate;
- not every piece of history needs to be relevant;
- incidental findings should be rare and reviewed;
- correct care does not guarantee a perfect outcome;
- poor care should increase risk rather than automatically trigger one scripted complication;
- every patient and probabilistic event must be reproducible by seed for replay and audit.

## 9. Learner autonomy and error model

The learner owns clinical decisions.

The learner may:

- be uncertain;
- choose among multiple legitimate pathways;
- make a defensible but suboptimal choice;
- make a non-catastrophic error;
- observe consequences;
- revise a plan;
- call for help;
- disagree with the mentor and defend a reasonable alternative.

The simulator should prefer learning through consequences over hard blocking.

Hard stops are reserved for rare actions that meet the approved Level 4 safety criteria.

## 10. Mentor North Star

The mentor is a good senior surgeon observing the case.

It should:

- remain silent during competent progression;
- intervene for safety, major current reasoning problems, or genuine learner dead-end;
- ask zero or one focused question per intervention;
- increase scaffolding when the learner is genuinely stuck;
- preserve decision ownership;
- recognize appropriate escalation;
- defer old non-critical omissions to debrief;
- correct itself when structured history shows that it made a conversational mistake;
- never reveal hidden patient truth;
- never invent clinical teaching from model memory.

The mentor succeeds when the resident thinks:

> I had to manage the patient myself, but when my reasoning mattered, the senior surgeon noticed.

## 11. Evidence and clinical governance

A guideline is a source of rules, not a ready-made scenario.

Every clinical fact or rule that can influence patient truth, learner safety, mentor teaching, pathway behavior, or assessment must be traceable to:

- a source;
- a version;
- applicable population and context;
- review status;
- reviewer decision;
- runtime effect.

High-risk content requires stricter review.

Unreviewed or pending clinical content must remain inert. A technically complete runtime must prefer an honest simulator limitation over plausible invented medicine.

## 12. Assessment principle

Formative observation and validated competence assessment are different products.

Until a scoring system has been validated for its intended learner population and use:

- ON QOL may track observable behaviors;
- ON QOL may provide formative feedback;
- ON QOL may identify missed or unsafe actions from approved rules;
- ON QOL must not present a numerical score as a validated measure of competence;
- ON QOL must not be used for credentialing or ranking residents on the basis of an unvalidated score.

## 12.1 Human clinical authorship required

ON QOL should automate evidence handling and runtime execution without pretending that all clinically meaningful design decisions can be inferred from guidelines. Clinical authors and reviewers still need to supply or approve:

- realistic sequence of care from handoff to disposition;
- coherent phenotype bundles, including history, examination, vitals, laboratory values, imaging, and dynamics;
- Kazakhstan and local hospital resource profiles, delays, transfer routes, and staffing realities;
- zones of legitimate clinical choice, unsafe actions, time-sensitive decision points, perioperative requirements, operative decisions, monitoring, and discharge logic;
- mentor teaching priorities and clinically natural phrasing where pedagogy requires expert judgment;
- local protocols, formularies, and SOPs, clearly separated from unsupported departmental habit.

Where a guideline does not provide enough information to parameterize a dynamic patient, ON QOL requires governed simulation calibration rather than model improvisation.

## 13. First vertical slice

The first complete vertical slice is an acute-abdomen presentation built around appendicitis and clinically relevant mimics.

Its purpose is not to perfect an appendicitis chatbot. It is to prove that the universal runtime can support a full patient journey, including:

- unknown presentation;
- history and examination;
- diagnostic reasoning;
- laboratory testing and imaging;
- analgesia and other treatment where reviewed;
- clinical time and reassessment;
- operative decision;
- real preoperative readiness;
- decision-level operative simulation;
- postoperative location and monitoring;
- recovery or deterioration;
- complication capability;
- discharge, transfer, or death;
- deterministic debrief with provenance.

## 14. Scaling requirement

A new disease, phenotype, hospital profile, resource branch, complication, or language should be added primarily as structured reviewed content.

The core is considered scalable only if a genuinely different second disease can be added without introducing recurring disease-specific branches into generic runtime logic.

Clinical concepts should remain language-neutral. Model providers should be replaceable without changing clinical truth or patient state.

## 15. Non-negotiable principles

1. The patient, not the mentor, drives the simulation.
2. Time matters.
3. Actions can change the patient only through reviewed rules.
4. Resources change feasible care, not biological truth.
5. The learner owns clinical decisions.
6. Multiple approved pathways may be valid.
7. The language model understands and communicates, but does not invent medicine.
8. Clinical truth must be traceable and reviewable.
9. Debrief must come from structured event history, not conversational memory.
10. A simulator limitation must never be presented as a learner error.
11. New disease content should not require rewriting the core runtime.
12. Every important session must be reproducible and auditable.

## 16. Product readiness criterion

ON QOL reaches its intended core state when:

> A resident can manage an unknown surgical patient from handoff to a safe terminal outcome, the patient evolves coherently over time and in response to care, the hospital creates realistic constraints, the mentor intervenes selectively, every authoritative clinical correction is traceable to reviewed evidence, and a new clinical author can add another disease module primarily through structured content rather than new core logic.

This North Star defines product direction. Detailed runtime behavior, evidence governance, and mentor behavior are governed by the companion specifications listed in `ONQOL_SPECS_README.md`.
