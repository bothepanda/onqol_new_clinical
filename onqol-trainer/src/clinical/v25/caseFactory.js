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
      concept: "appendectomy at current hospital",
      router_description:
        "appendectomy or source control at the current hospital, open or laparoscopic",
      accepted_phrasings: [
        ...action.accepted_phrasings,
        "лапароскопическая аппендэктомия",
        "лапароскопически",
        "лаэ",
        "открытая аппендэктомия",
        "беру пациентку на операцию",
        "беру пациента на операцию",
      ],
      feedback_if_done:
        "Выполнен контроль источника в текущем стационаре выбранным и доступным доступом.",
      feedback_if_missed: "Тактика не дошла до выполнимого контроля источника.",
    };
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
      resourceProfile: "generated_at_session_start",
    },
  };
}

export const v25AppendicitisCase = createV25Case();
