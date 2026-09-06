# ON QOL Product Behavior Contract

**Version:** 1.0  
**Date:** 2026-08-22  
**Status:** Product behavior contract for runtime redesign  
**Applies to:** ON QOL Clinical Trainer core runtime, patient simulation, hospital environment, mentor behavior, operative and postoperative flow, replay and future modules

## 1. Purpose

This document defines how ON QOL should behave from the learner's point of view and how the simulated clinical world should respond.

It is intentionally not a technical architecture document and not a clinical guideline. It states the product behavior that the implementation must preserve.

The core experience is:

> A resident receives a real-feeling surgical patient, manages the patient freely over time in a functioning hospital environment, sees the consequences of actions and omissions, and is interrupted by a senior surgical mentor only when safety, a major reasoning problem, or genuine learner difficulty makes intervention useful.

ON QOL is not a diagnosis quiz, checklist, OSCE station, or chat with a static case.

---

## 2. Core product model

ON QOL is a simulation of three interacting realities:

1. **The patient**: disease, physiology, symptoms, findings, progression, treatment response, complications, and outcomes.
2. **The hospital**: location, staff, equipment, test turnaround, operating capacity, resource constraints, delays, failures, and transfer options.
3. **The learner**: assessment, decisions, orders, procedures, reasoning, timing, escalation, and communication.

The mentor observes these realities but does not own them.

The patient must continue to exist and change independently of the mentor conversation.

---

## 3. Two hospital modes

ON QOL must support two first-class simulation modes.

### 3.1 Reference Hospital / Эталонная больница

The reference hospital represents an adequately resourced environment.

Expected properties:

- appropriate laboratory testing is available;
- ultrasound and CT are available when clinically appropriate;
- operating room capacity is available within clinically reasonable limits;
- anesthesia is available;
- ICU is available;
- relevant consultants can be reached;
- laparoscopy and standard operative equipment are available;
- standard medications, blood products, and routine perioperative resources are available according to the approved content set.

The purpose of this mode is to show the evidence-based reference pathway without artificial resource barriers.

### 3.2 Real-world Hospital / Реальная больница

The real-world hospital represents actual clinical practice under imperfect conditions.

Resources may be:

- absent;
- delayed;
- temporarily unavailable;
- broken;
- occupied by another patient;
- unavailable at night;
- limited by staffing;
- available only after transfer;
- available with a realistic queue or turnaround time.

Examples:

- CT is unavailable overnight;
- the CT scanner is down;
- the anesthesiologist is occupied in another emergency;
- the operating room is occupied;
- ICU has no bed;
- the senior surgeon is on the way;
- the radiologist can give a preliminary verbal report before the formal report;
- a transfer takes 60 to 90 minutes.

The learner must decide what to do under those constraints.

### 3.3 Separation of biology and resources

The same patient biology must remain separate from hospital resources.

A missing CT does not change what disease the patient has.

A delayed operation may change the patient's trajectory because time passes, but resource limitation must not redefine the clinical truth.

The product must be able to distinguish:

- the optimal reference pathway;
- the safest feasible local pathway;
- the consequence of the resource constraint.

---

## 4. How a case starts

A patient usually enters the system through a clinical presentation category rather than a disclosed diagnosis.

Examples:

- acute abdomen;
- gastrointestinal bleeding;
- bowel obstruction;
- jaundice;
- postoperative deterioration;
- trauma;
- acute limb ischemia.

The learner receives an EMS or referral handoff plus initial vital signs.

Example:

> Emergency department. Acute abdomen. EMS handoff: man, 42 years old. Lower abdominal pain for approximately 24 hours. Two episodes of vomiting. Took two sachets of nimesulide and Enterosgel at home. Temperature 37.8 °C, HR 96/min, RR 18/min, BP 125/75 mmHg.

The learner should then decide what to do.

The system should not reveal the diagnosis, hidden severity, future complication, or expected pathway.

---

## 5. History and examination

### 5.1 General examination requests

If the learner says:

> осмотрю пациента

ON QOL should clarify:

> Что именно осматриваешь?

If the learner answers:

> живот

that is sufficient to perform a complete clinically appropriate abdominal examination for the case.

