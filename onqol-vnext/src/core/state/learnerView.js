/**
 * The one function allowed to answer "what does the learner currently know".
 *
 * Foundation Spec §51-52 and Mentor Spec §3.1/§17 both come down to the same
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
    painScore: latestVitalsSnapshot(state)?.values?.painScore ?? null,
    monitoring: { level: state.monitoring.level, adequacy: state.monitoring.adequacy, prescribed: [...state.monitoring.prescribed] },
    simulatorLimitations: [...state.simulatorLimitations],
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

function latestVitalsSnapshot(state) {
  const last = state.observations.vitals.at(-1);
  return last ? { atMinutes: last.atMinutes, values: last.values } : null;
}
