# ON QOL clinical decisions required

Status: open owner/reviewer queue. None of the rows below may be closed by a
code change alone. An approval must name the reviewer, reviewed source/version
and date; until then the related feature remains inactive or formative-only.

| ID | Какое решение нужно | Текущее поведение | Варианты | Источник | Блокирует runtime? | Блокирует scoring? | Reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CDR-01 | Подписать CRP/CBC/renal/perfusion trajectory по untreated time и после interventions | Повторные values ограничены авторским envelope; неподписанные эффекты не активируются | Таблица диапазонов по state/time; либо оставить static до evidence | WSES 2025 + primary trajectory review | Да, unstable/complication | Да | Хирург + реаниматолог |
| CDR-02 | Утвердить morphology priors и physiologic-reserve distribution | Текущие priors версионированы, но отмечены provisional | Подписать distributions; заменить; отключить randomized layer | WSES 2025 + local cohort evidence | Не для stable vertical slice | Да | Хирург + methodologist |
| CDR-03 | Определить shock/organ-dysfunction clusters и findings APP-005 | APP-005 и complication path faculty-preview only | Отдельный reviewed unstable package; либо сохранить inactive | WSES 2025 + sepsis primary guidance | Да, unstable path | Да | Хирург + ЭМ/ICU reviewer |
| CDR-04 | Подписать величину ответа на fluids, antibiotics, source control и delay | Движок не изобретает количественные эффекты; stable path использует ограниченную deterministic model | Reviewed curves; categorical effects; no activation | WSES 2025 + intervention evidence | Да, dynamic unstable path | Да | Хирург + ЭМ/ICU reviewer |
| CDR-05 | Утвердить observation sufficiency, ICU, reoperation, transfer и discharge criteria | Stable case доходит до discharge; неподписанные branches inactive | Пороги по state; reviewer-authored decision table | WSES 2025 + KZ local pathway | Да для unstable/complication | Да | Хирург + KZ reviewer |
| CDR-06 | Выбрать risk scores и cutoff tables | Риск-шкалы можно обсуждать, но не рассчитывать/оценивать | AIR/AAS/PAS с primary tables; либо без numeric tool | Primary validation studies | Нет | Да | Хирург + methodologist |
| CDR-07 | Утвердить KZ antimicrobial agents, doses и formulary scope | Только decision boundary; молекулы/дозы не скорятся | Национальный набор; institutional layer; keep non-numeric | КП МЗ РК + formulary | Нет для stable path | Да | KZ хирург + pharmacist |
| CDR-08 | Подписать canonical KZ resource profiles, blood products и transfer destination | Один versioned profile управляет runtime; assumptions отмечены provisional | Принять/изменить таблицу `KZ_RESOURCE_PROFILES_REVIEW.md` | Local operational review | Да для real mode release | Да | KZ local reviewer |
| CDR-09 | Авторизовать alternative hidden-truth packages | Восемь alternatives остаются inactive stubs; learner truth — appendicitis | Полные disease modules по одному; либо не заявлять differential-outcome pilot | Disease-specific primary sources | Да для external reasoning pilot | Да | Relevant specialty reviewers |
| CDR-10 | Подписать score weights, criticality и one-to-one evidence mapping | V3.5 только formative domains; numeric score `null` | Reviewed rubric + calibration; либо сохранить formative-only | Rubric review + pilot calibration | Нет | Да, полностью | Клиническая панель + methodologist |
| CDR-11 | Подписать RU learner copy и авторски заполнить 65 KK keys | RU технически complete; KK learner switch disabled | Independent RU review; полный KK authoring + medical language review | Clinical content + KZ terminology | Да для KK | Да для bilingual claims | RU/KK medical language reviewers |
| CDR-12 | Утвердить participant information, consent, retention и deletion wording | Raw persistence off; local structured retention 7 days; production gate closed | Принять policy; изменить retention; отказаться от central storage | Owner policy | Да для external pilot | Нет | Privacy owner |

