# Wave B — fluids_01 live-provider sessions (reviewed summary)

Four live sessions (L1–L4) against the real providers (interpreter: semantic-first, gpt-5-mini; mentor: grounded draft + independent verifier), flags `STATEFUL_GROUNDED_MENTOR_V1` and `FLUIDS_VERTICAL_SLICE_V1` ON. The learner is the author acting in three styles; no resident data. Raw records (drafts, verifier verdicts, cards offered, provider journals) stay in gitignored `private/wave-b-live/`; this file is the reviewed summary. No chain-of-thought exists in these records (schema-constrained JSON only).

L4 was run after the last mentor changes (intent passed to draft/verifier, echo policy, `grounded_min_scaffold: 3`); L1 was run before several interpreter fixes, L2/L3 partially before, so early turns show defects that are since fixed (marked *[fixed later]*).


## L1 — concise, systematic, strong (14 turns)

| # | Resident said | Interpreted actions | World / patient | Mentor (issue, scaffold) → visible | Grounded |
|---|---|---|---|---|---|
| 1 | измеряю давление и пульс | REASSESS(targets=['blood_pressure']) | Измерено: АД сист. 104 мм рт.ст., АД диаст. 62 мм рт.ст. *(notice: unrecognised part)* | silent | — |
| 2 | оцениваю перфузию, вены шеи и лёгкие | REASSESS(targets=['perfusion', 'neck_veins', 'cardiorespiratory']) | Кожа конечностей прохладная, бледная, слизистые сухие. Вены шеи плоские лёжа. Тоны сердца ритмичные, S3 нет, дыхание везикулярное, хрипов нет. Измерено: CRT 3 с. | silent | — |
| 3 | проверю диурез | REASSESS(targets=['urine_output']) | Измерено: диурез 15 мл/ч. | silent | — |
| 4 | беру ОАК, лактат, креатинин, электролиты и КЩС | ORDER_TEST(), ORDER_TEST(), ORDER_TEST(), ORDER_TEST() | Назначено: ОАК. Ожидаемое время результата — 20 мин. Назначено: лактат. Ожидаемое время результата — 20 мин. Назначено: БХАК. Ожидаемое время результата — 20 мин. Назначено: КЩС. Ожидаемое время результата — 20 мин. | silent | — |
| 5 | вводим болюс 500 мл стерофундина за 15 минут, потом сразу переоценю давление, пульс и диурез | ORDER_INFUSION(fluidId=sterofundin,volumeMl=500,bolus=True) | Инфузия начата: Стерофундин 500 мл за 15 мин. *(notice: unrecognised part)* | silent | — |
| 6 | переоцениваю давление, пульс, диурез и перфузию | REASSESS(targets=['blood_pressure']) | Измерено: АД сист. 113 мм рт.ст., АД диаст. 68 мм рт.ст. *(notice: unrecognised part)* | silent | — |
| 7 | смотрю результаты анализов | — |  *(notice: unrecognised part)* | silent | — |
| 8 | ещё болюс 500 мл рингер-лактата | ORDER_INFUSION(fluidId=ringers_lactate,volumeMl=500,bolus=True) | Инфузия начата: Рингер-лактат 500 мл болюсно. | silent | — |
| 9 | переоцениваю давление, пульс, диурез и перфузию | REASSESS(targets=['blood_pressure', 'heart_rate', 'urine_output', 'perfusion', 'vitals']) | ОАК: Hb 126 г/л (до операции 128 г/л) лактат: 2,6 ммоль/л БХАК — креатинин 118 мкмоль/л (исходно 82 мкмоль/л); Na 138, K 3,6, Cl 110 ммоль/л. КЩС: pH 7,32, pCO₂ 36 мм рт. ст., HCO₃⁻ 18 ммоль/л, BE −7 ммоль/л Кожа конечностей прохладная, бледная, слизистые сухи | silent | — |
| 10 | жду результаты анализов | WAIT | Уточните, пожалуйста. | silent | — |
| 11 | оцениваю лёгкие и вены шеи | EXAMINE(region=cardiorespiratory), EXAMINE(region=neck_veins) | Тоны сердца ритмичные, S3 нет, дыхание везикулярное, хрипов нет. Вены шеи плоские лёжа. | silent | — |
| 12 | ещё раз проверю давление и пульс | REASSESS(targets=['blood_pressure', 'heart_rate']) | Измерено: ЧСС 96/мин, АД сист. 122 мм рт.ст., АД диаст. 74 мм рт.ст. | silent | — |
| 13 | назначаю мониторинг давления, пульса и диуреза каждые 30 минут | — |  *(notice: unrecognised part)* | silent | — |
| 14 | завершить кейс | END_CASE |  | silent | — |

