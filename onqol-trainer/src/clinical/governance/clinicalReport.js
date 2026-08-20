/**
 * Clinical error reporting — governance §23.
 *
 * WHY THIS EXISTS
 *
 * Eight residents running four presets will find content errors. Without a
 * structured channel those arrive as corridor remarks: "там СРБ какой-то
 * странный", with no session, no case version and no rule version attached, and
 * they cannot be triaged, reproduced or closed.
 *
 * WHAT IT IS NOT
 *
 * It is not product feedback and it is not a rating. A report never changes a
 * rule, a score or a patient fact. It produces a record that a reviewer can act
 * on, and the acting is done by a person through the normal review process.
 *
 * WHAT IT CARRIES
 *
 * Everything needed to rebuild the moment: session id, case and content
 * versions, the rule and source registry versions active at the time, the path
 * state, the preset and the effective seed. Reporter identity is a course year,
 * never a name — the pilot is anonymous and stays anonymous.
 *
 * PILOT SCOPE
 *
 * Storage is local to the browser and exported as a file by the educator. No
 * server, no central store: a central queue would need its own retention and
 * consent gate, and eight learners in one room do not need one.
 */

import { scrubSensitiveText } from "../privacy.js";
import {
  CLINICAL_GOVERNANCE_VERSION,
  CLINICAL_RULE_REGISTRY_VERSION,
  SOURCE_REGISTRY_VERSION,
} from "./clinicalGovernance.js";

export const CLINICAL_REPORT_SCHEMA_VERSION = "clinical-report-v1.0";
export const CLINICAL_REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The categories a reporter chooses from.
 *
 * Each maps to who has to look at it. A category nobody owns is a category that
 * produces reports nobody closes.
 */
export const CLINICAL_REPORT_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "wrong_patient_fact",
    label_ru: "Неверные данные о пациенте",
    hint_ru: "Анализ, находка осмотра, снимок или динамика, которых так не бывает",
    routes_to: "clinical_reviewer",
  }),
  Object.freeze({
    id: "wrong_dose_or_threshold",
    label_ru: "Неверная доза, порог или срок",
    hint_ru: "Число, которое тренажёр назвал или принял, выглядит неправильным",
    routes_to: "clinical_reviewer_high_risk",
  }),
  Object.freeze({
    id: "inappropriate_mentor_correction",
    label_ru: "Наставник поправил неправильно",
    hint_ru: "Придрался не к тому, поправил верное решение или дал неверный совет",
    routes_to: "mentor_policy_owner",
  }),
  Object.freeze({
    id: "pathway_inconsistency",
    label_ru: "Нарушена последовательность кейса",
    hint_ru: "Действие выполнено, но случилось не то, или случай не двигается дальше",
    routes_to: "engine_owner",
  }),
  Object.freeze({
    id: "outdated_rule",
    label_ru: "Правило устарело",
    hint_ru: "Текущее руководство говорит иначе, чем тренажёр",
    routes_to: "clinical_reviewer",
  }),
  Object.freeze({
    id: "local_protocol_conflict",
    label_ru: "Расходится с КП МЗ РК или локальным протоколом",
    hint_ru: "У нас так не делают или протокол требует другого",
    routes_to: "kz_local_reviewer",
  }),
  Object.freeze({
    id: "missing_alternative",
    label_ru: "Нет допустимой альтернативы",
    hint_ru: "Резидент назвал клинически приемлемый вариант, а тренажёр его не принял",
    routes_to: "clinical_reviewer",
  }),
  Object.freeze({
    id: "not_modelled_but_needed",
    label_ru: "Не смоделировано, но нужно",
    hint_ru: "Действие распознано, результат не задан, а без него решение принять нельзя",
    routes_to: "content_author",
  }),
  Object.freeze({
    id: "language_or_wording",
    label_ru: "Формулировка или перевод",
    hint_ru: "Русский текст звучит неверно, двусмысленно или неестественно для клинического общения",
    routes_to: "language_reviewer",
  }),
  Object.freeze({
    id: "other",
    label_ru: "Другое",
    hint_ru: "Опишите словами",
    routes_to: "triage",
  }),
]);

export const CLINICAL_REPORT_CATEGORY_IDS = Object.freeze(
  CLINICAL_REPORT_CATEGORIES.map((category) => category.id)
);

/** Who is reporting. A course year, never a name. */
export const REPORTER_ROLES = Object.freeze([
  "resident_year_1",
  "resident_year_2",
  "resident_year_3",
  "resident_year_4",
  "faculty",
  "unspecified",
]);

const categoryById = new Map(
  CLINICAL_REPORT_CATEGORIES.map((category) => [category.id, category])
);

/** How many recent turns travel with a report. Enough to see the moment. */
const CONTEXT_TURN_COUNT = 3;

function recentTurns(session) {
  return (session?.eventLog || [])
    .filter((entry) => entry.event_type === "clinical_turn")
    .slice(-CONTEXT_TURN_COUNT)
    .map((entry) => ({
      turn_number: entry.turn_number ?? null,
      // Already redacted when the event was written; scrubbed again because a
      // report leaves the browser as a file and this is the last chance.
      learner_text_redacted: scrubSensitiveText(entry.raw_text_redacted || ""),
      parsed_action_ids: (entry.parsed_actions || []).map((action) => action.action_id),
      findings_revealed: entry.findings_revealed || [],
      path_state: entry.path_state || null,
    }));
}

