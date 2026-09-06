# PBC Reference Hospital smoke — APP-004

**Date:** 2026-08-25
**Contract:** ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22 (`26b5bb0d…d992dff3`)
**Mode:** Reference Hospital (`REFERENCE-FULL`) · **Seed:** `PBC-REF-2026-08-25` · **Start:** 2026-08-23T14:00+05:00
**Replay:** [`PBC_REFERENCE_SMOKE_2026-08-25.replay.json`](PBC_REFERENCE_SMOKE_2026-08-25.replay.json)

Produced through the same code path the application uses: `createSession` →
`submitLearnerTurn` → the renderers `src/app/session/useSession.js` calls. Every
line below is text a learner would actually read.

## Coverage of the task §10.1 checklist

| required step | observed | contract |
| --- | --- | --- |
| mode selection | `REFERENCE-FULL` resolved as a first-class mode | §3.1 |
| EMS handoff | «Приёмный покой. Острый живот. Передача СМП…» | §4 |
| history | full relevant bundle in one turn | §5.2 |
| abdomen exam | «осмотрю пациента» → clarify → «живот» → complete examination | §5.1 |
| current status | snapshot with vitals, pain, pending work; clock unmoved | §6 |
| multiple orders | «ОАК, СРБ и ОАМ» → three parallel orders | §8.1 |
| nurse clarification | «кетопрофен 100 мг» → route asked → «в/м» completes the order | §8.2 |
| time | internal clock; 0 → 700 min through authored actions only | §7.1 |
| automatic results | labs and CT surfaced during a wait, unprompted | §7.3 |
| reassessment | target clarified **before** any time passed, then honoured | §10 |
| CT report | full abdomen/pelvis; radiologist preliminary before formal | §9.1–9.2 |
| operative commitment | plan committed ≠ ready; mentor asks for the preparation | §16 |
| preop | IV access, consent, prophylaxis, anaesthesia review — all real actions | §16 |
| OR location | patient physically moved to theatre | §12 |
| level-B operative decision | one meaningful decision, negation-safe | §17.1 |
| postop destination | learner chose recovery, then ward | §19 |
| monitoring | «vitals каждые 4 часа» recorded alongside the disposition | §19 |
| discharge attempt | refused from the table, with the real reason | §24 |
| debrief | produced; see below | §25 |
| JSON export | full causal trail, replay-clean | §25 |

## What this run does NOT demonstrate

Treatment response, disease progression and clinical discharge readiness are
**governance-blocked**, not working. Ketoprofen was given and recorded; the
patient's pain did not move, because no reviewed `(drug, route)` response
envelope exists. Pain reads 4.9/10 at minute 0 and 4.9/10 at minute 180. That is
the honest state of the build, not a passing treatment loop.

## Transcript

