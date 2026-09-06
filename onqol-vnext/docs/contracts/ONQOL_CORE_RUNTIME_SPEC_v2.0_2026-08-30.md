# ON QOL Core Runtime Specification

**Version:** 2.0  
**Date:** 2026-08-30  
**Status:** Authoritative product behavior and runtime architecture contract  
**Applies to:** ON QOL Clinical Trainer core runtime, patient simulation, hospital world, learner actions, interpreter boundaries, operative and postoperative flow, replay, debrief, future language layers, and future specialty expansion  
**Supersedes:** `ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md` and `ONQOL_CORE_FOUNDATION_SPEC_v1.0_2026-08-22.md`

---

## 1. Purpose

This document is the single authoritative runtime contract for ON QOL. It consolidates the former Product Behavior Contract and Core Foundation Specification so that learner-facing behavior and internal state ownership cannot drift apart.

It governs four linked layers:

1. **Product Behavior**: how the simulation should feel and respond from the learner's point of view.
2. **Clinical World Model**: how time, locations, staff, resources, investigations, monitoring, queues, transport, and operational constraints behave.
3. **Patient Model**: how a clinically coherent patient is generated, evolves, responds to reviewed treatment effects, develops complications, and reaches an outcome.
4. **Core Architecture Contract**: which system component is allowed to decide what, and which boundaries must not be crossed.

This document is not a clinical guideline and is not a source of medical truth. Clinical rules, drug doses, thresholds, contraindications, operative indications, safety classifications, treatment effects, discharge criteria, and authoritative corrections are governed by `ONQOL_CLINICAL_GOVERNANCE_SPEC_v1.1_2026-08-30.md`.

The goal is not to create a better appendicitis chatbot. The goal is a general surgical patient simulation core in which appendicitis is the first clinically validated vertical slice.

---

## 2. Relationship to the authoritative specification set

Read this specification together with:

- `ONQOL_NORTH_STAR_v1.1_2026-08-30.md`: product purpose and intended end state;
- `ONQOL_CLINICAL_GOVERNANCE_SPEC_v1.1_2026-08-30.md`: clinical authority, evidence, provenance, review states, and release gates;
- `ONQOL_MENTOR_SPEC_v1.1_2026-08-30.md`: mentor intervention, scaffolding, learner ownership, and mentor clinical-content boundary;
- `ONQOL_SPECS_README.md`: authority boundaries and conflict-resolution rules.

The previous Product Behavior Contract and Core Foundation Specification are archived history, not parallel authority.

Where a legacy V1/V2.5/V3.5 implementation choice conflicts with this runtime specification, the legacy implementation is not authoritative.

Legacy V1/V2.5/V3.5 sessions remain valuable as:

- behavioral references;
- regression cases;
- examples of natural learner language;
- examples of desirable mentor interaction;
- examples of failure modes.

They are not sources of clinical truth.

---

## 3. Product definition

ON QOL is a longitudinal simulation of managing a surgical patient inside a functioning hospital.

The learner should experience:

> I received a patient, assessed the patient, ordered and performed care, waited for results, reassessed, made decisions, dealt with resource constraints, operated when necessary, managed postoperative care, saw the consequences of my decisions, and received help from a senior surgeon only when it mattered.

ON QOL is not:

- a diagnosis quiz;
- a static case vignette;
- an OSCE checklist;
- a hidden sequence of required phrases;
- a chatbot whose main job is to ask educational questions;
- a guideline recitation exercise;
- a model that invents clinical facts as conversation progresses.

The patient and hospital must remain primary. The mentor is secondary.

---

# PART I. PRODUCT BEHAVIOR FOUNDATION

## 4. Default case mode: unknown surgical patient

The default ON QOL experience is an **unknown clinical presentation**, not a learner-selected diagnosis.

A case may begin under a presentation category such as:

- acute abdomen;
- gastrointestinal bleeding;
- bowel obstruction;
- postoperative deterioration;
- jaundice;
- trauma;
- acute limb ischemia;
- another future surgical presentation.

The learner does not know which disease, phenotype, severity, complication, or resource problem has been selected.

A future training mode may allow the learner to choose a diagnosis or topic, for example "appendicitis practice", but that is not the default core behavior.

---

## 5. Case opening

A case normally begins with a realistic handoff from EMS, referral, ward staff, or another clinician.

Example:

> Emergency department. Acute abdomen. EMS handoff: man, 42 years old. Lower abdominal pain for approximately 24 hours. Two episodes of vomiting. Took two sachets of nimesulide and Enterosgel at home. Temperature 37.8 °C, HR 96/min, RR 18/min, BP 125/75 mmHg.

Initial vital signs are available because nursing triage has already measured them.

The learner should then decide what to do.

The simulator must not automatically reveal:

- the diagnosis;
- the hidden severity;
- the expected pathway;
- the optimal next action;
- future deterioration;
- future complications.

---

## 6. History and examination behavior

### 6.1 Broad examination requests

If the learner says:

> осмотрю пациента

ON QOL should ask what area or system is being examined.

If the learner says:

> живот

that is sufficient to execute a complete clinically appropriate abdominal examination for that patient.

The learner should not be forced to list inspection, auscultation, percussion, and palpation unless technique itself is the learning objective.

Separate body areas can be requested separately, for example:

- mouth;
- groin;
- legs;
- rectal examination;
- neurological examination;
- vascular examination.

### 6.2 History

A general request to interview the patient should return the **full core history relevant to the current surgical presentation**.

The learner may then ask additional free-form questions.

Examples:

- "How is the pain now?"
- "When was your last bowel movement?"
- "Any previous operations?"
- "What medications do you take?"
- "Any anticoagulants?"

For the initial surgical product, the simulator should not turn history-taking into a hidden question-by-question checklist. More granular history gating may be introduced later for specialties where this is educationally important.

