/**
 * The one function allowed to answer "what does the learner currently know".
 *
 * Core Runtime Spec §51-52 and Mentor Spec §3.1/§17 both come down to the same
 * rule: the mentor - and the rule engine, and the debrief's live-teaching
 * layer - may only see what this function returns. `state.truth` never
 * crosses this boundary; `state.revealed` is the allowlist that decides what
 * does.
 *
 * Building this as one narrow projection (rather than trusting every mentor
 * call site to remember not to read `state.truth`) is what makes the boundary
 * enforceable instead of aspirational.
 */
export function buildLearnerVisibleState(state) {
  return Object.freeze({
    session: { mode: state.session.mode, presentationCategory: state.session.presentationCategory },
    clock: { ...state.clock },
    demographics: { ...state.demographics },
    location: state.location,
    physiologyKnownAt: latestVitalsSnapshot(state),
    // Pain belongs to the STATE it was observed in (matrix PO01). A value
    // measured before source control is not this patient's pain afterwards,
    // and reporting it as current is the renderer asserting something that has
    // stopped being true - so it is withheld and the status line says why.
    painScore: currentPainObservation(state),
    painState: state.symptoms.painState,
    // The authoritative qualitative postoperative pain stage set by the
    // approved TRJ-POSTOP-RECOVERY model (significant | improving |
    // controlled_on_oral_analgesia), or null before the model has been
    // entered. It lives in `symptoms` (like `painState`), never a number, and
    // never derived here from elapsed time - it is exactly what the model
    // wrote to state. `truth.recoveryPhase` is deliberately NOT surfaced: the
    // learner sees the qualitative pain stage, not the internal phase id.
    postopPainStage: state.symptoms.postopPainStage ?? null,
    monitoring: { level: state.monitoring.level, adequacy: state.monitoring.adequacy, prescribed: [...state.monitoring.prescribed] },
    // KINDS ONLY - never the content ids (Core Runtime Spec §51-52).
    //
    // The withheld-content records carry the id of the content object that was
    // withheld, and for patient-generation content that id IS hidden patient
    // truth: the phenotype id ("retrocecal") and the morphology
    // ("uncomplicated_inflammation") were both sitting in the learner-visible
    // projection from minute 0. Nothing rendered them, but this projection is
    // exactly what the mentor envelope and the rule engine are handed, so a
    // rule could have conditioned on the diagnosis before any learner-visible
    // evidence existed - the one leak the whole boundary exists to prevent.
    //
    // The debrief and the export read `state.simulatorLimitations` directly
    // and still get the full detail; only this projection is narrowed.
    simulatorLimitations: [...new Set(state.simulatorLimitations.map((entry) => entry.kind))],
    revealedFindings: [...state.revealed.findings],
    revealedResults: state.revealed.results
      .map((id) => state.investigations[id])
      .filter(Boolean)
      .map((inv) => ({ id: inv.id, status: inv.status, preliminary: inv.preliminary, result: inv.result })),
    revealedConstraints: [...state.hospital.constraints].filter((c) =>
      state.revealed.constraints.includes(c.id),
    ),
    observations: {
      historyTaken: state.observations.history.length > 0,
      examinedRegions: state.observations.examinations.map((e) => e.region),
    },
    activeTreatments: state.treatments.active.map((t) => ({ type: t.type, drugId: t.drugId ?? null })),
    infusions: state.infusions.map((i) => ({ fluidId: i.fluidId, status: i.status })),
    managementPlan: { ...state.managementPlan },
    preop: { ...state.preop },
    operative: {
      started: state.operative.started,
      findingsRevealed: [...state.operative.findingsRevealed],
      decisions: [...state.operative.decisions],
      pendingDecision: state.operative.pendingDecision,
    },
    reasoning: { ...state.reasoning },
    staff: { ...state.hospital.staff },
    turn: state.turn,
    mentor: { openQuestion: state.mentor.openQuestion, scaffolding: state.mentor.scaffolding },
  });
}

/**
 * The last pain observation, but only if it still describes the pain state the
 * patient is actually in.
 */
function currentPainObservation(state) {
  const snapshot = latestVitalsSnapshot(state);
  if (!snapshot) return null;
  if (snapshot.values.painState !== state.symptoms.painState) return null;
  return snapshot.values.painScore ?? null;
}

function latestVitalsSnapshot(state) {
  const last = state.observations.vitals.at(-1);
  return last ? { atMinutes: last.atMinutes, values: last.values } : null;
}