The learner should not be forced to ritualistically enumerate inspection, auscultation, percussion, and palpation unless the learning objective specifically requires technique-level detail.

Separate body areas are requested separately when relevant, for example:

- mouth;
- lower extremities;
- groin;
- rectal examination;
- neurological examination;
- vascular examination.

### 5.2 History

If the learner requests a general relevant history, ON QOL should return the full relevant history bundle for that clinical presentation.

The learner may subsequently ask free-form focused questions.

Examples:

- «Как сейчас боль?»
- «Когда последний стул?»
- «Были операции?»
- «Есть аллергия?»
- «Принимаете антикоагулянты?»

The patient should answer naturally using only modeled patient facts.

### 5.3 Universal normal-exam layer

The simulator should include a broad universal normal-exam layer for clinically reasonable requests that were not central to the authored case.

If the learner asks for a reasonable but non-contributory examination, the response may be:

> Клинически значимых изменений нет.

This is preferred over repeatedly stating that the finding was not modeled.

The universal normal layer must remain internally coherent and must not overwrite case-specific abnormal findings.

---

## 6. Free patient questions and current status

The learner may directly ask the patient or environment for current information.

Examples:

- «Что с пациентом сейчас?»
- «Как он сейчас?»
- «Какая боль сейчас?»
- «Что по витальным?»

A request for current status should return a short current clinical snapshot, not restart the full examination.

Example:

> Сейчас прошло 40 минут. Пациент в сознании, HR 92/min, BP 118/72 mmHg, temperature 37.8 °C, pain 4/10. Infusion is ongoing. CBC is ready; CT formal report is pending.

A patient-status question must never be converted into an unrelated mentor question.

---

## 7. Clinical time

### 7.1 Internal clinical clock

ON QOL uses an internal clinical clock.

Clinical time is not equal to:

- real wall-clock time spent typing;
- number of messages;
- model latency.

The learner may think for five real minutes without five simulated minutes necessarily passing.

Clinical time advances according to actions, investigations, treatment, transport, observation, scheduled reassessment, procedures, and disease progression.

### 7.2 Parallel work

Multiple actions may occur in parallel when clinically and operationally possible.

Example at 14:00:

- CBC ordered, expected in 30 minutes;
- CT arranged;
- analgesia administered;
- infusion started over 60 minutes.

The world should track these concurrently.

### 7.3 Results arrive when ready

Results should be reported automatically when they become available.

The learner should not have to remember to ask for every previously ordered result.

Examples:

> CBC is now available: ...

> Radiology calls with a preliminary CT finding: ...

> Formal CT report will follow.

The system may surface results during another activity if that is realistic.

### 7.4 Deterioration interrupts the current task

If a clinically important deterioration occurs, it should interrupt the current conversation.

Example:

> Nurse interrupts: BP is now 70/40 mmHg, HR 132/min, the patient looks pale and clammy.

The prior educational discussion becomes secondary to the new emergency.

---

## 8. Orders and treatments

### 8.1 Multiple simultaneous orders

The learner may order several tests and treatments in one message.

The system should execute all valid actions that can occur in parallel.

### 8.2 Incomplete medication orders

Medication administration requires an actionable order.

At minimum, the system should request the missing clinically necessary components.

For example, after:

> кетопрофен 100 мг

the nurse may respond:

> Уточните точное назначение и путь введения.

The nurse or relevant staff member, not the mentor, should handle routine operational clarification.

### 8.3 Incorrect dose or parameter

If the learner enters an incorrect dose or other unsafe treatment parameter and an approved clinical safety rule exists, the simulator should identify the problem according to the four-level safety model in Section 18.

The system must not invent a correction from model memory.

### 8.4 Infusion orders

An infusion order should include enough information to execute it, at minimum volume and administration time/rate when relevant.

In a resuscitation context, a bolus may be specified instead.

### 8.5 Immediate procedures

If an indicated procedure such as NG tube insertion is adequately ordered and resources are available, the environment may confirm execution:

> Назогастральный зонд установлен.

### 8.6 Treatment affects the patient

Treatments must alter the modeled patient state when clinically applicable.

Examples:

