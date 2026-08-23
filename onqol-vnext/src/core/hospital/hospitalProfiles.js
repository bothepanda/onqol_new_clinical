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
 */

const alwaysAvailable = (etaMinutes = 0) => ({ available: true, etaMinutes });
const unavailable = (reasonKey) => ({ available: false, reason: reasonKey });

export const REFERENCE_HOSPITAL_PROFILE = Object.freeze({
  profileId: "REFERENCE-FULL",
  profileTitleKey: "hospital.reference.title",
  reviewStatus: "approved_for_pilot", // REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md
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

export function resolveHospitalProfile(mode, realProfileId) {
  if (mode === "reference") return REFERENCE_HOSPITAL_PROFILE;
  const profile = REAL_HOSPITAL_PROFILES[realProfileId];
  if (!profile) throw new Error(`Unknown real hospital profile "${realProfileId}".`);
  return profile;
}