```text
### PBC Reference Hospital smoke — APP-004
mode=reference profile=REFERENCE-FULL seed=PBC-REF-2026-08-25 start=2026-08-23T14:00:00+05:00
patientTruthApproved=false
[T0] Приёмный покой: Приёмный покой. Острый живот. Передача СМП: мужчина, 55 лет. Боль в правом боку около 8 часов. Т 38 °C, ЧСС 97/мин, ЧДД 19/мин, АД сист. 128 мм рт.ст.
[T0] governance events on log: 11; rendered to learner: 0

--- learner: «осмотрю пациента»
    Медсестра: Что именно осматриваешь?
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=CLARIFY]

--- learner: «живот»
    Осмотр: Живот обычной формы, симметричный, не вздут, участвует в акте дыхания. при пальпации живот мягкий, умеренно болезненный в правом боку, максимальная болезненность соответствует заявленной локализации боли, непроизвольного защитного напряжения мышц нет. признаков раздражения брюшины нет, псоас-симптом отрицательный. перистальтика выслушивается, обычной звучности.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «анамнез»
    Пациент: Жалобы на боль в животе 8 часов назад, начало постепенно. усиливается при ходьбе, усиливается при разгибании правого бедра. тошноты и рвоты нет. Стул и мочеиспускание не нарушены. Аллергии не отмечает. Хронические заболевания и постоянный приём препаратов отрицает.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «что с пациентом сейчас?»
    Система: Прошло 0 мин. Локация: приёмный покой. ЧСС 97/мин, АД сист. 128 мм рт.ст., ЧДД 19/мин, T 38 °C. Боль 4.9/10.
    [t=0м loc=emergency_department intent=REQUEST_CURRENT_STATUS outcomes=STATUS_SNAPSHOT]

--- learner: «ОАК, СРБ и ОАМ»
    Система: Назначено: ОАК. Ожидаемое время результата — 70 мин.
    Система: Назначено: СРБ. Ожидаемое время результата — 70 мин.
    Система: Назначено: ОАМ. Ожидаемое время результата — 60 мин.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED|EXECUTED|EXECUTED]

--- learner: «КТ ОБП»
    Система: Назначено: КТ органов брюшной полости и малого таза. Ожидаемое время результата — 130 мин.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «кетопрофен 100 мг»
    Медсестра: Уточните путь введения.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=CLARIFY]

--- learner: «в/м»
    Медсестра: Введено: кетопрофен, 100 мг, внутримышечно.
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «переоценю через 3 часа»
    Медсестра: Что именно переоцениваешь?
    [t=0м loc=emergency_department intent=CLINICAL_ACTION outcomes=CLARIFY]

--- learner: «боль и витальные»
    Лаборатория/Диагностика: ОАМ: В общем анализе мочи единичные лейкоциты; нитриты отрицательные, бактериурии нет.
    Лаборатория/Диагностика: ОАК — wbc: 11.7, neutrophilPercent: 76
    Лаборатория/Диагностика: СРБ — crp: 59
    Рентгенолог: Предварительно: КТ органов брюшной полости и малого таза: Предварительно по телефону: картина острого аппендицита, отросток расположен ретроцекально; признаков перфорации и абсцесса не вижу. Формальное заключение будет позже.
    Лаборатория/Диагностика: КТ органов брюшной полости и малого таза с в/в контрастированием. Печень обычных размеров и структуры, очаговых образований не выявлено. Желчный пузырь без признаков острого воспаления, стенка не утолщена, конкрементов не выявлено. Поджелудочная железа обычной формы, парапанкреатическая клетчатка не инфильтрирована. Селезёнка не увеличена, структура однородная. Почки расположены обычно, чашечно-лоханочные системы не расширены, конкрементов и обструкции не выявлено. Петли тонкой и толстой кишки не расширены, признаков непроходимости и утолщения стенок не выявлено. Свободного газа в брюшной полости не выявлено. Органы малого таза без признаков острой патологии. Червеобразный отросток расположен ретроцекально, увеличен, стенка утолщена, накапливает контраст; окружающая жировая клетчатка инфильтрирована. Признаков перфорации, абсцесса и свободного газа не выявлено. Определяется небольшое количество свободной жидкости в малом тазу. Заключение: КТ-картина острого аппендицита при ретроцекальном расположении отростка. Другой острой патологии не выявлено.
    Переоценка: Переоценены: боль, витальные показатели — см. текущие показатели.
    [t=180м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «как сейчас боль?»
    Система: Прошло 180 мин. Локация: приёмный покой. ЧСС 97/мин, АД сист. 128 мм рт.ст., ЧДД 19/мин, T 38 °C. Боль 4.9/10.
    [t=180м loc=emergency_department intent=REQUEST_CURRENT_STATUS outcomes=STATUS_SNAPSHOT]

--- learner: «на операцию»
    Система: Решение зафиксировано: оперативная тактика.
    Наставник: Что нужно сделать до операции?
    [t=180м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «венозный доступ, согласие, антибиотикопрофилактика цефазолин 2 г в/в»
    Медсестра: Выполнено: функционирующий периферический венозный доступ.
    Пациент: Согласие на операцию подписано.
    Медсестра: Введено: цефазолин, 2 г, внутривенно.
    Медсестра: Выполнено: антибиотикопрофилактика до разреза.
    [t=180м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED|EXECUTED|EXECUTED]

--- learner: «осмотр анестезиолога»
    Диспетчер: Анестезиолог вызван(а), ожидаемое время — 20 мин.
    [t=180м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «переоценю витальные через 40 минут»
    Анестезиолог: Я на месте. Что уже сделано?
    Медсестра: Выполнено: осмотр анестезиолога.
    Анестезиолог: Уточнил у пациента сам: последний приём пищи — 6 часов назад, воды — 2 часов назад.
    Переоценка: Переоценены: витальные показатели — см. текущие показатели.
    [t=220м loc=emergency_department intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «иду на лапароскопическую аппендэктомию»
    Медсестра: Группа крови и резус-фактор не была назначена — оформляю по порядку отделения.
    Медсестра: Выполнено: группа крови и резус-фактор.
    Медсестра: Коагулограмма не была назначена — оформляю по порядку отделения.
    Медсестра: Выполнено: коагулограмма.
    Операционная: Операция начата, доступ — лапароскопический.
    Система: Пациент переведён: операционная.
    Операционная: Доступ выполнен, камера введена в брюшную полость. Червеобразный отросток расположен ретроцекально, воспалительно изменён; перфорации и гангренозных изменений не видно. Другой явной острой патологии в осмотренных отделах не выявлено. Что делаешь?
    [t=220м loc=operating_room intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «выписываю»
    Медсестра: Выписать сейчас нельзя: запланированная операция ещё не выполнена; пациент ещё не переведён из операционной/палаты пробуждения. Что делаешь дальше?
    [t=220м loc=operating_room intent=CLINICAL_ACTION outcomes=DISCHARGE_NOT_READY]

--- learner: «удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю»
    Операционная: Принято: удалю аппендикс, аспирирую жидкость.
    Операционная: Источник санирован.
    Операционная: Макропрепарат направлен на гистологическое исследование.
    Операционная: Гемостаз состоятельный, явных повреждений соседних органов не выявлено, другой острой патологии не выявлено. Операция завершена. Куда переводим пациента?
    [t=220м loc=operating_room intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «в палату пробуждения»
    Система: Пациент переведён: палата пробуждения.
    [t=220м loc=recovery intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «в хирургическое отделение, vitals каждые 4 часа»
    Система: Пациент переведён: хирургическое отделение.
    Медсестра: Наблюдение назначено: vitals.
    [t=220м loc=surgical_ward intent=CLINICAL_ACTION outcomes=EXECUTED|EXECUTED]

--- learner: «переоценю боль и витальные утром»
    Переоценка: Переоценены: боль, витальные показатели — см. текущие показатели.
    [t=700м loc=surgical_ward intent=CLINICAL_ACTION outcomes=EXECUTED]

--- learner: «выписываю»
    Система: Пациент выписан.
    Система: Выписные рекомендации: Контроль у хирурга по месту жительства. Результат гистологического исследования — по месту жительства. Немедленно обратиться при: усиление боли в животе; лихорадка; повторная рвота или невозможность пить; покраснение, отделяемое или расхождение краёв раны; отсутствие стула и газов с нарастающим вздутием.
    [t=700м loc=surgical_ward intent=CLINICAL_ACTION outcomes=EXECUTED]```

