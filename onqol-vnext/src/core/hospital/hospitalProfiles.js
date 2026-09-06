/**
 * Hospital profiles: the operational side of Contract §14 / Product Behavior
 * Contract §3.
 *
 * REFERENCE is an adequately resourced synthetic hospital - not a magic one.
 * Every capability still has a turnaround time; the point of Reference is to
 * remove artificial resource barriers, not to remove reality (spec §14.1).
 *
 * REAL profiles are named Kazakhstan-facing archetypes carried over from the
 * legacy KZ-R1/R2/R3 resource table (see
 * migration/legacy-content/KZ_RESOURCE_PROFILES_REVIEW.md), which is marked
 * `WORKFLOW_ASSUMPTIONS_PENDING_OWNER_REVIEW` - so these numbers are runtime
 * scaffolding, not an approved facility claim. `reviewStatus` on each profile
 * carries that forward instead of silently upgrading it.
 *
 * TWO FIELDS ADDED BY THE 2026-08-25 CLINICAL REMEDIATION
 *
 * `jurisdiction` (matrix §13). A hospital declares which jurisdiction's
 * workflow rules it runs under. `operative.yaml` marks ABO/Rh and coagulation
 * as `jurisdiction: KZ`, and those preoperative requirements apply only in a
 * hospital that declares KZ. This is what keeps a Kazakhstan standard from
 * being taught to the learner as universal evidence-based medicine.
 *
 * `radiologyPolicy.requiresCurrentCreatinineForContrastCt` (matrix I12, task
 * §10). The old build had no such behaviour; the review says that IF ON QOL
 * wants "radiology will not do a contrast CT without a current creatinine",
 * it must be a DEPARTMENT policy attached to a hospital profile, never a
 * universal medical contraindication - ACR supports risk-based rather than
 * universal renal screening. The mechanism exists here and is OFF by default
 * in every shipped profile: turning it on is a site-policy decision, and the
 * matrix records that decision as NEEDS SITE POLICY.
 */

const alwaysAvailable = (etaMinutes = 0) => ({ available: true, etaMinutes });
const unavailable = (reasonKey) => ({ available: false, reason: reasonKey });

export const REFERENCE_HOSPITAL_PROFILE = Object.freeze({
  profileId: "REFERENCE-FULL",
  profileTitleKey: "hospital.reference.title",
  reviewStatus: "approved_for_pilot", // REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md
  // Reference care is operationally jurisdiction-neutral. Kazakhstan teaching
  // belongs to the session's jurisdictionContext and must not turn local
  // workflow into a universal operative prerequisite.
  jurisdiction: null,
  radiologyPolicy: Object.freeze({ requiresCurrentCreatinineForContrastCt: false }),
  capabilities: Object.freeze({
    laboratory: alwaysAvailable(30),
    ultrasound: alwaysAvailable(40),
    ct: alwaysAvailable(60),
    mri: alwaysAvailable(90),
    operatingRoom: alwaysAvailable(45),
    anesthesia: alwaysAvailable(20),
    laparoscopy: alwaysAvailable(0),
    icuBed: alwaysAvailable(30),
    bloodProducts: alwaysAvailable(30),
  }),
  staff: Object.freeze({
    nurse: { present: true, called: false, etaMinutes: 0 },
    radiologist: { present: false, called: false, etaMinutes: 15 },
    anesthesiologist: { present: false, called: false, etaMinutes: 20 },
    seniorSurgeon: { present: false, called: false, etaMinutes: 20 },
    icuPhysician: { present: false, called: false, etaMinutes: 15 },
  }),
  nightHours: null, // reference mode does not add a day/night resource penalty
});

/**
 * @param {"KZ-R1-DISTRICT"|"KZ-R2-URBAN"|"KZ-R3-TERTIARY"} id
 */
