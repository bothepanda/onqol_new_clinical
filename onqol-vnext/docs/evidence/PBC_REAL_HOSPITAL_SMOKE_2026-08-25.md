# PBC Real Hospital smoke — APP-004

**Date:** 2026-08-25
**Contract:** ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22 (`26b5bb0d…d992dff3`)
**Mode:** Real Hospital (`KZ-R2-URBAN`) · **Seed:** `PBC-REAL-2` · **Start:** 2026-08-23T02:15+05:00
**Constraint drawn:** `ct_scanner_down` (seeded, not random per session)
**Replay:** [`PBC_REAL_HOSPITAL_SMOKE_2026-08-25.replay.json`](PBC_REAL_HOSPITAL_SMOKE_2026-08-25.replay.json)

## Coverage of the task §10.2 checklist

| required check | observed | contract |
| --- | --- | --- |
| constraint revealed only when known | sidebar empty at minute 0; the broken scanner appears **only** after «КТ ОБП» ran into it | §3.2 |
| sidebar updates | `revealedConstraints` → «КТ сейчас недоступна: аппарат на ремонте…» | §3.2 |
| biology unchanged by the missing resource | same seed in Reference and Real produces byte-identical `truth`, `physiology`, `symptoms` — asserted by `PBC-3 a missing resource does not change the patient's biology` | §3.3 |
| mentor does not solve the resource problem | mentor silent on the constraint turn; the refusal is spoken by the hospital | §9.3, §23 |
| debrief separates resource constraint from learner error | `resourceLimitations[0].noteRu` = «Ограничение ресурса стационара. Не является ошибкой обучающегося.»; `importantMisses` is empty | §25 |
| deterministic / replayable | replaying the seed reproduces the same constraint draw and the same patient truth | §3.2 |

## Resource-constrained pathway actually exercised

The scanner being down changes what the learner can do, not what the patient
has. With CT unavailable the learner fell back to ultrasound, which came back
**nondiagnostic** — reported as «исследование неинформативно в отношении
аппендикса», never as a negative study — and then chose interfacility transfer.

Transfer now consumes the profile's authored transport time (45 min for
`KZ-R2-URBAN`; 150 min for `KZ-R1-DISTRICT`), so the case ends at minute 165
rather than instantaneously. Before this pass the ambulance arrived in zero
minutes and `transferEtaMinutes` was authored on every profile but read by
nothing.

## What this run does NOT demonstrate

The delay caused by the constraint has **no modeled clinical consequence**,
because no reviewed disease-trajectory model exists. 165 minutes passed and the
patient's physiology is unchanged. Contract §3.3 says a delayed operation *may*
change the trajectory because time passes — that half is governance-blocked and
is recorded as a `trajectory` simulator limitation on the log, not simulated.

## Transcript

```text
### PBC Real Hospital smoke — APP-004, KZ-R2-URBAN, CT scanner down
mode=real profile=KZ-R2-URBAN seed=PBC-REAL-2 start=2026-08-23T02:15:00+05:00
patientTruthApproved=false
[T0] Приёмный покой: Приёмный покой. Острый живот. Передача СМП: мужчина, 22 лет. Боль в правой подвздошной области около 11 часов. Т 37.5 °C, ЧСС 82/мин, ЧДД 21/мин, АД сист. 126 мм рт.ст.
[T0] governance events on log: 11; rendered to learner: 0

--- learner: «живот»
    Осмотр: Живот обычной формы, симметричный, не вздут, участвует в акте дыхания. при пальпации живот мягкий, умеренно болезненный в правой подвздошной области, максимальная болезненность соответствует заявленной локализации боли, непроизвольного защитного напряжения мышц нет. признаков раздражения брюшины нет, псоас-симптом положительный. перистальтика выслушивается, обычной звучности.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «анамнез»
    Пациент: Жалобы на боль в животе 11 часов назад, начало постепенно. усиливается при ходьбе, усиливается при разгибании правого бедра. тошноты и рвоты нет. Стул и мочеиспускание не нарушены. Аллергии не отмечает. Хронические заболевания и постоянный приём препаратов отрицает.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «КТ ОБП»
    Система: КТ сейчас недоступна: аппарат на ремонте, срок восстановления неизвестен.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=UNAVAILABLE_RESOURCE]

--- learner: «что с пациентом сейчас?»
    Система: Прошло 0 мин. Локация: приёмный покой. ЧСС 82/мин, АД сист. 126 мм рт.ст., ЧДД 21/мин, T 37.5 °C. Боль 5.4/10.
    [t=0м loc=emergency_department intent=REQUEST_CURRENT_STATUS outcomes=STATUS_SNAPSHOT]

--- learner: «УЗИ брюшной полости»
    Система: Назначено: УЗИ брюшной полости. Ожидаемое время результата — 90 мин.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «ОАК и СРБ»
    Система: Назначено: ОАК. Ожидаемое время результата — 75 мин.
    Система: Назначено: СРБ. Ожидаемое время результата — 75 мин.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED|EXECUTED]

--- learner: «переоценю боль и витальные через 2 часа»
    Рентгенолог: Предварительно: УЗИ брюшной полости: Аппендикс достоверно не визуализирован; выраженная пневматизация кишечника. Убедительных очаговых изменений в доступных отделах брюшной полости не выявлено. Заключение: исследование неинформативно в отношении аппендикса.
    Лаборатория/Диагностика: ОАК — wbc: 10.9, neutrophilPercent: 78
    Лаборатория/Диагностика: СРБ — crp: 68
    Лаборатория/Диагностика: УЗИ брюшной полости: Аппендикс достоверно не визуализирован; выраженная пневматизация кишечника. Убедительных очаговых изменений в доступных отделах брюшной полости не выявлено. Заключение: исследование неинформативно в отношении аппендикса.
    Переоценка: Переоценены: боль, витальные показатели — см. текущие показатели.
    [t=120м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «перевожу в другой стационар»
    Система: Организован перевод в другой стационар. Расчётное время в пути — 45 мин.
    Система: Пациент доставлен в принимающий стационар. Случай передан.
    [t=165м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]```

## Debrief highlights

```json
{
  "session": {
    "id": "smoke-PBC-REAL-2",
    "status": "complete",
    "endpoint": {
      "type": "PATIENT_TRANSFERRED",
      "atMinutes": 165,
      "detail": "other_facility"
    }
  },
  "caseSummary": {
    "totalCaseMinutes": 165,
    "endpointType": "PATIENT_TRANSFERRED",
    "hospitalMode": "real",
    "hospitalProfileId": "KZ-R2-URBAN",
    "operativeApproach": null,
    "sourceControlAchieved": false,
    "disposition": null
  },
  "resourceLimitations": [
    {
      "atMinutes": 0,
      "constraintId": "ct_scanner_down",
      "textRu": "КТ сейчас недоступна: аппарат на ремонте, срок восстановления неизвестен.",
      "noteRu": "Ограничение ресурса стационара. Не является ошибкой обучающегося."
    }
  ],
  "importantMisses": [],
  "contentGovernance": {
    "patientTruthApproved": false,
    "pilotReady": false,
    "noteRu": "Этот сценарий работает на клиническом контенте, который ещё не прошёл рецензирование (разработческая сборка). Он не предназначен для пилота с резидентами.",
    "withheldKinds": [
      "patient_truth",
      "trajectory"
    ]
  },
  "simulatorLimitationKinds": [
    "patient_truth",
    "trajectory"
  ]
}
```
