import { t } from "../i18n/strings.js";

/**
 * Shift/resource constraints already revealed to the learner (task brief
 * §23.5.C). Reads only `learnerVisible.revealedConstraints` - a constraint
 * the hospital has but has not yet told the learner about must not appear
 * here (Core Runtime Spec §15: the system states a limitation when it becomes
 * operationally relevant, not preemptively).
 */
export function ConstraintList({ locale, constraints }) {
  if (!constraints || constraints.length === 0) {
    return <p className="onqol-empty">{t(locale, "sidebar.noConstraints")}</p>;
  }
  return (
    <ul className="onqol-constraint-list">
      {constraints.map((constraint) => (
        <li key={constraint.id}>{constraint.textRu}</li>
      ))}
    </ul>
  );
}