- analgesia changes pain trajectory;
- fluid resuscitation may alter hemodynamics, urine output, and fluid balance;
- antibiotics influence infection trajectory where modeled;
- oxygen or ventilation changes oxygenation where applicable;
- source control alters subsequent disease progression.

The patient must not remain static after meaningful treatment.

---

## 9. Investigations

### 9.1 Tests have workflow states

An investigation may be:

- ordered;
- waiting;
- in progress;
- preliminarily reported;
- formally resulted;
- unavailable;
- delayed;
- cancelled.

### 9.2 Preliminary reports

Where realistic, characters may provide preliminary information.

Example:

> Radiologist calls: preliminary review shows free intraperitoneal gas. Formal report will follow.

### 9.3 Resource limitation

If a requested test is unavailable in the current hospital mode, the system should state the real operational constraint and leave the decision to the learner.

Example:

> CT is unavailable until 08:00. The nearest facility with functioning CT is approximately 70 minutes away.

The mentor should not automatically solve the resource problem for the learner.

---

## 10. Reassessment

Reassessment is a real clinical action.

If the learner says:

> переоценю через час

ON QOL should ask what parameters will be reassessed if they are not clear.

Examples:

- pain;
- vitals;
- abdominal examination;
- urine output;
- mental status;
- drain output;
- respiratory status.

Once the reassessment plan is clear:

1. clinical time advances appropriately;
2. the patient evolves during that interval;
3. treatment effects and disease progression are applied;
4. new values/findings are returned.

The system must not treat reassessment as a duplicate of the initial exam.

---

## 11. Differential diagnosis and reasoning

ON QOL should not require a formal differential diagnosis after every step.

However, if the learner reaches a major diagnostic commitment without demonstrating any differential reasoning, the mentor may intervene.

Example after diagnostic CT confirmation:

> КТ хорошо подтверждает рабочую гипотезу. Но важно уметь не закрывать поиск слишком рано: какие опасные альтернативы при такой исходной картине нужно было держать в голове?

Once adequate reasoning has been demonstrated and the diagnosis is sufficiently established, the patient should move primarily into management rather than continued repetitive diagnostic questioning.

Old non-safety reasoning omissions may be deferred to debrief.

---

## 12. Hospital locations

The simulated world should track patient location.

Typical locations include:

- EMS / handoff;
- emergency department;
- resuscitation bay;
- radiology;
- operating room;
- recovery / PACU;
- ICU;
- surgical ward;
- procedure room;
- transfer ambulance;
- receiving hospital.

Location can affect:

- what staff are present;
- what monitoring is available;
- what procedures can be performed;
- how quickly deterioration is detected;
- how quickly escalation can occur.

---

## 13. Hospital staff as characters

Key hospital staff should exist as functional characters rather than as abstract system messages where this improves realism.

Possible characters include:

- nurse;
- radiologist;
- anesthesiologist;
- senior surgeon;
- ICU physician;
- other specialty consultants;
- operating room team.

Characters have limited roles and realistic availability.

Examples:

**Nurse**
> Уточните препарат, дозировку и путь введения.

**Radiologist**
> Предварительно вижу свободный газ. Официальное описание будет позже.

**Senior surgeon**
> Я буду через 20 минут.

**ICU physician**
> Я подхожу. Что уже сделано к моему приходу?

Calling a specialist must not pause the patient unless clinically appropriate.

---

## 14. Escalation

Calling for help is a valid clinical action.

If the patient is unstable and the learner calls a senior or intensivist, the system may respond:

> Старший хирург в дороге, реаниматолог идёт. Что делаешь пока они в пути? Пациент продолжает ухудшаться.

The learner retains responsibility for immediate management until help arrives.

Escalation should not be penalized when appropriate.

---

## 15. Consent, refusal, and patient autonomy

The platform should support patient refusal and autonomy as a universal capability.

Possible situations include:

- refusal of surgery;
- refusal of blood products;
- desire to leave against medical advice;
- disagreement from relatives where relevant;
- change of mind after discussion.

The learner must be able to communicate with the patient, explain options, assess capacity where relevant, escalate appropriately, and document/act according to the modeled clinical and legal context.

The patient should not always agree with the proposed plan.

---

## 16. Preoperative preparation

A decision to operate does not mean the patient is immediately ready for the operating room.

