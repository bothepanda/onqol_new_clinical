/**
 * Pain BEFORE source control and pain AFTER it are different states, not one
 * number that quietly changes meaning (review matrix PO01, T05; remediation
 * task §18.1).
 *
 * The vertical-slice build carried one `symptoms.painScore` from arrival to
 * discharge and let the post-source-control trajectory decrement it. The
 * clinical reviewer rejected that outright: once the source of the disease has
 * been removed, the pain the patient reports is a NEW, differently behaving
 * pain, and subtracting from the old number models a disease that is slowly
 * resolving after it has already been cured.
 *
 * So the two live in separate fields, and the transition is an explicit,
 * replayable state change at SOURCE_CONTROL_COMPLETED.
 *
 * Nothing here names a disease or an operation: "source control" is the
 * architecture's own concept, declared per-disease by content
 * (`operative.yaml` marks which choices achieve it), so a second module gets
 * this split with no change.
 *
 * WHAT IS DELIBERATELY MISSING: a post-source-control pain VALUE. That content
 * (`trajectories.yaml#post_source_control_course`) is `null` pending clinical
 * review, and task §18.1 forbids inventing a recovery curve. So
 * `postSourceControlPainScore` stays `null`, the status renderer says plainly
 * that it is not modeled in this build, and the gap is recorded as a simulator
 * limitation - never as "pain 3/10, improving".
 */
export const PAIN_STATE = Object.freeze({
  PRE_SOURCE_CONTROL: "pre_source_control",
  POST_SOURCE_CONTROL: "post_source_control",
});

/**
 * The pain value that is true RIGHT NOW, or `null` when the active state has
 * no reviewed value. Every read of "current pain" goes through here so no call
 * site can accidentally keep reporting the pre-source-control number after the
 * source has been controlled.
 */
export function activePainScore(symptoms) {
  if (!symptoms) return null;
  if (symptoms.painState === PAIN_STATE.POST_SOURCE_CONTROL) return symptoms.postSourceControlPainScore ?? null;
  return symptoms.preSourceControlPainScore ?? null;
}

/** The field the active pain state writes to, for a governed treatment effect. */
export function activePainField(symptoms) {
  return symptoms?.painState === PAIN_STATE.POST_SOURCE_CONTROL
    ? "postSourceControlPainScore"
    : "preSourceControlPainScore";
}

/**
 * The state transition itself. Structural and unconditional - it happens
 * because the source was controlled, which is an event the architecture owns.
 * The VALUE it transitions to is content, and that content does not exist yet.
 */
export function toPostSourceControlPain(symptoms) {
  return {
    ...symptoms,
    painState: PAIN_STATE.POST_SOURCE_CONTROL,
    // The pre-source-control value is retained as history, not carried forward
    // as if it were still the patient's pain.
    preSourceControlPainScoreAtSourceControl: symptoms.preSourceControlPainScore ?? null,
    preSourceControlPainScore: null,
    postSourceControlPainScore: null,
    postSourceControlPainModeled: false,
  };
}