### 6.3 Reviewed universal normal-exam layer

ON QOL should include a broad **reviewed universal normal-exam layer** for clinically reasonable, non-contributory examinations that are not central to the authored case.

If the requested examination is covered by that approved layer and is compatible with the active phenotype, the system may return a coherent normal or non-contributory result rather than repeatedly say that the field was not modeled.

Example:

> Clinically significant abnormalities are not detected.

The runtime must not invent a normal finding merely because the specific case file omitted it. The universal normal layer is itself versioned clinical content and must follow Clinical Governance. It must never overwrite case-specific abnormal findings or create an internally inconsistent patient.

---

## 7. Free interaction with the patient

The patient should be conversational.

The learner may ask:

- how the patient feels now;
- whether pain changed;
- about medications;
- prior surgery;
- preferences;
- concerns;
- other clinically relevant questions.

The language model may phrase answers naturally, but every substantive patient fact must come from modeled truth.

The language model may not invent a new symptom, history item, preference, finding, or treatment response because it sounds plausible.

---

## 8. Current-status requests

Requests such as:

- "what is happening with the patient now?";
- "how is he now?";
- "give me current vitals";
- "what is the pain now?"

must return a short current clinical snapshot.

They must not be interpreted as learner reasoning or converted into an unrelated mentor question.

A current-status response may include:

- current simulated time;
- location;
- consciousness;
- current vital signs;
- pain;
- major active treatments;
- major pending investigations;
- relevant new events.

It should not automatically repeat the full history and full examination.

---

## 9. Parallel clinical work

The learner may order multiple actions in one message.

Example:

> CBC, chemistry, analgesia, 500 mL crystalloid over one hour, CT abdomen.

The interpreter may decompose this into multiple explicit commands.

Valid actions should then proceed in parallel when clinically and operationally possible.

The system must not force sequential execution merely because the learner typed several actions together.

---

## 10. Operational clarification belongs to the hospital

Routine order clarification should come from hospital characters, especially nursing staff, not from the mentor.

Example:

Learner:
> Ketoprofen 100 mg.

Nurse:
> Please specify the complete order and route of administration.

For infusion therapy, the learner should provide enough information to execute the order, including volume and time/rate when relevant. In a resuscitation context, a bolus may be specified.

The system should not silently invent missing parameters.

---

## 11. Treatment must affect the patient

A treatment that is actually executed must be capable of changing the patient when an approved effect model exists.

Examples:

- analgesia alters pain trajectory;
- fluids may alter hemodynamics, urine output, and fluid balance;
- antibiotics alter infection trajectory where modeled;
- oxygen or ventilation affects respiratory state where modeled;
- source control alters subsequent disease progression;
- inappropriate or delayed treatment may increase risk.

Learner actions therefore affect disease course. They do so through reviewed deterministic or probabilistic patient-engine effects, not through free language-model improvisation.

### 11.1 Immediate procedures

A clinically appropriate procedure may execute when:

- the learner has issued a sufficiently explicit order;
- the procedure exists in the universal action/procedure library;
- required resources are available;
- any relevant clinical prerequisites are satisfied;
- reviewed content defines the result or effect.

Routine operational clarification belongs to the relevant hospital character. The runtime must not silently add missing route, size, timing, or other high-risk parameters.

If a named procedure is not supported by the current simulation content, the system should disclose that limitation rather than fake successful execution.

---

## 12. Reassessment is a real action

If the learner says:

> reassess in one hour

and the reassessment targets are not clear, ON QOL should ask what will be reassessed.

Possible targets include:

- pain;
- vital signs;
- abdominal examination;
- urine output;
- mental state;
- respiratory status;
- drain output;
- selected laboratory tests.

Once the reassessment plan is clear:

1. simulated clinical time advances;
2. disease progression continues;
3. treatment effects are applied;
4. pending results may arrive;
5. the requested parameters are reassessed;
6. the learner receives new data.

A repeat examination must not be suppressed merely because the same examination was performed earlier.

### 12.1 Differential diagnosis and reasoning

ON QOL should not require a formal differential diagnosis after every action. Reasoning is captured when the learner explicitly states it or when the mentor asks for it.

The reasoning layer should preserve, where expressed:

- working diagnosis;
- differential diagnoses;
- uncertainty;
- evidence for and against hypotheses;
- purpose of investigations;
- management rationale;
- reassessment logic;
- contingency plan;
- disposition and consultation rationale.

A reasoning-only statement changes learner reasoning state, not patient truth or clinical time. A compound turn may contain both reasoning and executable actions, and both channels should be preserved.

If the learner reaches a major diagnostic commitment without demonstrating any differential reasoning, the mentor may challenge that current commitment when educationally useful. Once adequate reasoning has been demonstrated and the diagnosis is sufficiently established through learner-visible evidence, the case should move primarily into management rather than repeatedly interrogating old diagnostic omissions.

Old non-safety reasoning gaps normally belong in debrief.

---

## 13. Mentor presence

A competent learner may complete several consecutive turns without a mentor message.

The mentor should intervene live primarily for:

1. danger to the patient;
2. a major current reasoning error;
3. genuine learner dead-end or explicit uncertainty.

A missing rubric field alone is not a reason to interrupt.

When a learner says "I don't know", support should increase progressively:

1. focused prompt;
2. cue;
3. options;
4. explanation using approved content.

The mentor should then return control to the learner.

---

# PART II. CLINICAL WORLD MODEL

## 14. Two first-class hospital modes

ON QOL must support two first-class hospital environments.

### 14.1 Reference Hospital / Эталонная больница

The Reference Hospital represents adequately resourced evidence-based care.

Expected resources are available, including relevant diagnostics, standard medications, consultants, operating capacity, anesthesia, ICU, and routine perioperative support within the approved module.

