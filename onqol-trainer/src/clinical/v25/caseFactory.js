import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";

const V25_PRESENTATION =
  "Женщина, 34 года. Доставлена в приёмное отделение ночью. Боль началась около пупка 8 часов назад, через 3 часа сместилась в правую подвздошную область. Была двукратная рвота в начале. Температура 37,8 °C, ЧСС 96/мин, АД 118/72 мм рт. ст., ЧД 18/мин, SpO₂ 98%. С чего начнёшь?";

export function createV25Case() {
  const surgeryAction = acuteAppendicitisCase.expected_actions.find(
    (action) => action.id === "open_appendectomy_here"
  );
  const expectedActions = acuteAppendicitisCase.expected_actions.map((action) => {
    if (action.id === "preop_single_antibiotic_prophylaxis") {
      return {
        ...action,
        accepted_phrasings: [
          ...action.accepted_phrasings,
          "антибиотикопрофилактика",
          "антибиотик до разреза",
          "антибиотик перед разрезом",
        ],
      };
    }
    if (action.id !== "open_appendectomy_here") return { ...action };
    return {
      ...action,
      id: "appendectomy_here",
      legacy_action_aliases: ["open_appendectomy_here"],
      concept: "completed appendectomy at current hospital",
      router_description:
        "explicit completion of appendectomy or source control at the current hospital",
      accepted_phrasings: [
        "аппендэктомия выполнена",
        "операция завершена",
        "завершаю аппендэктомию",
        "контроль источника завершен",
        "контроль источника завершён",
      ],
      prerequisites: ["appendectomy_procedure_start"],
      feedback_if_done:
        "Выполнен контроль источника в текущем стационаре выбранным и доступным доступом. " +
        "У стабильного взрослого с неосложнённым аппендицитом операция в пределах 24 часов " +
        "от госпитализации приемлема, и назначение её на утро внутри этого окна ошибкой не " +
        "является. 24 часа — это потолок, а не цель, до которой нужно ждать: ухудшение, " +
        "подозрение на осложнённый процесс или отсутствие переоценки требуют вмешаться раньше.",
      feedback_if_missed: "Тактика не дошла до выполнимого контроля источника.",
    };
  });
  expectedActions.push({
    id: "appendectomy_procedure_start",
    phase: "management",
    concept: "start appendectomy procedure",
    intent_type: "management",
    router_description:
      "explicit start of the operation, induction or incision after the approach was selected",
    accepted_phrasings: [
      "начинаю операцию",
      "приступаем к операции",
      "начинаю аппендэктомию",
      "выполняю операцию",
      "делаю разрез",
      "начинаем индукцию",
    ],
    importance: "workflow",
    score_weight: 0,
    domain: "Management",
    critical: false,
    time_window: "preoperative",
    prerequisites: [],
    effects_on_case: {},
    feedback_if_done: "Начало вмешательства зафиксировано отдельно от выбора доступа.",
    feedback_if_missed: "Начало вмешательства не было зафиксировано.",
    evidence_reference_ids: ["who-ssc-sign-in", "who-ssc-time-out"],
    eligible_for_scoring: false,
    available_to_order: true,
    expected_for_this_patient: true,
    finding_status: "not_applicable",
  });
  const ctAction = acuteAppendicitisCase.unnecessary_actions.find((action) => action.id === "ct_abdomen");

  return {
    ...acuteAppendicitisCase,
    case_id: "app-acute-v25-001",
    case_version: "2.5.0-alpha.1",
    resource_setting: "dynamic",
    title: "Боль в правой подвздошной области",
    initial_presentation: { text: V25_PRESENTATION },
    expected_actions: expectedActions,
    state_transitions: acuteAppendicitisCase.state_transitions.map((transition) => ({
      ...transition,
      when_all_done: (transition.when_all_done || []).map((id) =>
        id === "open_appendectomy_here" ? "appendectomy_here" : id
      ),
      when_any_done: (transition.when_any_done || []).map((id) =>
        id === "open_appendectomy_here" ? "appendectomy_here" : id
      ),
    })),
    critical_omissions: acuteAppendicitisCase.critical_omissions.map((id) =>
      id === "open_appendectomy_here" ? "appendectomy_here" : id
    ),
    dependent_omissions: Object.fromEntries(
      Object.entries(acuteAppendicitisCase.dependent_omissions || {}).map(([id, dependencies]) => [
        id === "open_appendectomy_here" ? "appendectomy_here" : id,
        dependencies.map((dependency) =>
          dependency === "open_appendectomy_here" ? "appendectomy_here" : dependency
        ),
      ])
    ),
    diagnostic_milestones: (acuteAppendicitisCase.diagnostic_milestones || []).map((id) =>
      id === "open_appendectomy_here" ? "appendectomy_here" : id
    ),
    management_milestones: (acuteAppendicitisCase.management_milestones || []).map((id) =>
      id === "open_appendectomy_here" ? "appendectomy_here" : id
    ),
    acceptable_alternatives: [
      ...acuteAppendicitisCase.acceptable_alternatives.map((action) => ({ ...action })),
      ...(ctAction
        ? [
            {
              ...ctAction,
              score_weight: 0,
              penalty: 0,
              feedback:
                "Запрос КТ оценивается по доступности в сгенерированном стационаре и по тому, как врач адаптирует план после ответа службы.",
            },
          ]
        : []),
    ],
    unnecessary_actions: acuteAppendicitisCase.unnecessary_actions
      .filter((action) => action.id !== "ct_abdomen")
      .map((action) => ({ ...action })),
    unsafe_actions: acuteAppendicitisCase.unsafe_actions.map((action) => ({ ...action })),
    available_findings: {
      ...acuteAppendicitisCase.available_findings,
      abdominal_ultrasound: {
        title: "УЗИ брюшной полости",
        text:
          "Червеобразный отросток визуализирован частично, не сжимается при компрессии; вокруг умеренные воспалительные изменения. Свободной жидкости и сформированного абсцесса не выявлено.",
        review_status: "synthetic_case_fact_needs_external_review",
      },
      pelvic_ultrasound: {
        title: "УЗИ органов малого таза",
        text: "Маточной беременности и объёмных образований придатков не выявлено.",
        review_status: "synthetic_case_fact_needs_external_review",
      },
      ct_abdomen: {
        title: "КТ брюшной полости",
        text:
          "Аппендикс утолщён, с периаппендикулярными воспалительными изменениями; признаков абсцесса, свободного газа и распространённого перитонита нет.",
        review_status: "synthetic_case_fact_needs_external_review",
      },
    },
    resource_context: {
      level: "dynamic",
      available: [],
      delayed: [],
      unavailable: [],
      transfer: "generated per scenario",
      provenance_note:
        "V2.5 generates a synthetic facility capability profile and shift overrides. It does not claim to represent a named Kazakhstan hospital.",
    },
    learning_objectives: [
      ...acuteAppendicitisCase.learning_objectives.filter(
        (objective) => !objective.includes("basic resource level")
      ),
      "Адаптировать путь к контролю источника после раскрытия реальных ограничений смены.",
    ],
    _v25: {
      sourceSurgeryAction: surgeryAction?.id,
      canonicalSurgeryAction: "appendectomy_here",
      resourceProfile: "generated_at_session_start",
    },
  };
}

export const v25AppendicitisCase = createV25Case();
