# ON QOL · Acute appendicitis · clinical review queue

Version: 0.2 · 08.08.2026

This package is **not `approved`**. The core is `reviewed_internal`; the Kazakh locale is a draft clinical translation.

## Must close before external pilot

1. **Independent clinical review of the whole card.** Production gate stays closed until an independent reviewer signs off.
2. **Kazakh clinical-language review.** Check the full `kk.yaml`, especially: `қауіп стратификациясы`, `инфекция ошағын санациялау/бақылау`, `интервалды аппендэктомия`, and transfer terminology.
3. **ICD-10 subcodes used by the pilot institutions.** The Kazakhstan 2018/2019 protocol lists K35.0/K35.1/K35.9, while the previous corpus used K35.2/K35.3/K35.8. The MVP core therefore stores only category K35 until local coding is confirmed.
4. **AIR/AAS/PAS numeric cutoffs.** Add primary validation sources before the simulator can display or score exact numeric thresholds.
5. **Local antibiotic formulary.** WSES does not provide a specific molecule in the recommendation set. Any drug/dose shown to learners needs a separately reviewed Kazakhstan formulary layer.
6. **NOM recurrence 15–20%.** Preserved from the internally reviewed card, but direct source-line verification should be attached before release.

## Operational rules that must NOT score yet

These were present conceptually in the previous corpus but are not direct WSES/KZ recommendations and are too context-dependent to become deterministic answers without review:

- transfer before vs after source control in abdominal sepsis;
- local operation vs transfer for a pregnant patient at a low-resource hospital;
- operation vs observation vs transfer at `basic` level when diagnosis remains uncertain.

They remain in `operationalized_rules` with `eligible_for_scoring: false`.

## Corrections made in v0.2

### 1. Definition of complicated disease
The previous Russian card classified “phlegmon” itself as complicated. The 2025 WSES table distinguishes uncomplicated appendiceal inflammation from complicated disease defined by extended gangrene/necrosis, perforation, abscess, or diffuse peritonitis. The machine definition was rewritten to avoid the ambiguous Russian use of “флегмона”.

### 2. NOM is not prohibited in every complicated case
The previous red-line section stated that NOM is only for uncomplicated appendicitis. This conflicts with the WSES periappendicular-abscess branch, where initial nonoperative management is an accepted alternative in defined settings. That absolute prohibition was removed.

### 3. Conditional recommendations are not hard bans
The previous card simultaneously said that conditional recommendations allow justified deviation and then encoded several conditional recommendations as hard red lines. v0.2 adds explicit scoring semantics: conditional recommendations may carry a penalty/default expectation but cannot become an absolute prohibition without another reviewed rule.

### 4. Kazakhstan delta #2 needs scope review
The Kazakhstan protocol recommends empiric antibiotics during 12/24-hour observation of intermediate-risk, diagnostically uncertain patients. WSES R15.1 concerns preoperative prophylaxis in adults with uncomplicated appendicitis undergoing laparoscopic appendectomy. The previous card called this a direct contradiction. v0.2 marks it `direct_conflict_or_scope_mismatch` until a reviewer confirms the populations/contexts are sufficiently aligned.

### 5. Transfer rules moved out of the evidence layer
The previous “transfer thresholds” section contained useful product hypotheses but some were stronger than the cited sources. They are preserved as ON QOL operationalization proposals, not guideline truth.