However, the Reference Hospital is not magical.

Clinical time remains realistic:

- the patient still needs transport;
- imaging takes time;
- laboratory tests take time;
- preparation takes time;
- procedures take time;
- staff actions take time.

The purpose of this mode is to remove artificial resource barriers, not to remove reality.

### 14.2 Real-world Hospital / Реальная больница

The Real-world Hospital represents clinical care under imperfect operational conditions.

A hospital has a baseline resource profile known to the learner at the start, for example:

- type of hospital;
- approximate diagnostic capability;
- ICU capability;
- operative capability;
- transfer environment;
- usual staffing level.

Dynamic problems may then emerge during the case:

- CT breaks;
- OR is occupied;
- ICU has no bed;
- anesthesiologist is busy;
- a consultant is off site;
- a test is delayed;
- a medication is unavailable;
- transfer is delayed.

The learner must adapt.

### 14.3 Hospital archetypes

The product should support predefined hospital archetypes, for example:

- tertiary referral center;
- urban general hospital;
- district hospital;
- small regional facility requiring transfer for selected capabilities.

The exact Kazakhstan-facing profiles should be built from reviewed real-world resource data and local pathways.

---

## 15. Resource limitation creates a reasoning problem, not an interface dead end

When a resource is unavailable, ON QOL should state the operational fact and then leave ownership with the learner.

Example:

> CT is currently unavailable. Repair time is unknown. The nearest functioning CT is approximately 70 minutes away.

The system should not automatically choose the alternative pathway.

If the learner becomes stuck, the mentor may ask:

> CT is not available. What is your safest next plan?

The system may know several approved alternatives but should not reveal them unless scaffolding requires it.

---

## 16. Resource-caused harm and learner-caused harm must be separated

A negative outcome can occur even when the learner made the best feasible decision.

Examples:

- OR unavailable;
- transfer delayed;
- ICU bed unavailable;
- imaging delayed;
- specialist arrival delayed.

The debrief must distinguish:

- learner decision quality;
- resource limitation;
- biological disease progression;
- treatment effect;
- timing;
- probabilistic complication.

The simulator must not blame the learner for a system-level limitation outside the learner's control.

---

## 17. Internal clinical clock

ON QOL uses an internal simulated clinical clock.

Clinical time is not equal to:

- wall-clock time spent typing;
- model latency;
- message count.

Time advances because of clinical events:

- history;
- examination;
- transport;
- laboratory turnaround;
- imaging;
- treatment administration;
- observation;
- scheduled reassessment;
- procedure;
- operation;
- postoperative recovery;
- transfer.

Disease progression and treatment effects are evaluated against this simulated time.

---

## 18. Results arrive automatically when ready

An ordered investigation should have a lifecycle such as:

- ordered;
- queued;
- in progress;
- preliminary result available;
- formally resulted;
- delayed;
- unavailable;
- cancelled.

When a result becomes available, the hospital should normally surface it automatically.

Examples:

> CBC is now available.

> Radiology calls with a preliminary CT result. Formal report will follow.

The learner should not have to remember to ask whether every previously ordered result has returned.

---

## 19. Deterioration can interrupt the current conversation

If the patient develops a clinically important deterioration, the world may interrupt whatever educational discussion is happening.

Example:

> Nurse interrupts: BP is now 70/40 mmHg, HR 132/min, the patient looks pale and clammy.

The new patient problem becomes the immediate priority.

The mentor should not continue discussing an old non-safety reasoning gap while the patient deteriorates.

---

## 20. Patient location is part of the world state

The system should track where the patient physically is.

Possible locations include:

- EMS / arrival;
- emergency department;
- resuscitation area;
- radiology;
- procedure room;
- operating room;
- recovery / PACU;
- ICU;
- surgical ward;
- ambulance transfer;
- receiving hospital.

Location affects:

- staff availability;
- monitoring level;
- procedure capability;
- recognition time for deterioration;
- available escalation;
- transport risk.

Transport itself consumes time and the patient may deteriorate during transport.

---

## 21. Monitoring must be prescribed

When a patient remains under observation, on a ward, or after a procedure, the learner should prescribe an appropriate monitoring plan.

Examples:

- vital-sign frequency;
- urine output;
- pain;
- drain output;
- repeat CBC;
- respiratory monitoring;
- other case-relevant parameters.

If monitoring is inadequate, deterioration may be recognized later depending on location and nursing environment.

This is part of clinical management, not merely documentation.

---

## 22. Nurses are clinically functional characters

Nursing staff should not behave as passive script executors.

A nurse may autonomously report obvious deterioration such as:

- loss of consciousness;
- severe hypotension;
- marked tachycardia;
- major desaturation;
- hematemesis;
- major drain output;
- another clearly important modeled event.

The nurse may also request operational clarification of an order.

For the initial product, staff characters are professionally correct. Future Real-world Hospital versions may later introduce realistic differences in experience, local habit, remote reporting, staffing, or seniority.

---

## 23. Other hospital characters

The simulated hospital may contain functional characters including:

- nurse;
- radiologist;
- anesthesiologist;
- senior surgeon;
- ICU physician;
- specialty consultant;
- operating-room staff.

Characters can have realistic arrival times and availability.

For the initial system, their clinical behavior should be professionally correct and should not introduce unreviewed medical misinformation.

A senior surgeon usually advises while the learner retains ownership.

In selected critical situations, the senior may take over an immediate life-saving action or decision when that behavior is explicitly modeled and educationally appropriate.

---

## 24. Escalation does not stop the patient

Calling for help is a valid clinical action, but the patient continues to evolve while help is on the way.

Example:

> Senior surgeon is on the way. Intensivist is coming. What are you doing while they arrive? The patient is continuing to deteriorate.

Appropriate escalation should not be penalized.