## L2 — uncertain, colloquial, frequently stuck; starts with a diuretic (10 turns)

| # | Resident said | Interpreted actions | World / patient | Mentor (issue, scaffold) → visible | Grounded |
|---|---|---|---|---|---|
| 1 | измеряю давление и пульс | REASSESS(targets=['blood_pressure', 'heart_rate']) | Измерено: ЧСС 112/мин, АД сист. 104 мм рт.ст., АД диаст. 62 мм рт.ст. | silent | — |
| 2 | мочи мало, поэтому даю фуросемид 40 мг в/в | ORDER_MEDICATION(drugId=furosemide,doseMg=40) | Введено: фуросемид, 40 мг, внутривенно. *(notice: unrecognised part)* | fluids.diuretic_before_volume, s1 → «Ты назначил диуретик. Что малый диурез говорит тебе о перфузии, прежде чем выбирать лечение?» | fallback, regen 1, offered 3 cards, cited 0 |
| 3 | не знаю, мочи же мало | ASK_PATIENT() | Это назначение пока не поддерживается текущей версией симуляции. Выбери другое назначение. *(notice: unrecognised part)* | fluids.diuretic_before_volume, s2 → «Подумай отдельно о катетере, перфузии и объёме.» | fallback, regen 1, offered 3 cards, cited 0 |
| 4 | проверяю катетер и оцениваю перфузию | EXAMINE(region=catheter), REASSESS(targets=['perfusion']) | Дренаж — отделяемое серозное; мочевой катетер проходим (промывание свободное). Кожа конечностей прохладная, бледная, слизистые сухие. Измерено: CRT 3 с. | silent | — |
| 5 | тогда давай физраствор 500 мл быстро | — |  *(notice: unrecognised part)* | silent | — |
| 6 | физраствор 500 мл струйно | ORDER_INFUSION(fluidId=normal_saline) | Какой объём? За какое время или болюсом? *(notice: unrecognised part)* | silent | — |
| 7 | физраствор 500 мл струйно | ORDER_INFUSION(fluidId=normal_saline,volumeMl=500,bolus=True) | Инфузия начата: 0,9% NaCl 500 мл болюсно. | fluids.reassessment_plan, s1 → «Как ты поймёшь, что болюс подействовал?» | fallback, regen 1, offered 4 cards, cited 0 |
| 8 | не знаю | — |  *(notice: unrecognised part)* | fluids.reassessment_plan, s2 → «Подумай отдельно о том, что ты измеришь, что осмотришь и через какое время посмотришь снова.» | fallback, regen 1, offered 4 cards, cited 0 |
| 9 | переоцениваю давление, пульс и диурез | REASSESS(targets=['blood_pressure', 'heart_rate', 'urine_output']) | Измерено: ЧСС 114/мин, АД сист. 101 мм рт.ст., АД диаст. 60 мм рт.ст., диурез 80 мл/ч. | silent | — |
| 10 | завершить кейс | END_CASE |  | silent | — |

## L3 — conversational, mixed language, adaptive; overdoses then corrects (13 turns)