export const REAL_HOSPITAL_PROFILES = Object.freeze({
  "KZ-R1-DISTRICT": Object.freeze({
    profileId: "KZ-R1-DISTRICT",
    jurisdiction: "KZ",
    radiologyPolicy: { requiresCurrentCreatinineForContrastCt: false },
    profileTitleKey: "hospital.real.district.title",
    reviewStatus: "pending_owner_review",
    capabilities: Object.freeze({
      laboratory: alwaysAvailable(45),
      ultrasound: { available: true, etaMinutes: 60, onlyDuringHours: [9, 21] },
      ct: unavailable("resource.ct.not_installed"),
      mri: unavailable("resource.mri.not_installed"),
      operatingRoom: alwaysAvailable(60),
      anesthesia: alwaysAvailable(30),
      laparoscopy: unavailable("resource.laparoscopy.absent"),
      icuBed: { available: true, etaMinutes: 30, note: "icu.no_prolonged_ventilation" },
      bloodProducts: { available: false, reason: "resource.blood.not_authored" },
    }),
    staff: Object.freeze({
      nurse: { present: true, called: false, etaMinutes: 0 },
      radiologist: { present: false, called: false, etaMinutes: 40 },
      anesthesiologist: { present: false, called: false, etaMinutes: 30 },
      seniorSurgeon: { present: false, called: false, etaMinutes: 35 },
      icuPhysician: { present: false, called: false, etaMinutes: 30 },
    }),
    transferEtaMinutes: 150,
    nightHours: [22, 7],
  }),
  "KZ-R2-URBAN": Object.freeze({
    profileId: "KZ-R2-URBAN",
    jurisdiction: "KZ",
    radiologyPolicy: { requiresCurrentCreatinineForContrastCt: false },
    profileTitleKey: "hospital.real.urban.title",
    reviewStatus: "pending_owner_review",
    capabilities: Object.freeze({
      laboratory: alwaysAvailable(35),
      ultrasound: alwaysAvailable(45),
      ct: alwaysAvailable(70),
      mri: unavailable("resource.mri.not_installed"),
      operatingRoom: alwaysAvailable(50),
      anesthesia: alwaysAvailable(25),
      laparoscopy: { available: true, etaMinutes: 0, unitsAvailable: 1 },
      icuBed: alwaysAvailable(30),
      bloodProducts: { available: false, reason: "resource.blood.not_authored" },
    }),
    staff: Object.freeze({
      nurse: { present: true, called: false, etaMinutes: 0 },
      radiologist: { present: false, called: false, etaMinutes: 20 },
      anesthesiologist: { present: false, called: false, etaMinutes: 20 },
      seniorSurgeon: { present: false, called: false, etaMinutes: 20 },
      icuPhysician: { present: false, called: false, etaMinutes: 15 },
    }),
    transferEtaMinutes: 45,
    nightHours: [23, 7],
  }),
  "KZ-R3-TERTIARY": Object.freeze({
    profileId: "KZ-R3-TERTIARY",
    jurisdiction: "KZ",
    radiologyPolicy: { requiresCurrentCreatinineForContrastCt: false },
    profileTitleKey: "hospital.real.tertiary.title",
    reviewStatus: "pending_owner_review",
    capabilities: Object.freeze({
      laboratory: alwaysAvailable(25),
      ultrasound: alwaysAvailable(35),
      ct: alwaysAvailable(50),
      mri: alwaysAvailable(80),
      operatingRoom: alwaysAvailable(40),
      anesthesia: alwaysAvailable(20),
      laparoscopy: { available: true, etaMinutes: 0, unitsAvailable: 2 },
      icuBed: alwaysAvailable(25),
      bloodProducts: { available: false, reason: "resource.blood.not_authored" },
    }),
    staff: Object.freeze({
      nurse: { present: true, called: false, etaMinutes: 0 },
      radiologist: { present: false, called: false, etaMinutes: 10 },
      anesthesiologist: { present: false, called: false, etaMinutes: 15 },
      seniorSurgeon: { present: false, called: false, etaMinutes: 20 },
      icuPhysician: { present: false, called: false, etaMinutes: 10 },
    }),
    transferEtaMinutes: 20,
    nightHours: [23, 7],
  }),
});

/**
 * The one place a profile's jurisdiction is read. Content items carrying
 * `jurisdiction: null` apply everywhere; a non-null value applies only in a
 * hospital that declares it.
 */
export function appliesInJurisdiction(itemJurisdiction, hospitalJurisdiction) {
  if (itemJurisdiction == null) return true;
  return itemJurisdiction === hospitalJurisdiction;
}

export function resolveHospitalProfile(mode, realProfileId) {
  if (mode === "reference") return REFERENCE_HOSPITAL_PROFILE;
  const profile = REAL_HOSPITAL_PROFILES[realProfileId];
  if (!profile) throw new Error(`Unknown real hospital profile "${realProfileId}".`);
  return profile;
}