The learner should retain responsibility for immediate actions until help arrives.

---

## 25. Initial scope is one longitudinal patient

The initial redesigned runtime should follow one patient at a time.

Multi-patient workload, competing cases, pages while operating on another patient, and service-level prioritization may be added later.

The internal world model should not make such future expansion impossible, but it is not required for the initial surgical core.

---

## 26. Paired Reference-vs-Real Teaching Mode

The ability to compare the same patient under two resource environments should be built into the product model, but exposed as a **separate teaching mode**, not as the default game.

Possible flow:

1. learner completes a patient in the Reference Hospital;
2. the system offers the same seeded patient in a Real-world Hospital;
3. patient biology, phenotype, severity, anatomy, and baseline facts remain the same;
4. hospital resources, delays, staffing, and operational constraints change;
5. the learner manages the case again;
6. the debrief compares decisions, timing, outcomes, resource effects, and reference versus feasible local pathways.

The educational objective is:

> How do you preserve safe care when the optimal reference pathway is not available?

The default unknown-case game should continue to use different unpredictable patients.

---

# PART III. PATIENT MODEL

## 27. Patient generation principle

ON QOL should generate **clinically coherent patients**, not random collections of independently sampled symptoms and numbers.

Generation should proceed through structured layers such as:

1. disease;
2. phenotype;
3. stage / severity;
4. sex and age;
5. anatomy;
6. comorbidities;
7. relevant differential-diagnosis context;
8. initial physiology;
9. laboratory ranges;
10. natural disease trajectory;
11. treatment-response parameters;
12. complication risk;
13. non-contributory background conditions;
14. communication style;
15. optional preference / refusal modifier.

Random variation is allowed only inside reviewed constraints that preserve clinical coherence.

---

## 28. Phenotypes are first-class content

Each disease should contain a finite, clinically reviewed phenotype library rather than be generated from scratch by the language model.

For appendicitis, examples could include reviewed variants such as:

- typical presentation;
- early disease;
- retrocecal presentation;
- pelvic presentation;
- older adult;
- perforation;
- abscess;
- pregnancy-related variant where appropriate;
- other future reviewed phenotypes.

The exact list belongs to disease-module content and may evolve.

Within a phenotype, selected details may vary safely.

---

## 29. Age and sex

Age may be sampled as a random value from a reviewed safe range appropriate to the selected phenotype.

Sex is clinically consequential, not cosmetic.

It may alter:

- applicable differential diagnoses;
- relevant history;
- examination content;
- pregnancy-related pathways;
- gynecologic alternatives;
- prostate-related examination in men where relevant;
- other sex-specific clinical content.

A rule that cannot apply to the selected patient must not become active merely because it exists in the disease module.

---

## 30. Comorbidities

Comorbidities may meaningfully alter:

- disease course;
- diagnostic interpretation;
- medication choice;
- perioperative risk;
- treatment response;
- complication risk;
- postoperative recovery.

Examples include diabetes, kidney disease, obesity, anticoagulant use, cardiovascular disease, and others as relevant.

Comorbidities must have reviewed effects where they influence simulation behavior.

---

## 31. Non-contributory background conditions

A patient may also have unrelated or minimally relevant conditions.

Example:

- well-controlled hypertension in an otherwise unrelated acute surgical case.

This creates realism and prevents learners from assuming that every piece of history is a clue.

These conditions should not create unnecessary complexity or hidden clinical traps unless specifically designed to do so.

---

## 32. Laboratory generation

Laboratory values should be sampled from reviewed phenotype-specific ranges.

A phenotype may support categories such as:

- normal;
- borderline;
- mildly abnormal;
- significantly abnormal;
- near an important threshold;
- high / low.

The actual numeric value may vary by seed.

Example conceptually:

> reviewed phenotype range for WBC = 11.0 to 16.5 x10^9/L

A specific seeded patient may receive:

> 13.7 x10^9/L

Numbers must not be sampled independently if doing so would create a clinically incoherent combination.

---

## 33. Ambiguous and nondiagnostic testing

Investigations should not always produce a clean answer.

Where clinically reviewed and appropriate, a study may be:

- nondiagnostic;
- equivocal;
- limited by body habitus or gas;
- unable to visualize the target structure;
- suggestive but not definitive;
- discordant with another data source.

This prevents learners from treating every test as a binary answer key.

---

## 34. Unknown diagnosis and mimics

A presentation that looks like one disease may in fact represent another disease.

For example, a patient with right lower abdominal pain may ultimately have a reviewed alternative rather than appendicitis.

This is a core feature of default unknown-case mode.

The system should therefore support clinically reviewed mimic conditions within a presentation library.

---

## 35. Patient communication style

Patients may vary in communication style, for example:

- conversational;
- anxious;
- concise;
- irritable because of pain;
- poor at naming medications;
- somewhat disorganized but still able to provide the core history.

Communication style must not alter hidden clinical truth.

Different phrasings should still convey the same modeled facts.

---

## 36. Rare inaccurate or incomplete patient history

Most patients should provide a usable core history.

Rarely, a patient may provide inaccurate or incomplete information for realistic reasons.

Mechanisms may include:

1. the patient does not actually know;
2. the patient misunderstood the question;
3. later external information contradicts the initial statement.

Possible later sources include:

- family;
- EMS handoff;
- medication packaging;
- electronic health record;
- prior discharge paperwork;
- objective findings.

Example:

> "I do not take any regular medication."

Later a family member identifies an anticoagulant used daily.

This should be uncommon and should not teach learners that patients are generally unreliable.

---

## 37. Missed history may surface later

If the learner fails to ask or recognize an important issue, that information may emerge later through normal clinical workflow.

Example:

- anticoagulant use discovered during preoperative preparation;
- allergy discovered during medication reconciliation;
- prior surgery discovered during operative planning.