| # | Resident said | Interpreted actions | World / patient | Mentor (issue, scaffold) → visible | Grounded |
|---|---|---|---|---|---|
| 1 | Смотрю пациента: измеряю давление, пульс и сатурацию, осматриваю периферию и катетер | REASSESS(targets=['blood_pressure', 'heart_rate', 'spo2']), EXAMINE(region=perfusion) | Измерено: ЧСС 112/мин, АД сист. 104 мм рт.ст., АД диаст. 62 мм рт.ст., SpO₂ 96%. Кожа конечностей прохладная, бледная, слизистые сухие. CRT 3 с. *(notice: unrecognised part)* | silent | — |
| 2 | Похоже гиповолемия, вливаю болюс рингер лактата 500 мл струйно | ORDER_INFUSION(fluidId=ringers_lactate,volumeMl=500,bolus=True) | Инфузия начата: Рингер-лактат 500 мл болюсно. *(notice: unrecognised part)* | fluids.reassessment_plan, s1 → «Как ты поймёшь, что болюс подействовал?» | fallback, regen 1, offered 4 cards, cited 0 |
| 3 | жду 15 минут и переоцениваю давление, пульс, диурез | WAIT(afterMinutes=15), REASSESS(targets=['blood_pressure', 'heart_rate', 'urine_output']) | Измерено: ЧСС 104/мин, АД сист. 113 мм рт.ст., АД диаст. 68 мм рт.ст., диурез 35 мл/ч. | silent | — |
| 4 | давление ещё низковато, лью ещё болюс рингера 1000 мл | — |  *(notice: unrecognised part)* | silent | — |
| 5 | и ещё 1000 мл рингера струйно, потом подожду 20 минут | — |  *(notice: unrecognised part)* | silent | — |
| 6 | оцениваю лёгкие и шейные вены, смотрю сатурацию и ЧДД | — |  *(notice: unrecognised part)* | silent | — |
| 7 | лью ещё болюс рингер-лактата 1000 мл струйно | ORDER_INFUSION(fluidId=ringers_lactate,volumeMl=1000,bolus=True) | Инфузия начата: Рингер-лактат 1000 мл болюсно. | silent | — |
| 8 | ещё 1000 мл рингер-лактата болюсом | ORDER_INFUSION(fluidId=ringers_lactate,volumeMl=1000,bolus=True) | Инфузия начата: Рингер-лактат 1000 мл болюсно. | silent | — |
| 9 | аускультирую лёгкие и осматриваю шейные вены, измеряю сатурацию | EXAMINE(region=cardiorespiratory), EXAMINE(region=neck_veins), REASSESS(targets=['spo2', 'neck_veins', 'cardiorespiratory']) | Пациенту хуже: стало тяжелее дышать, дыхание частое. Тоны сердца ритмичные, S3 нет, дыхание везикулярное, в нижних отделах влажные хрипы. Вены шеи плоские лёжа. Вены шеи плоские лёжа. Тоны сердца ритмичные, S3 нет, дыхание везикулярное, в нижних отделах влажны | silent | — |
| 10 | так, это перегрузка объёмом, останавливаю инфузию | — |  *(notice: unrecognised part)* | silent | — |
| 11 | назначаю фуросемид 40 мг в/в и кислород, зову старшего | ORDER_MEDICATION(drugId=furosemide,doseMg=40), ORDER_MEDICATION(doseMg=40), CALL_STAFF(role=surgeon) | Введено: фуросемид, 40 мг, внутривенно. Уточните препарат. Хирург вызван(а), ожидаемое время — 20 мин. | silent | — |
| 12 | через 15 минут переоцениваю сатурацию, ЧДД и диурез | — |  *(notice: unrecognised part)* | silent | — |
| 13 | завершить кейс | END_CASE |  | silent | — |

## L4 — colloquial average resident; measurement follow-up (6 turns)

| # | Resident said | Interpreted actions | World / patient | Mentor (issue, scaffold) → visible | Grounded |
|---|---|---|---|---|---|
| 1 | измеряю давление и пульс | REASSESS(targets=['blood_pressure', 'heart_rate']) | Измерено: ЧСС 112/мин, АД сист. 104 мм рт.ст., АД диаст. 62 мм рт.ст. | silent | — |
| 2 | мочи мало, даю фуросемид 40 мг в/в | ORDER_MEDICATION(drugId=furosemide,doseMg=40) | Введено: фуросемид, 40 мг, внутривенно. *(notice: unrecognised part)* | fluids.diuretic_before_volume, s1 → «Ты назначил диуретик. Что малый диурез говорит тебе о перфузии, прежде чем выбирать лечение?» | fallback, regen 1, offered 3 cards, cited 0 |
| 3 | не знаю, а что делать? | — |  *(notice: unrecognised part)* | fluids.diuretic_before_volume, s2 → «Подумай отдельно о катетере, перфузии и объёме.» | fallback, regen 1, offered 3 cards, cited 0 |
| 4 | не знаю | — |  *(notice: unrecognised part)* | fluids.diuretic_before_volume, s3 → «Варианты: сначала проверить катетер и оценить перфузию, сразу дать диуретик, или сначала взять анализы. Что ты выберешь и почему?» | fallback, regen 1, offered 3 cards, cited 0 |
| 5 | не знаю, подскажи | — |  *(notice: unrecognised part)* | fluids.diuretic_before_volume, s4 → «Олигурия — не показание сразу давать фуросемид; диуретик, назначенный до оценки или коррекции подозреваемой гиповолемии, — критическая ошибка кейса. Как ты изменишь план?» | fallback, regen 1, offered 3 cards, cited 0 |
| 6 | завершить кейс | END_CASE |  | silent | — |

## Aggregate

- Turns: 43; mentor spoke on 9, silent on 34.
- Grounded LLM attempts (draft+verifier): 9; accepted 0; safe deterministic fallback 9. Deterministic-by-policy (scaffold < 3, L4): 0.