## Debrief highlights

```json
{
  "session": {
    "id": "smoke-PBC-REF-2026-08-25",
    "status": "complete",
    "endpoint": {
      "type": "PATIENT_DISCHARGED",
      "atMinutes": 700,
      "detail": null
    }
  },
  "caseSummary": {
    "totalCaseMinutes": 700,
    "endpointType": "PATIENT_DISCHARGED",
    "hospitalMode": "reference",
    "hospitalProfileId": "REFERENCE-FULL",
    "operativeApproach": "laparoscopic",
    "sourceControlAchieved": true,
    "disposition": "surgical_ward"
  },
  "contentGovernance": {
    "patientTruthApproved": false,
    "pilotReady": false,
    "noteRu": "Этот сценарий работает на клиническом контенте, который ещё не прошёл рецензирование (разработческая сборка). Он не предназначен для пилота с резидентами.",
    "withheldKinds": [
      "patient_truth",
      "trajectory",
      "discharge_criterion"
    ]
  },
  "referenceComparison": {
    "available": false,
    "noteRu": "Сравнение с эталонным маршрутом не приводится: ни одно клиническое правило в текущем контенте не имеет статуса approved_for_training. Это ограничение симулятора, а не оценка твоих решений."
  },
  "importantMisses": [],
  "simulatorLimitationKinds": [
    "discharge_criterion",
    "patient_truth",
    "trajectory"
  ],
  "simulatorLimitationCount": 18,
  "learningObjectives": [
    "Формулировать рабочую гипотезу и опасные альтернативы явно, до принятия решения об операции."
  ]
}
```