This allows consequences and teaching without requiring a hidden checklist at the initial history stage.

---

## 38. Patient preferences, refusal, capacity, and autonomy

Preferences and refusal should be modeled as optional independent modifiers rather than as disease phenotypes.

Possible modifiers include:

- fear of surgery;
- refusal of surgery;
- desire to speak to family;
- fear of a stoma;
- refusal of blood products;
- desire to leave against medical advice;
- low readiness for admission;
- communication barrier.

These modifiers change communication and decision-making, not biological disease truth.

The learner must be able, where relevant to the modeled context, to:

- explain the proposed plan and alternatives;
- respond to questions and concerns;
- assess decision-making capacity when a reviewed legal/clinical rule requires it;
- involve family or interpreters appropriately;
- escalate when necessary;
- document and act according to the modeled clinical and jurisdictional context.

A patient may change a preference after discussion or may continue to refuse. The patient should not always agree with the learner simply because the learner selected the reference pathway.

Capacity, consent, refusal, and jurisdiction-specific legal requirements must come from reviewed content. The language model may render the conversation naturally but may not invent a legal rule or a patient preference.

---

## 39. Unnecessary tests may be normal

If the learner orders a clinically unnecessary but executable investigation, the result may simply be normal or non-contributory.

The simulator should not create an abnormality merely to reward unnecessary testing.

The decision itself can be addressed in debrief where appropriate.

---

## 40. Incidental findings

The system should support incidental findings as a capability, but they should be rare in the initial product.

An incidental finding must come from reviewed content and must not be generated ad hoc by the language model.

This capability is included for future realism without making the initial simulation unnecessarily complex.

---

## 41. Probabilistic outcomes and complications

Correct care does not guarantee a perfect outcome.

A patient may develop a real-world complication despite appropriate management when the probability is evidence-backed and compatible with the patient profile.

Similarly, an incorrect decision should not always trigger the same scripted complication.

Learner actions may change risk.

Conceptually:

> baseline patient risk + disease state + treatment + timing + operative factors + resource context + learner decisions -> updated probability distribution of future events

The runtime must preserve causal traceability even when the final event is probabilistic.

---

## 42. Seeded reproducibility

A patient must be reproducible by seed for testing, audit, research, and disputed-session review.

A seed should be capable of reproducing:

- disease;
- phenotype;
- age and sex;
- anatomy;
- comorbidities;
- background conditions;
- initial vitals;
- laboratory values;
- ambiguous-test outcomes;
- communication modifiers;
- preference modifiers;
- natural trajectory;
- probabilistic complication decisions;
- operative surprises;
- resource events when replaying the complete scenario.

Replay must not depend on a language model making the same stochastic clinical invention twice.

---

## 43. Death

Death is a valid case endpoint when produced by the modeled patient trajectory and care path.

For the initial surgical core, death ends the clinical simulation.

Post-death communication, documentation, family discussion, and institutional processes may be developed later as separate learning content.

---

# PART IV. CORE ARCHITECTURE CONTRACT

## 44. Fundamental separation of authority

The redesigned ON QOL runtime must separate five authorities:

1. **Patient Engine**: owns hidden biological and clinical state.
2. **Hospital / World Engine**: owns resources, locations, queues, operational time, staff availability, and environment events.
3. **Clinical Rule Layer**: owns reviewed clinical appropriateness, safety, treatment parameters, indications, contraindications, effects, and pathway constraints.
4. **Language Interpreter**: converts learner language into explicit structured commands and reasoning claims.
5. **Mentor**: decides whether and how to teach using learner-visible context and approved teaching rules.

A sixth cross-cutting component is required:

6. **Event / Causal History**: records what happened, why it happened, what changed, and which rule or resource condition caused the change.

These responsibilities must not be silently merged.

---

## 45. Patient Engine authority

The Patient Engine owns:

- hidden diagnosis;
- phenotype;
- anatomy;
- severity;
- current physiology;
- symptoms;
- examination truth;
- disease progression;
- treatment response;
- complication state;
- outcome;
- death.

Learner actions influence these variables only after those actions have been interpreted, operationalized, allowed, and applied through reviewed rules.

The language model does not directly mutate patient state.

---

## 46. Hospital / World Engine authority

The hospital layer owns:

- resource profile;
- resource availability;
- equipment state;
- hospital location;
- transport;
- test queues;
- operating-room availability;
- ICU availability;
- staff availability;
- consultant ETA;
- result timing;
- monitoring environment;
- operational delays;
- dynamic outages.

The hospital may create constraints.

It does not redefine biological truth.

---

## 47. Clinical Rule Layer authority

Only reviewed clinical rules may determine:

- whether a dose is safe, unsafe, questionable, or unsupported;
- whether a route or parameter is acceptable;
- treatment effects;
- contraindications;
- operative indications;
- timing requirements;
- critical prerequisites;
- source-control rules;
- monitoring requirements where encoded;
- resource-adapted safe pathways;
- safety level 1 to 4 when clinically governed;
- authoritative teaching corrections.

The language model may phrase these rules naturally but may not create them.

---

## 48. Language Interpreter authority

The interpreter exists to understand learner intent.

It may:

- understand abbreviations;
- understand common clinical slang;
- tolerate spelling errors;
- resolve obvious synonyms;
- decompose one message into multiple explicit actions;
- recognize clinical reasoning claims;
- recognize questions about the patient;
- recognize answers to the mentor;
- recognize conversation-management commands.

Examples:

- "ОАК" -> CBC;
- "КТ ОБП" -> CT abdomen;
- "лапара" -> laparoscopy;
- a misspelled but recognizable drug or action -> the corresponding known concept.

The interpreter may not:

- invent an action the learner did not request;
- invent missing dose, route, volume, or duration;
- infer that an ambiguous phrase means a specific high-risk order;
- decide that an order is clinically correct;
- advance the patient because a phrase "sounds like" the next stage.

When ambiguity matters, the environment should clarify.

---

## 49. Explicit command principle

Learner language should be transformed into explicit structured commands.

Conceptually:

> "CBC, chemistry, ketoprofen 100 mg IV, and 500 mL crystalloid over one hour"

may produce four commands:

1. order CBC;
2. order chemistry;
3. order ketoprofen 100 mg IV;
4. order crystalloid 500 mL over 60 minutes.

No fifth action may be added simply because it would be clinically reasonable.

---

## 50. Unsupported medication and treatment content

### 50.1 Reference Hospital

For the Reference Hospital, the approved content library should aim to cover the broad reasonable set of medications and common perioperative/emergency treatments relevant to the active clinical module.

If a learner enters an order that is not yet covered by the content library:

> This treatment is not yet supported in the current simulation content. Choose another order.

This is a simulator limitation.

It must not be presented in debrief as a learner omission or clinical error.

### 50.2 Real-world Hospital

The Real-world Hospital may say that a drug is unavailable only when the simulated formulary or current stock state explicitly says it is unavailable.

The system must never convert "the platform does not recognize this medication" into a fictional hospital fact such as "the drug is out of stock".

The runtime must distinguish:

1. recognized and available;
2. recognized but unavailable in this hospital now;
3. unsupported by current simulation content.

---

## 51. Mentor knowledge boundary

The mentor must not see hidden patient truth that has not been naturally revealed to the learner.

The mentor may see:

- the complete learner-visible patient context;
- current location and resource context visible to the learner;
- learner actions;
- learner reasoning claims;
- current dynamic changes already revealed;
- active pending actions;
- relevant approved clinical teaching rules;
- governed safety classification of the learner's proposed action;
- previous mentor interaction context.

The mentor must not see or use:

- hidden diagnosis before disclosure;
- hidden future complication;
- unrevealed examination findings;
- unrevealed imaging;
- unrevealed laboratory results;
- hidden operative findings.

This boundary must not make the mentor unnatural. The mentor should remain context-aware, concise, clinically engaged, and capable of reasoning about the information actually available.

---

## 52. Mentor cannot request hidden truth for itself

The mentor may not query the Patient Engine for hidden clinical facts in order to improve its answer.

It may ask the learner:

> What information do you need before making that decision?

It may not say:

> There is free fluid, therefore...

unless that finding has already become learner-visible through the simulation.

---

## 53. Patient and staff speech

Patient and staff utterances are language renderings of structured truth.

The system may render:

> "The pain is a little better now."

only if the current patient state says the pain has improved.

Similarly, the radiologist may say:

> "Preliminarily I see free gas."

only if a reviewed preliminary imaging result is active.

The model may vary phrasing. It may not vary the clinical truth.

---

## 54. Multiple acceptable pathways

If more than one pathway is clinically acceptable under approved rules, ON QOL must preserve that plurality.

The mentor may ask why the learner chose a particular path.

It may not falsely declare one approved option to be the only correct answer.

A defensible learner argument may lead the mentor to acknowledge:

> Yes, that is a reasonable pathway under these conditions.

---

## 55. Mentor correction and conversational repair

If the mentor makes a conversational mistake, it should be able to correct itself.

Example:

Mentor:
> You did not give antibiotics.

Learner:
> I ordered them two turns ago.

Mentor:
> Correct, antibiotics were already ordered. I am correcting that.

The runtime should use structured action history to support this repair.

The mentor should not defend an incorrect statement for conversational consistency.

---

## 56. Case endpoint authority

The mentor does not decide when the patient is finished.

Natural terminal states are owned by patient/workflow logic, including:

- safe discharge;
- safe transfer into another care pathway or facility;
- death.

If the learner manually ends the case before a natural endpoint, the session should be marked **incomplete**.

Diagnostic confirmation and completion of surgery alone are not sufficient endpoints.

---

## 57. Four-level clinical error execution model

The four safety levels are internal runtime classifications and must never be shown as labels to the learner.

### Level 1: defensible but suboptimal

- execute;
- mentor usually silent;
- discuss trade-off in debrief if useful.

### Level 2: incorrect but educationally useful

- mentor may challenge once;
- learner may persist;
- execute;
- model realistic consequences;
- allow the learner another opportunity to recognize and correct the problem.

### Level 3: very dangerous

- strong immediate mentor intervention;
- identify the concern without automatically giving the answer;
- learner may still be allowed to persist when the consequence is clinically modeled, evidence-backed, and educationally useful;
- serious harm may occur.

### Level 4: immediately catastrophic or unacceptable

- action is blocked;
- mentor stops the learner clearly;
- learner must revise before proceeding.

Hard blocks should be rare.

The default educational preference is to allow errors and teach through consequences when clinically and ethically appropriate within the simulation.

---

## 58. Preoperative readiness and operative state must be real, not conversational

Saying:

> We are going to operate.

creates an operative management decision. It does not make the patient ready for surgery.

The world must separately track relevant facts such as:

- operative plan;
- consent state;
- anesthesia assessment/readiness;
- antimicrobial prophylaxis state where applicable;
- fasting or aspiration-risk state where applicable;
- required laboratory or blood-preparation state where applicable;
- VTE or other perioperative planning where applicable;
- general preparation state;
- resource availability;
- location;
- selected approach;
- procedure started;
- key operative findings;
- source control;
- operation completed.

The learner should not enter the operation merely because the word "appendectomy" or another procedure name was recognized.

Preoperative requirements must be represented as reviewed rules and separated into:

1. **hard prerequisites**: the next irreversible step cannot validly proceed without them;
2. **important but non-blocking elements**: omission may alter risk, trigger a consequence, or appear in debrief but does not automatically make the route structurally impossible.