/**
 * Build one clinical report record.
 *
 * Returns `{ ok: false, errors }` rather than throwing: a learner mistyping a
 * category must not end their session.
 *
 * @param {object} input
 * @param {object} input.caseData
 * @param {object} input.session
 * @param {string} input.categoryId
 * @param {string} input.comment          the reporter's own words
 * @param {string} [input.reporterRole]
 * @param {string} [input.disputedContent] what the trainer said, quoted by the reporter
 * @param {string} [input.reportId]        supplied by the caller for determinism in tests
 * @param {string} [input.reportedAt]      ISO timestamp; defaults to now
 */
export function createClinicalReport({
  caseData,
  session,
  categoryId,
  comment,
  reporterRole = "unspecified",
  disputedContent = null,
  reportId = null,
  reportedAt = null,
} = {}) {
  const errors = [];
  const category = categoryById.get(categoryId);
  if (!category) errors.push("unknown_category");
  const text = String(comment || "").trim();
  if (text.length < 3) errors.push("comment_required");
  if (!session?.session_id) errors.push("session_required");
  const role = REPORTER_ROLES.includes(reporterRole) ? reporterRole : "unspecified";
  if (errors.length) return { ok: false, errors, report: null };

  const composition = caseData?.v35_composition || {};
  return {
    ok: true,
    errors: [],
    report: {
      schema_version: CLINICAL_REPORT_SCHEMA_VERSION,
      report_id: reportId || `rep-${session.session_id}-${(session.eventLog || []).length}`,
      reported_at: reportedAt || new Date().toISOString(),
      category: category.id,
      category_label_ru: category.label_ru,
      routes_to: category.routes_to,
      reporter_role: role,
      comment_redacted: scrubSensitiveText(text),
      disputed_content_redacted: disputedContent
        ? scrubSensitiveText(String(disputedContent))
        : null,

      // Everything a reviewer needs to rebuild the moment being disputed.
      context: {
        session_id: session.session_id,
        case_id: caseData?.case_id || null,
        case_version: caseData?.case_version || null,
        content_version: composition.content_version || null,
        case_preset_id: composition.case_preset_id || null,
        phenotype_id: composition.phenotype_id || null,
        effective_seed: composition.effective_seed || null,
        resource_profile_id: composition.effective_resource_profile_id || null,
        resource_profile_version: composition.resource_profile_version || null,
        scenario_mode: session.scenario?.mode || null,
        path_state: session.pathState || null,
        turn_number: session.workingMemory?.turnNumber ?? null,
        clock_minutes: session.temporalState?.clockMinutes ?? null,
        clinical_governance_version: CLINICAL_GOVERNANCE_VERSION,
        clinical_rule_registry_version: CLINICAL_RULE_REGISTRY_VERSION,
        source_registry_version: SOURCE_REGISTRY_VERSION,
        recent_turns: recentTurns(session),
      },

      // A report is an input to review, never a verdict. These stay fixed.
      review_status: "reported",
      changes_runtime: false,
      changes_scoring: false,
    },
  };
}

/** Storage key for the pilot's local report queue. */
export const CLINICAL_REPORT_STORAGE_KEY = "onqol_clinical_reports_v1";

function rawReports(storage) {
  try {
    const raw = storage?.getItem(CLINICAL_REPORT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function reportExpiry(report, retentionMs) {
  if (report?.local_retention?.expires_at) {
    return Date.parse(report.local_retention.expires_at);
  }
  const reportedAt = Date.parse(report?.reported_at || 0);
  return Number.isFinite(reportedAt) ? reportedAt + retentionMs : 0;
}

function readReports(storage, options = {}) {
  const now = options.now?.() ?? Date.now();
  const retentionMs = options.retentionMs || CLINICAL_REPORT_RETENTION_MS;
  const reports = rawReports(storage);
  const active = reports.filter((report) => reportExpiry(report, retentionMs) > now);
  if (active.length !== reports.length) {
    storage?.setItem(CLINICAL_REPORT_STORAGE_KEY, JSON.stringify(active));
  }
  return active;
}

/** Append one report to the local queue. Returns the stored record. */
export function saveClinicalReport(report, storage = globalThis.localStorage, options = {}) {
  const now = options.now?.() ?? Date.now();
  const retentionMs = options.retentionMs || CLINICAL_REPORT_RETENTION_MS;
  const reports = readReports(storage, { now: () => now, retentionMs });
  const stored = {
    ...report,
    local_retention: {
      policy: "delete_on_or_after_expiry_when_app_opens",
      expires_at: new Date(now + retentionMs).toISOString(),
    },
  };
  reports.push(stored);
  storage?.setItem(CLINICAL_REPORT_STORAGE_KEY, JSON.stringify(reports));
  return stored;
}

export function listClinicalReports(storage = globalThis.localStorage, options = {}) {
  return readReports(storage, options);
}

export function clearClinicalReports(storage = globalThis.localStorage) {
  storage?.removeItem(CLINICAL_REPORT_STORAGE_KEY);
}

/**
 * The educator's export: the whole local queue as one reviewable package.
 *
 * Grouped by what has to be looked at, because the queue is triaged by owner
 * and a flat list of twenty reports is not a work item.
 */
export function exportClinicalReports(storage = globalThis.localStorage, options = {}) {
  const reports = readReports(storage, options);
  const byRoute = {};
  for (const report of reports) {
    const route = report.routes_to || "triage";
    byRoute[route] = (byRoute[route] || 0) + 1;
  }
  return {
    export_schema_version: CLINICAL_REPORT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    clinical_rule_registry_version: CLINICAL_RULE_REGISTRY_VERSION,
    source_registry_version: SOURCE_REGISTRY_VERSION,
    total: reports.length,
    counts_by_route: byRoute,
    reports,
  };
}
