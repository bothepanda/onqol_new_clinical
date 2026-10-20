// V1 is retained on disk for historical inspection but never resumed as truth.
export const LEGACY_FLEXIBLE_STORAGE_KEY = "onqol-flexible-patient-v1";
export const FLEXIBLE_STORAGE_KEY = "onqol-flexible-patient-v2";
export function hasLegacyFlexibleSession(storage) {
  try { return Boolean(storage?.getItem(LEGACY_FLEXIBLE_STORAGE_KEY)); } catch { return false; }
}