The runtime must not convert every omitted checklist item into a hard block. Which items are hard prerequisites is a clinical governance decision.

A failed or refused operation attempt must not mutate the patient into a postoperative state. Postoperative locations, recovery, and discharge on an operative pathway require actual `operation_completed` or an equivalent reviewed procedural completion event.

---

## 59. Operative fidelity and operative consequences

The initial surgical simulation should use **decision-level operative fidelity**, not manual instrument simulation.

A typical operation may contain:

- operative entry and initial finding;
- approximately 2 to 5 meaningful decisions;
- selective unexpected findings where reviewed;
- automatic technical progression once no further key decision is required;
- explicit source-control and operation-completion events.

Example:

> Camera inserted. The appendix is thickened and inflamed. There is a small amount of pelvic fluid. What do you do?

A sufficient answer may be:

> Remove the appendix, aspirate the pelvic fluid, no drain.

The exact clinical acceptability of the response belongs to reviewed rules, not to the interpreter or language model.

For suboptimal but executable operative choices, the default educational preference is to allow the decision and model reviewed consequences rather than immediately reveal the answer. Level 4 actions remain blocked according to the governed safety model.

Operative surprises must be structured, reviewed content and should occur selectively rather than in every case.

## 59A. Postoperative care and disposition

Completion of an operation creates a distinct postoperative state. The learner should then make clinically meaningful postoperative decisions rather than being automatically routed to a successful discharge pathway.

Possible destinations include:

- PACU / recovery;
- surgical ward;
- ICU or higher-monitoring environment;
- transfer to another facility or service when applicable.

The chosen location affects monitoring capability, staff availability, recognition time for deterioration, and available escalation.

Postoperative management may include reviewed content for:

- monitoring;
- pain control;
- fluids and oral intake;
- mobility;
- VTE prevention;
- wound and drain care where applicable;
- laboratory reassessment;
- antibiotics where applicable;
- recognition of deterioration;
- discharge readiness.

The patient must be able to recover, remain stable, deteriorate, or develop a reviewed complication over hours or days. Correct care does not guarantee a complication-free outcome, and an error should not guarantee the same complication every time.

A patient must not be transferred to a postoperative ward, recovery state, or postoperative discharge path when no operation or other qualifying procedure actually completed.

---

## 60. Derived state-model requirement: no single monolithic path state as the source of truth

The agreed product behavior implies that the patient cannot be accurately represented by one linear state such as:

> data_gathering -> tests -> decision -> preop -> operation

A patient can simultaneously be:

- in the ED;
- hemodynamically stable;
- in pain;
- waiting for CBC;
- receiving fluids;
- diagnosed with a working hypothesis;
- not yet consented;
- planned for surgery;
- waiting for an operating room.

Therefore the redesigned runtime should represent state across independent dimensions rather than derive the entire world from one current phase.

Possible dimensions include:

- patient physiology;
- disease state;
- location;
- active treatments;
- investigations;
- diagnostic claims;
- management plan;
- monitoring plan;
- preoperative readiness;
- operative state;
- postoperative state;
- resource state;
- learner reasoning state.

A high-level phase may exist for UI or analytics, but it must not be the single authoritative source of truth.

---

## 61. Event and causal history

Every meaningful action and world change should be captured as an event.

Examples:

- PATIENT_ARRIVED;
- HISTORY_OBTAINED;
- ABDOMEN_EXAMINED;
- CBC_ORDERED;
- CBC_RESULTED;
- ANALGESIA_ORDERED;
- ANALGESIA_ADMINISTERED;
- TIME_ADVANCED;
- PATIENT_REASSESSED;
- CT_RESULTED;
- OPERATIVE_PLAN_COMMITTED;
- CONSENT_OBTAINED;
- ANTIBIOTIC_GIVEN;
- PROCEDURE_STARTED;
- SOURCE_CONTROL_COMPLETED;
- TRANSFER_INITIATED;
- PATIENT_DETERIORATED;
- COMPLICATION_OCCURRED;
- PATIENT_DISCHARGED;
- PATIENT_DIED.

The exact event schema may evolve.

The requirement is causal reconstruction.

The system should be able to answer:

> What happened, when, because of which learner action, clinical rule, disease process, resource condition, or probabilistic event?

---

## 62. Debrief must be generated from structured history

The debrief should not rely on the language model remembering the conversation and guessing what happened. A simulator limitation, unsupported interaction, or resource constraint must never be silently rewritten as a learner omission.

It should be grounded in:

- structured learner actions;
- structured learner reasoning;
- actual executed treatments;
- blocked actions;
- patient-state changes;
- time;
- resource conditions;
- approved clinical rules;
- causally linked complications;
- simulator limitations.

This is necessary to prevent errors such as claiming that a treatment was never ordered when the learner did order it but the simulator failed to execute it.

---

# PART V. SCALING FOUNDATION

## 63. Disease modules must be content, not runtime branches

The core must not contain appendicitis-specific control flow as the model for future growth.

A disease module should primarily contribute structured content such as:

- disease definition;
- phenotypes;
- patient findings;
- trajectories;
- laboratory ranges;
- imaging states;
- applicable differentials;
- treatment rules;
- operative rules;
- complications;
- outcome probabilities;
- debrief teaching points;
- evidence provenance.

Adding a second disease should not require rewriting the general runtime.

A key redesign acceptance test is:

> Can a new surgical disease module be added primarily as reviewed content without modifying core engine logic?

If not, the architecture has failed the scaling requirement.

---

## 64. Universal action library

Common clinical actions should be reusable across diseases.

Examples:

- obtain history;
- perform examination;
- order test;
- administer medication;
- administer fluid;
- insert tube;
- monitor;
- reassess;
- consult;
- obtain consent;
- transfer;
- operate;
- provide postoperative care;
- discharge.