After the learner commits to operative management, the mentor should ask a natural question such as:

> Что нужно сделать до операции?

The learner should name at least part of the preparation.

If important items are omitted, the system may then state the missing critical items and continue according to the relevant safety rules.

Omitted items should also appear in the final debrief.

Preoperative requirements must be divided into:

- **hard prerequisites**, without which the next irreversible step cannot proceed;
- **important but non-blocking elements**, whose omission may have consequences and should appear in debrief.

The exact medical content of these categories belongs to approved clinical rules.

---

## 17. Operative simulation

### 17.1 Level of fidelity

ON QOL should simulate key operative decisions, not manual instrument movements.

The expected level is approximately 2 to 5 clinically meaningful intraoperative decisions in a typical case.

Example:

> Camera inserted. The appendix is thickened and inflamed. A small amount of fluid is present in the pelvis. What do you do?

A sufficient learner response may be:

> Удалю аппендикс, аспирирую жидкость из малого таза, дренаж не нужен.

If the plan is adequate and no further key decision is required, the technical operation can progress automatically.

### 17.2 Intraoperative surprises

Some cases may contain an unexpected operative finding.

Examples:

- imaging underestimated disease extent;
- the presumed diagnosis is modified by operative findings;
- a second pathology is discovered;
- anatomy or contamination changes the operative decision.

These should occur selectively, not in every case.

When a learner account exists, prior case exposure may be used to avoid repeatedly presenting the same pattern and to introduce controlled variation.

### 17.3 Errors during surgery

For suboptimal but executable operative choices, the system should usually allow the learner to proceed and model consequences rather than immediately reveal the answer.

---

## 18. Four-level clinical error model

Clinical actions are internally classified into four behavioral levels. These labels are never shown to the learner.

### Level 1: defensible but suboptimal

The action is clinically defensible but not preferred.

Default behavior:

- execute the action;
- mentor usually remains silent;
- discuss the trade-off in debrief where useful.

### Level 2: incorrect but educationally useful to experience

The decision is poor but not immediately catastrophic.

Default behavior:

- mentor may challenge once if the error is clinically important;
- if the learner persists, the action is executed;
- the patient experiences realistic consequences;
- the learner receives another opportunity to recognize and correct the problem.

Example:

An inappropriate postoperative disposition may lead to delayed recognition of deterioration on the ward.

### Level 3: very dangerous

The decision creates substantial near-term risk.

Default behavior:

- mentor intervenes strongly and immediately;
- mentor identifies the concern without automatically giving the final answer;
- if the learner insists, the action may still proceed when the consequence is clinically modeled, evidence-backed, and educationally useful;
- serious consequences may occur.

### Level 4: immediately catastrophic or unacceptable

The action creates an immediate, severe, evidence-backed hazard under an approved safety rule.

Default behavior:

- the action is not executed;
- the mentor clearly stops the learner;
- the learner must revise the action before proceeding.

Level 4 should be rare.

### General principle

ON QOL should prefer learning from consequences over hard blocking.

Hard blocks are reserved for situations where:

1. the risk is immediate and serious;
2. the relevant safety rule is reviewed and approved for training;
3. allowing the action provides less educational value than preventing normalization of a clearly unacceptable action.

Consequences should not be perfectly deterministic when real clinical outcomes are probabilistic.

A poor decision may increase risk rather than guarantee a scripted complication.

---

## 19. Postoperative care and disposition

After surgery, the learner should decide where the patient goes.

Possible destinations include:

- recovery;
- ICU;
- surgical ward;
- higher-level facility;
- other appropriate destination.

The patient must react to this decision.

Example:

If a high-risk patient is sent to a low-monitoring environment, deterioration may be recognized late.

A nurse may call the resident while the attending surgeon is unavailable:

> Пациенту хуже. Давление падает, ЧСС растёт. Дежурный хирург сейчас в операционной.

The learner must then manage the new situation.

---

## 20. Postoperative time and complications

Postoperative cases may evolve over hours and days.

The patient should have realistic complication risks based on:

- the underlying disease;
- operation;
- patient characteristics;
- perioperative course;
- learner actions and omissions;
- approved real-world frequency data where available.

