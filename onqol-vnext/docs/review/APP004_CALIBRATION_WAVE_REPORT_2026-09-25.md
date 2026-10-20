# APP-004 Clinical Simulation Calibration v1 — wave report

**2026-09-25. Status: `READY_FOR_HUMAN_CLINICAL_CALIBRATION_REVIEW`.** Это статус пакета вопросов, **не** клиническое одобрение, подтверждение надёжности или готовность к пилоту с ординаторами. Новые численные клинические эффекты, осложнения и вероятность не активированы. Живых вызовов внешнего провайдера/платных API не было.

## Результат и предел доказательств

- Проверены актуальные North Star, Core Runtime, Clinical Governance, Mentor, Specs README, V2 variability/calibration документы; актуальные APP-004 disease/phenotypes/trajectories/findings/rules/operative/complications YAML, общий формуляр, генератор, выполнение действий, время, выписка, replay и прежние клинические решения. Исходный стабильный фенотип ограничен взрослым 18–58 лет без беременности, крупных сопутствующих заболеваний и осложнённого аппендицита.
- Из существующего корпуса: `SRC-WSES-2025`, `SRC-WSES-2020`, `SRC-KZ-ANESTH-2023`, старые APP004 clinical/numeric/second-review таблицы и отозванные варианты. Дополнены полные обзорные записи [WSES 2025/опубликовано 2026](https://doi.org/10.1001/jamasurg.2025.6218), [ESRA PROSPECT 2024](https://esraeurope.org/prospect/procedures/appendicectomy-2022/summary-recommendations-31/), [ASA postanesthetic care](https://www.asahq.org/~/media/sites/asahq/files/public/resources/standards-guidelines/practice-guidelines-for-postanesthetic-care.pdf), [ERAS Society 2022](https://doi.org/10.1007/s00268-022-06587-w) и [МЗ РК/Әділет 2023](https://old.adilet.zan.kz/rus/docs/V2300032409). Роль, популяция и ограничение переноса каждого источника записаны в матрице и JSON.
- 28 draft решений: **A 0, B 3, C 18, D 7**. `A=0` обоснован: ни один проверенный источник не даёт переносимой на конкретный APP-004 пациент численной величины и времени response. Нет придуманного delta, порога, onset, incidence или вероятности. Все 28 имеют хирурга в составе reviewer; 21 также требуют анестезиолога (включая некоторые совместные решения с фармацией). Точный список указан в `ANESTHESIOLOGY REVIEW REQUIRED` пакета.
- D (пока не моделировать): `002` автоматический дрейф HR/BP/RR; `005` почасовой CBC/CRP; `009` неразрешённый ketoprofen IV; `010` pending ketorolac IV/IM; `013` универсальное улучшение АД после инфузии; `024` рутинный POD1 CBC/chemistry; `025` численный postop-эффект профилактического антибиотика. Кандидаты осложнений `027` SSI и `028` значимая PONV остаются C, без активации и incidence.

## Текущий клинический контент, который не изменён

`TRJ-STABLE` — утверждённая качественная стабильность без переходов, а не доказательство неизменности реального аппендицита. Шесть лекарственных и одна инфузионная `response_envelope` остаются `pending/null`. Послеоперационные qualitative milestones и их существующие времена/варианты не менялись. В `complications.yaml` активный список осложнений пуст. Сами функциональные критерии выписки имеют recorded approval, но у большинства `runtime_evaluation: unavailable_without_recovery_calibration`; старый обзорный файл 2026-08-25 ошибочно/устаревше называет все эти критерии pending. Это разночтение явно отражено в аудите. KZ стандарт задаёт организационную границу и не создаёт биологические параметры; старый KZ протокол не использован для переопределения WSES Reference Hospital пути.

## Inertness и технические изменения

Новое `src/content/diseases/appendicitis/review/calibration-proposals-v1.json` находится рядом с контентом, но **за пределами** семи файлов, компилируемых в `appendicitis.json`, и не входит в `__contentVersion`. `scripts/buildContentIndex.mjs` читает его только для fail-closed validation при `content:check/build`. `src/content/review/validateCalibrationProposals.js` требует draft/none, уникальный ID, источник с полной обзорной provenance, пустое решение рецензента, корректные единицы/диапазоны/границы и запрещает числа без класса A и локатора доказательства. Проверка подтверждает 28 проектов и неизменный хеш клинического bundle. Все новые параметры остаются невыбираемыми runtime; `approved_for_training` нигде не установлен.

## Replay audit (A/B)

Текущий restore **не обращается к semantic provider**: он перебирает сохранённые `LEARNER_TURN_RECEIVED`, передаёт сохранённый `recordedInterpretation` в `submitLearnerTurn` и сравнивает весь причинный log. Для прежних **детерминированных** turn этот field мог отсутствовать; тогда текущий deterministic parser всё же повторно разбирал исторический текст. Это вариант **B только для legacy deterministic**, потенциально зависимый от версии словаря. Он fail-closed на изменившемся clinical log, но прежняя сессия может стать невосстанавливаемой.

Минимальное исправление сделано и проверено: **все новые turn, включая deterministic, сохраняют полную структурированную интерпретацию**. Replay новой сессии — A: использует её, не перечитывает смысл текста, затем строго сверяет события. Старые deterministic артефакты без поля допускаются только если повторный разбор воспроизвёл идентичный log; добавление поля отмечается `additive_recorded_interpretation`. Старые pre-V2 артефакты с одной лишь добавленной calibration-audit metadata сохраняют прежнюю строгую проверку. Никакие старые файлы не переписаны. При изменении clinical engine/content версий resume по-прежнему отказывает; исторический экспорт сохраняется как свидетельство.

## Проверки

- `npm run verify`: `content:check`, `governance:check` (469 файлов, 0 нарушений), **799/799** тестов, 52 офлайн fixture-кейса Wave 2, lint, production build — успешно. Сгенерированный Wave 2 metrics файл возвращён к исходному содержимому, так как эта волна его не меняла.
- Целевые тесты: draft/inert selection, provenance/уникальность, плохой статус, числовой диапазон/единицы/min-max, неизменный compiled content hash/пустые active complications/null envelopes, восстановление новых и старых turn и отказ при изменённом историческом log — успешно.
- Локальные browser E2E: основной APP-004 **4/4**, Flexible V2 **2/2** с fixture/mocks. Первый запуск browser suite был заблокирован sandbox на localhost (`EPERM`); повторный локальный запуск с разрешённым bind прошёл. Внешнего provider вызова не было.

## Файлы этой волны

- `docs/review/APP004_CLINICAL_CALIBRATION_AUDIT_2026-09-25.md`
- `docs/review/APP004_CALIBRATION_EVIDENCE_MATRIX_v1_2026-09-25.md`
- `docs/review/APP004_CLINICAL_CALIBRATION_REVIEW_PACK_v1_2026-09-25.md`
- `docs/review/APP004_CALIBRATION_WAVE_REPORT_2026-09-25.md`
- `src/content/diseases/appendicitis/review/calibration-proposals-v1.json`
- `src/content/review/validateCalibrationProposals.js`, `.test.js`
- узкое подключение проверки в `scripts/buildContentIndex.mjs`
- replay metadata/совместимость: `src/core/session/submitLearnerTurn.js`, `src/app/session/sessionPersistence.js`, `.test.js`, `src/app/session/flexibleGovernedJourney.test.js`

Рабочее дерево содержит ранее существовавшие незакоммиченные V2-изменения, которые сохранены. Коммита, push, deploy, изменения статуса clinical approval или resident-pilot запуска нет. Следующий шаг — независимые решения хирурга, анестезиолога и фармации по карточкам; только затем отдельная волна активации и клинической валидации.