Disease modules should specify when these actions matter, what findings they reveal, and what effects they have, rather than reimplement the actions themselves.

---

## 65. Language-neutral clinical concepts

Clinical logic should use stable concept identifiers independent of learner language.

The same clinical concept should not be implemented as separate medical logic for Russian, Kazakh, English, or future languages.

Language layers may provide:

- synonyms;
- abbreviations;
- natural-language rendering;
- patient speech;
- mentor speech;
- localization.

Clinical truth remains shared.

This is required for future multilingual expansion.

---

## 66. Replaceable language-model provider

ON QOL should not make one commercial model provider part of clinical truth or core state.

The language-model layer should be replaceable.

Future provider changes, self-hosted models, or locally deployed models should not require rewriting patient logic, clinical rules, hospital state, or replay semantics.

The model is an interpreter and renderer, not the clinical engine.

---

## 67. Personalization should be downstream of validated state

Future learner accounts may influence case selection and variation.

Examples:

- avoid exact repetition;
- revisit a prior weakness in a different disease;
- change phenotype;
- introduce a new complication;
- change hospital resources;
- introduce a different operative surprise.

Personalization must not silently alter evidence-based clinical truth.

It should choose among reviewed content and reviewed variations.

---

# PART VI. ACCEPTANCE TESTS FOR THE REDESIGN

## 68. Product-level acceptance criteria

The redesigned core is not ready merely because unit tests pass.

A surgeon should be able to complete an unknown case and experience all of the following:

1. receive a realistic handoff;
2. perform history and examination in natural language;
3. ask the patient free-form questions;
4. order several things simultaneously;
5. receive operational clarification from staff when needed;
6. see investigations progress over time;
7. receive results automatically when ready;
8. observe treatment effects;
9. schedule and perform reassessment;
10. ask "what is happening now?" and receive current state;
11. experience deterioration that interrupts old teaching;
12. operate only after real preparation, not after a conversational keyword;
13. make key operative decisions;
14. choose postoperative disposition;
15. experience complications or recovery over hours/days;
16. adapt when resources are unavailable;
17. call for help while the patient continues to evolve;
18. make non-catastrophic mistakes and experience consequences;
19. be stopped only for rare Level 4 actions;
20. complete multiple competent turns without mentor interruption;
21. receive a debrief that accurately distinguishes learner error, simulator limitation, disease biology, probability, and resource constraints.

---

## 69. Legacy behavioral regression suite

Legacy sessions should be converted into behavioral regression scenarios.

The new runtime does not need to reproduce legacy wording.

It should reproduce desirable behaviors such as:

- "живот смотрю" is understood as abdominal examination;
- "что с пациентом сейчас?" returns current state;
- "не знаю" increases scaffolding rather than creating an interrogation loop;
- the mentor addresses the current problem rather than an old non-safety omission;
- the learner can disagree and defend an approved alternative;
- the mentor can correct itself;
- the patient changes over time;
- actions have consequences;
- resource constraints require adaptive planning;
- a competent learner may proceed with little or no mentor interruption.

Legacy clinical claims are not imported as medical rules.

---

## 70. First vertical slice

The first redesigned end-to-end validation should use one complete appendicitis patient from arrival to terminal outcome.

The slice should be capable of exercising:

- unknown presentation;
- history;
- examination;
- current status;
- differential reasoning;
- laboratory testing;
- imaging;
- analgesia;
- fluid management where relevant;
- time;
- reassessment;
- operative decision;
- preoperative preparation;
- operative access;
- key intraoperative decisions;
- postoperative disposition;
- postoperative monitoring;
- recovery or complication;
- safe discharge, safe transfer, or death.

The purpose is not to perfect appendicitis-specific code.

The purpose is to prove that the general core can support the entire patient journey.

---

## 71. Second-disease architecture test

Before declaring the core scalable, add a second genuinely different surgical disease module.

The key test is not whether the disease works.

The key test is:

> How much core runtime code had to change?

The target is that most work occurs in reviewed disease content, not engine logic.

Any recurring new disease-specific runtime branch should be treated as a signal that the abstraction is incomplete.

---

# PART VII. MIGRATION PRINCIPLE

## 72. What should be preserved from the existing project

The redesign should preserve and reuse where valid:

- North Star;
- Product Behavior Contract;
- Clinical Evidence Governance;
- Mentor Specification;
- reviewed clinical rules;
- source registry;
- phenotypes and patient-content units that survive clinical review;
- resource profiles;
- consent/privacy work;
- replay and telemetry concepts;
- useful UI components;
- legacy sessions as behavioral test material;
- existing clinical review artifacts.

---

## 73. What should not be treated as architectural constraints

The redesign should not preserve a legacy mechanism merely because tests currently depend on it.

In particular, the new core should not be forced to preserve:

- a single derived path state as world truth;
- regex-driven operative progression;
- appendicitis-specific runtime branching;
- automatic stage questions;
- suppression of legitimate reassessment as a duplicate action;
- mentor-driven case progression;
- debrief inferred from missing boolean fields rather than actual event history;
- tests that encode known incorrect product behavior.

Legacy tests should be separated into:

- true product-contract tests to preserve;
- implementation-specific tests that may be retired.

---

## 74. Core runtime statement

The redesigned ON QOL succeeds if the following remains true across diseases, hospitals, languages, and future model providers:

> The patient is real within the simulation. The hospital has real capabilities and constraints. The learner owns clinical decisions. Reviewed rules determine medical truth. Actions change the patient. Time matters. Mistakes can have consequences. The mentor is a senior surgeon who mostly lets the learner work and intervenes when it matters. The language model understands and communicates, but it does not invent the medicine.

That is the authoritative runtime contract for ON QOL Core.
