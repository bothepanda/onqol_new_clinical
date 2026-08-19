/**
 * The router output recorded for replay 91ba7206, frozen as a fixture.
 *
 * Shared by replay91baRemediation.test.js and scripts/abMentor.mjs: the A/B
 * harness has to feed the engine exactly the intents the live router produced
 * that evening, or it is measuring the router rather than the mentor.
 */
export function routed(type, conceptId, requestedFragment) {
  return {
    type,
    concept_id: conceptId,
    confidence: 0.99,
    requested_fragment: requestedFragment,
  };
}

export function parameter(conceptId, verbatim, fields = {}) {
  return {
    concept_id: conceptId,
    verbatim,
    drug_name: null,
    dose_value: null,
    dose_unit: null,
    route: null,
    rate: null,
    frequency: null,
    duration: null,
    fluid_type: null,
    volume_ml: null,
    timing: null,
    ...fields,
  };
}

export function replayPayload(input) {
  const base = { intents: [], unresolved_fragments: [], action_parameters: [] };
  if (input === "физикальный осмотр и анамнез") {
    return {
      ...base,
      intents: [
        routed("request_examination", "physical_examination", "физикальный осмотр"),
        routed("request_history", "relevant_history", "анамнез"),
      ],
    };
  }
  if (input.startsWith("пока похоже не острый")) {
    return {
      ...base,
      intents: [
        routed("diagnosis", "acute_appendicitis", "острый аппендицит нетипичной локализации"),
        routed("diagnosis", "ectopic_pregnancy", "исключить проблемы с гинекологической системой"),
        routed("request_test", "cbc", "оак"),
        routed("request_test", "urinalysis", "оам"),
        routed("request_test", "beta_hcg", "тест на беременность"),
        routed("request_test", "pelvic_ultrasound", "узи омт"),
        routed("request_test", "abdominal_ultrasound", "обп"),
      ],
      reasoning: {
        working_diagnosis: {
          stated: true,
          concept_id: "acute_appendicitis",
          uncertainty_stated: true,
        },
        differential: {
          stated: true,
          ranked: false,
          has_dangerous_alternative: true,
          items: [
            { concept_id: "acute_appendicitis", rank: null, dangerous: false },
            { concept_id: "ectopic_pregnancy", rank: null, dangerous: true },
          ],
        },
        test_reasoning: [
          {
            concept_id: "pelvic_ultrasound",
            purpose_stated: true,
            management_consequence_stated: false,
            justification: "исключить проблемы с гинекологической системой",
          },
        ],
      },
    };
  }
  if (input === "пока непонятно. кт обп") {
    return {
      ...base,
      intents: [
        routed("management", "declare_uncertainty", "пока непонятно"),
        routed("request_test", "ct_abdomen_pelvis", "кт обп"),
      ],
      reasoning: {
        working_diagnosis: { stated: false, concept_id: null, uncertainty_stated: true },
        test_reasoning: [
          {
            concept_id: "ct_abdomen_pelvis",
            purpose_stated: false,
            management_consequence_stated: false,
            justification: null,
          },
        ],
      },
    };
  }
  if (input.includes("говтовим к операции")) {
    return {
      ...base,
      intents: [
        routed("management", "operative_approach_laparoscopic", "лапарочкопическая аппенденктомия"),
        routed("management", "informed_consent", "согласие пациента"),
        routed("management", "notify_anesthesia", "уведомить анестезиолога"),
        routed("management", "notify_operating_team", "узнать оперблок"),
        routed("unknown", null, "группа крови и кросс-матч"),
        routed("management", "iv_access", "16G"),
        routed("management", "iv_fluids", "физ-р-р 2 л"),
        routed("management", "analgesia", "ектотоп 30 мг в/м"),
        routed(
          "management",
          "preop_single_antibiotic_prophylaxis",
          "цефазолин 1 гр профилкатика в оперблок"
        ),
      ],
      unresolved_fragments: ["группа крови и кросс-матч"],
      action_parameters: [
        parameter("iv_fluids", "физ-р-р 2 л", {
          fluid_type: "физ-р-р",
          volume_ml: 2000,
        }),
        parameter("analgesia", "ектотоп 30 мг в/м", {
          drug_name: "ектотоп",
          dose_value: 30,
          dose_unit: "мг",
          route: "intramuscular",
        }),
        parameter(
          "preop_single_antibiotic_prophylaxis",
          "цефазолин 1 гр профилкатика в оперблок",
          { drug_name: "цефазолин", dose_value: 1, dose_unit: "г" }
        ),
      ],
      reasoning: { management: { plan_stated: true, urgency_stated: true, rationale_stated: false } },
    };
  }
  if (input === "ну значит открытая аппендектомия") {
    return {
      ...base,
      intents: [
        routed("management", "operative_approach_open", "открытая аппендектомия"),
      ],
    };
  }
  if (input.startsWith("готовим к открытой")) {
    return {
      ...replayPayload(input.replace("готовим к открытой аппендектоми", "говтовим к операции")),
      intents: [
        routed("management", "operative_approach_open", "открытой аппендектоми"),
        routed("management", "informed_consent", "согласие пациента"),
        routed("management", "notify_anesthesia", "уведомить анестезиолога"),
        routed("management", "notify_operating_team", "узнать оперблок"),
        routed("unknown", null, "группа крови и кросс-матч"),
        routed("management", "iv_access", "16G"),
        routed("management", "iv_fluids", "физ-р-р 2 л"),
        routed("management", "analgesia", "ектотоп 30 мг в/м"),
        routed(
          "management",
          "preop_single_antibiotic_prophylaxis",
          "цефазолин 1 гр профилкатика в оперблок"
        ),
      ],
    };
  }
  return base;
}

export function replay91baRouter(prompt) {
  return JSON.stringify(replayPayload(JSON.parse(prompt.user).raw_user_text));
}