Correct care must not guarantee a complication-free outcome.

Complications may occur despite appropriate care when that is clinically realistic.

Conversely, a poor decision should not always create the same complication at the same time.

---

## 21. Personalized case variation

When user accounts and longitudinal learning history are available, ON QOL may adapt future cases using prior exposure.

This may include:

- avoiding exact repetition of previously seen case patterns;
- changing phenotype;
- changing resource environment;
- introducing a different complication;
- adding an operative surprise;
- revisiting a previously identified learning gap in a different clinical context.

Personalization must not disclose the hidden learning algorithm to the learner during the case.

---

## 22. Mentor intervention policy

The mentor should intervene live primarily for:

1. danger to the patient;
2. a major current reasoning error;
3. genuine learner dead-end or explicit uncertainty.

The mentor should not interrupt simply because a rubric field is missing.

A competent learner should be able to complete multiple consecutive turns with no mentor message.

### 22.1 When the learner says «не знаю»

Support should increase progressively:

1. focused prompt;
2. cue;
3. options;
4. explanation using approved clinical content.

After helping, control returns to the learner.

### 22.2 When the learner disagrees

If the learner presents a clinically defensible alternative, the mentor must be able to acknowledge it.

Example:

> Да, справедливо. Этот путь допустим при таких условиях.

The mentor must not defend its prior position merely for conversational consistency.

### 22.3 Multiple legitimate pathways

The system must support more than one correct clinical pathway when evidence and context allow it.

The learner should not be forced into a single hidden answer key.

---

## 23. Mentor versus hospital characters

Routine operational clarification belongs to the hospital environment, not the mentor.

Examples:

- missing medication route: nurse;
- preliminary scan result: radiologist;
- OR availability: operating room staff;
- consultant ETA: relevant clinician;
- missing clinical reasoning: mentor.

This separation is important for realism.

---

## 24. Case termination

A case reaches a natural terminal state only after:

- safe discharge;
- safe transfer to another facility/care pathway;
- death of the patient.

If the learner manually ends the case earlier, the case is marked incomplete.

The simulator should not treat diagnostic confirmation or completion of surgery alone as case completion.

---

## 25. Debrief

The final debrief should include:

- major clinical errors;
- missed critical actions;
- important delays;
- reasoning gaps;
- treatment and monitoring gaps;
- operative and postoperative decisions;
- resource-related trade-offs;
- comparison with the evidence-based reference pathway;
- learning objectives;
- recommended reading;
- specific clinical gaps to revisit.

The debrief should distinguish:

- what the learner chose;
- what the system actually executed;
- what was blocked by content governance or resources;
- what happened to the patient;
- what would have been optimal under reference conditions.

A simulator limitation must never be presented as a learner omission.

---

## 26. Generalization requirement

The core simulator must not be designed around appendicitis-specific code.

A new disease module should reuse common capabilities such as:

- history;
- examination;
- vital signs;
- tests;
- treatments;
- monitoring;
- time;
- procedures;
- consultation;
- operative flow;
- ICU/ward disposition;
- deterioration;
- complications;
- discharge/transfer.

Adding a second disease module should primarily require new clinical content, not changes to the core runtime.

This is a key acceptance test for the redesign.

---

## 27. Relationship to existing ON QOL specifications

This Product Behavior Contract should be interpreted together with:

- **ON QOL North Star**: defines the overall product purpose and end-state;
- **ON QOL Clinical Evidence and Content Governance Specification**: defines what may serve as clinical truth and how clinical rules are reviewed;
- **ON QOL Mentor Behavior Specification**: defines the pedagogical behavior and clinical-content boundary of the mentor.

Where legacy implementation behavior conflicts with this contract, the behavior in this contract should guide the redesign unless explicitly revised.

Legacy session transcripts remain behavioral references, not sources of clinical truth.

---

## 28. Acceptance experience

The redesigned system is behaving correctly when a resident can say:

> I received a patient, not a quiz. I could examine, ask, order, treat, wait, reassess, operate, call for help, make mistakes, and see what happened. The hospital had real constraints. The patient changed over time. The senior surgeon mostly let me work, but stepped in when it mattered.

And not:

> I learned which sequence of phrases makes the simulator advance.

