# ON QOL: дозовые правила после клинического ревью и сверки с КНФ РК

**Версия:** 0.2  
**Дата:** 20.08.2026  
**Основа:** `DOSING_RULES_DRAFT_v0.1.md`  
**Статус:** `CLINICALLY_REVIEWED_DRAFT`; исключение — три строки пилотной
антибиотикопрофилактики, перечисленные ниже, внесены в runtime после второй
записанной подписи 20.08.2026.
**Назначение:** полный пакет остаётся draft. Только явно перечисленный
трёхстрочный subset разрешён как teaching-only; остальные high-risk rules ждут
независимого второго клинического ревью.

### Подписанный runtime subset

`dosing.cefazolin.prophylaxis`, `dosing.metronidazole.prophylaxis` и
`dosing.appendectomy.prophylaxis` записаны в `DOSING_RULE_REGISTRY` с двумя
reviewer: Сарина Т.Т. (independent clinical review) и Каукенова Б.Н., MD (local
applicability), дата 20.08.2026. У них `allowed_runtime_effects` ограничен
`mentor_teaching`, `score_weight: 0`; weight branch и redosing не включены.
Расхождение КНФ сохраняется, а локальная доза резидента не может называться
ошибкой. Это не распространяет approval на остальные строки этого документа и
не заменяет pilot-wide clinical manifest sign-off.

## 1. Решение по КНФ РК

КНФ не должен автоматически заменять международный evidence-based reference rule. Для ON QOL нужно хранить отдельно:

- `reference_rule`: правило из международного клинического источника;
- `knf_status`: совпадение с КНФ РК;
- `knf_rule`: формулировка или доза КНФ, если она отличается;
- `jurisdiction_decision`: какое правило используется в KZ-facing runtime;
- `local_site_override`: локальный формуляр/SOP конкретного стационара, если применимо.

Статусы:

- `КНФ+`: дозировка, путь и ключевые условия совпадают достаточно для данного rule;
- `КНФ±`: препарат есть в КНФ, но дозировка, путь, показание, тайминг или логика применения отличаются либо КНФ не содержит именно эту схему;
- `КНФ-`: препарат отсутствует в КНФ;
- `BLOCKED`: правило пока нельзя использовать как authoritative teaching/runtime rule.

Для всех high-risk правил сохраняется `score_weight: 0` до независимого второго клинического ревью.

---

## 2. Периоперационная антибиотикопрофилактика

### `dosing.cefazolin.prophylaxis`

**Reference rule:** цефазолин 2 г в/в, 3 г при массе >=120 кг, начало в пределах 60 минут до разреза. Интраоперационное повторное введение: каждые 4 часа при продолжающейся операции или раньше при значимой кровопотере по соответствующему protocol logic.

**КНФ РК:** `КНФ±`.

КНФ дает другую схему: 1 г за 30-60 минут до операции; при операции длительностью 2 часа и более дополнительно 0,5-1 г во время операции; далее 0,5-1 г каждые 6-8 часов до 24 часов после операции.

**Runtime decision:**

- reference/full-resource path: использовать современную хирургическую prophylaxis-схему 2 г / 3 г >=120 кг и redosing q4h;
- KZ-local path: не подменять автоматически reference rule схемой КНФ;
- до утверждения KZ jurisdiction decision показывать расхождение только в educator/debrief layer, не как автоматическую коррекцию резидента.

**Источник reference:** ASHP/SIS/SHEA/IDSA Surgical Prophylaxis Guideline, 2013. На 20.08.2026 новая совместная версия еще находится в разработке.  
https://www.idsociety.org/practice-guideline/antimicrobial-prophylaxis-in-surgery/  
https://www.idsociety.org/globalassets/idsa/practice-guidelines/clinical-practice-guidelines-for-antimicrobial-prophylaxis-in-surgery.pdf

**КНФ:**  
https://knf.kz/ru/content/monograph?id=405

### `dosing.appendectomy.prophylaxis`

**Reference rule:** при неосложненном аппендиците перед аппендэктомией допустимы однократные схемы:

- cefoxitin; или
- cefotetan; или
- cefazolin + metronidazole.

Цефазолин без анаэробного покрытия не считать достаточной стандартной схемой для uncomplicated appendectomy.

**КНФ РК:** `КНФ±`.

**Runtime decision:** для пилотного appendicitis-модуля использовать `cefazolin + metronidazole` как одну из reference-схем, если именно эта комбинация внесена в case/resource formulary. Послеоперационные антибиотики при неосложненном аппендиците не продолжать автоматически.

### `dosing.metronidazole.prophylaxis`

**Reference rule:** метронидазол 500 мг в/в в составе комбинированной prophylaxis-схемы.

**КНФ РК:** `КНФ±`.

КНФ подтверждает применение метронидазола для анаэробных инфекций и профилактики анаэробной инфекции при хирургических вмешательствах, включая операции на органах брюшной полости, и содержит 500 мг каждые 8 часов для ряда в/в режимов. Отдельная взрослая single-dose pre-incision схема, полностью совпадающая с ASHP rule, в текущей монографии не сформулирована как самостоятельное правило.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=445

---

## 3. Эмпирическая терапия осложненных интраабдоминальных инфекций

**Общее правило:** эти дозы нельзя применять как универсальный список для любого "перитонита/перфорации". Выбор схемы должен зависеть минимум от источника инфекции, тяжести, риска резистентных возбудителей, функции почек, предшествующей антибиотикотерапии и локальной резистентности.

### `dosing.amoxclav.iai`

**Reference rule:** amoxicillin/clavulanate 2,2 г каждые 6-8 часов +/- gentamicin 5-7 мг/кг каждые 24 часа в тех WSES pathways, где эта схема указана.

**КНФ РК:** `КНФ±`.

Амоксициллин/клавулановая кислота присутствует в КНФ (J01CR02), но точный в/в режим 2,2 г q6-8h и его доступность как текущей KZ-local formulation не подтверждены этой сверкой как идентичное правило.

**Runtime decision:** оставить WSES regimen только как pathway-specific reference rule. Не использовать КНФ как источник этой конкретной дозы без отдельной проверки актуальной зарегистрированной парентеральной формы и локального формуляра.

**КНФ:**  
https://knf.kz/ru/content/alphabet?id=%D0%90&lang=ru

### `dosing.gentamicin.iai`

**Reference rule:** 5-7 мг/кг каждые 24 часа только в тех WSES pathways, где аминогликозид действительно является частью выбранной эмпирической схемы.

**КНФ РК:** `КНФ±`.

КНФ содержит гентамицин и отдельные safety warnings, но не должен использоваться для автоматического подтверждения универсальной IAI-схемы 5-7 мг/кг q24h. Доза требует учета функции почек, гидратации, риска нефро- и ототоксичности и локального протокола therapeutic drug monitoring, если он применяется.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=433

### `dosing.ceftriaxone-metro.iai`

**Reference rule:** ceftriaxone 2 г q24h + metronidazole 500 мг q8h в соответствующих WSES pathways.

**КНФ РК:** `КНФ±`.

КНФ подтверждает наличие цефтриаксона, абдоминальные инфекции как показание и дозу 1-2 г для предоперационной профилактики, но не оформляет `2 г q24h + metronidazole 500 мг q8h` как идентичную взрослую IAI-combination rule.

**Runtime decision:** reference rule допустим только внутри конкретной disease/pathway card. Функция почек и печени должна обрабатываться отдельными safety/adjustment rules.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=411  
https://knf.kz/ru/content/monograph?id=445

### `dosing.cefotaxime-metro.iai`

**Reference rule:** cefotaxime 2 г q8h + metronidazole 500 мг q8h в соответствующих WSES pathways.

**КНФ РК:** `КНФ±`.

Цефотаксим зарегистрирован/присутствует в формулярных материалах РК, включая парентеральные формы 0,5 г и 1 г, однако точная взрослая IAI-схема 2 г q8h не была подтверждена в текущей монографии КНФ как идентичное правило.

**Runtime decision:** не маркировать `КНФ+`; использовать как international reference regimen до отдельной проверки KZ-local dosing source.

### `dosing.piptazo.iai-critical`

**Reference rule:** piperacillin/tazobactam 6 г/0,75 г loading dose, затем 4 г/0,5 г q6h или 16 г/2 г continuous infusion в соответствующем WSES critical-illness pathway.

**КНФ РК:** `КНФ±`.

КНФ подтверждает интраабдоминальные инфекции как показание, но не воспроизводит эту WSES critical regimen. КНФ отдельно дает renal adjustment, например 4 г/0,5 г q8h при CrCl 20-40 мл/мин и q12h при CrCl <20 мл/мин.

**Runtime decision:** WSES dose rule + отдельный renal-adjustment gate. Не считать нормальную почечную функцию подразумеваемой, если пациент имеет AKI/CKD.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=404

**Reference IAI source:**  
WSES/GAIS/SIS-E/WSIS/AAST Global Clinical Pathways for Patients with Intra-abdominal Infections, 2021.  
https://wjes.biomedcentral.com/articles/10.1186/s13017-021-00387-8

---

## 4. Анальгезия

### `dosing.ketorolac.adult`

**Reference rule:** <65 лет: 30 мг в/в однократно; при повторном применении 30 мг q6h; максимум 120 мг/сут; суммарная продолжительность кеторолака не более 5 дней.

**КНФ РК:** `КНФ±`.

КНФ подтверждает препарат и safety restrictions, но текущая монография не используется как надежный источник полного FDA-regimen `30 мг q6h, max 120 мг/сут`.

**Runtime decision:** reference dose разрешать только при выполнении safety-gates.

### `dosing.ketorolac.elderly-renal-lowweight`

**Reference rule:** >=65 лет, масса <50 кг или renal impairment, при отсутствии advanced renal failure: 15 мг в/в однократно; при повторном применении 15 мг q6h; max 60 мг/сут.

**КНФ РК:** `КНФ±`.

КНФ подтверждает максимум 60 мг/сут при в/в/в/м введении у пациентов с нарушением функции почек, но не воспроизводит полностью FDA rule `15 мг q6h` для всех трех категорий.

### `safety.ketorolac.contra`

**КНФ РК:** `КНФ+` по ключевой safety-логике.

До выполнения действия проверять как минимум:

- активное клинически значимое кровотечение или высокий риск кровотечения;
- активное язвенное/эрозивное поражение ЖКТ или значимый анамнез ЖКК;
- выраженное нарушение функции почек;
- гиповолемию/дегидратацию и риск ОПП;
- одновременную терапию, существенно увеличивающую риск кровотечения или нефротоксичности.

Не кодировать универсальное правило "любой антиагрегант = абсолютное противопоказание ко всем НПВС". Риск должен быть drug- and patient-specific.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=704

### `dosing.paracetamol.iv`

**Reference rule:** взрослые >=50 кг: 1000 мг q6h или 650 мг q4h, максимум 4 г/сут суммарно из всех препаратов и всех путей введения, содержащих парацетамол.

**КНФ РК:** `КНФ±`.

КНФ содержит парацетамол и safety information для в/в инфузии, включая ограничение при тяжелой почечной недостаточности, но текущая монография не дает полноценную взрослую IV-схему, совпадающую с указанным FDA rule. Поэтому КНФ не использовать как источник именно этой дозировки.

**Runtime decision:** reference dose сохраняется, но отдельные правила обязательны для <50 кг, печеночной недостаточности, тяжелой почечной недостаточности и суммарной суточной экспозиции.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=769

### `dosing.tramadol.oral`

**КНФ РК:** `КНФ+` для перорального maximum, но правило должно быть отделено от парентерального.

**KZ rule:** для пероральной формы максимальная суточная доза 400 мг.

### `dosing.tramadol.parenteral`

**КНФ РК:** `КНФ+`, но `BLOCKED` до jurisdiction decision из-за расхождения с международными labeling approaches.

КНФ: 50-100 мг медленно в/в, в/м или п/к; при недостаточном эффекте через 30-60 минут возможно еще 50 мг; максимальная суточная доза 600 мг. Для послеоперационной боли: 100 мг первоначально, затем при необходимости 50 мг каждые 10-20 минут в течение первого часа, максимум 250 мг за первый час, далее 50-100 мг каждые 4-6 часов, max 600 мг/сут.

**Runtime decision:** исходный rule `50-100 мг q4-6h, max 400 мг/сут` удалить как смешивающий routes. Не обучать резидента универсальному max 600 мг/сут до отдельного CDR по KZ-local parenteral tramadol, seizure/serotonergic risk и локальному hospital formulary.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=766

### `dosing.morphine.acute`

**Статус:** `BLOCKED`.

**Причина:** текущая КНФ-монография подтверждает морфин для острой боли и одновременно ссылается на клинические протоколы по острому аппендициту, кишечной непроходимости, панкреатиту, перитониту и др., но в разделе противопоказаний одновременно указаны "боли в животе неясной этиологии" и "острый живот". Взрослая IV titration dose в монографии не приведена.

**Clinical decision:**

- не использовать КНФ как единственный источник safety-логики для морфина при acute abdomen;
- не утверждать `2-4 мг IV` без отдельного выбранного протокола/label для titration;
- teaching-point "сфинктер Одди это миф" удалить;
- допустимая формулировка после sourcing: фармакологическое влияние опиоидов на сфинктер Одди существует, но само по себе не является основанием отказывать пациенту с панкреатитом в адекватной опиоидной аналгезии, если она клинически показана.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=762

### НПВС при остром панкреатите

Удалить исходное blanket-rule: `панкреатит + гиповолемия/антиагреганты = противопоказание НПВС`.

Вместо него использовать drug-specific safety rules: renal perfusion/AKI risk, volume status, active bleeding/GI ulcer risk, concomitant antithrombotic therapy и конкретные противопоказания выбранного НПВС.

---

## 5. Инфузионная терапия

Не создавать универсальные фиксированные "дозы жидкости" вне disease card.

Для острого панкреатита не использовать старую модель routine aggressive hydration. Актуальный reference layer должен поддерживать умеренно агрессивную, индивидуализированную инфузию с ранней переоценкой, предпочтением Lactated Ringer при отсутствии противопоказаний и коррекцией по гемодинамике, BUN/Hct, диурезу, признакам перегрузки и сопутствующей сердечной/почечной патологии.

**Reference:** ACG Clinical Guideline: Management of Acute Pancreatitis, 2024.  
https://pubmed.ncbi.nlm.nih.gov/38857482/  
https://gi.org/guidelines/

---

## 6. Противорвотные

### `dosing.ondansetron`

**Reference draft:** 4 мг в/в для подходящего perioperative/acute-care indication.

**КНФ РК:** `КНФ±`.

КНФ перечисляет профилактику и лечение послеоперационной тошноты и рвоты как показание, однако в текущем dose section детально приведены главным образом chemo/radiotherapy regimens, включая 8 мг в/в. Отдельная взрослая PONV dose 4 мг в/в в текущей монографии не представлена как самостоятельная dose rule.

**Runtime decision:** `4 мг IV` не маркировать `КНФ+`. Если эта доза нужна в ON QOL, оставить ее как reference rule с отдельным проверенным perioperative source.

**Safety companion:** QT prolongation, hypokalemia/hypomagnesemia, concomitant QT-prolonging drugs и severe hepatic impairment должны учитываться отдельными rules.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=19

### `dosing.metoclopramide`

**КНФ РК:** `КНФ+`.

Взрослые: 10 мг в/м или медленно в/в, в/в болюс не менее 3 минут. При необходимости до 3 раз/сут; максимум 30 мг/сут или 0,5 мг/кг/сут.

**Safety rule:** противопоказан при ЖКК, механической кишечной непроходимости или перфорации, когда стимуляция моторики ЖКТ опасна. Формулировку "при непроходимости/компартмент осторожность" удалить. `Компартмент` здесь не относится к правилу.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=17

---

## 7. Тромбопрофилактика

### `dosing.enoxaparin.prophylaxis.moderate-risk`

**КНФ РК:** `КНФ+`.

Умеренный VTE risk: 20 мг п/к 1 раз/сут. КНФ допускает дооперационное начало за 2 часа при операциях умеренного риска.

### `dosing.enoxaparin.prophylaxis.high-risk`

**КНФ РК:** `КНФ+`.

Высокий VTE risk: 40 мг п/к 1 раз/сут, предпочтительно за 12 часов до операции согласно КНФ.

**Clinical correction:** исходное правило `40 мг q24h для абдоминальной хирургии` слишком широкое и должно быть заменено risk-stratified rules.

Перед выполнением должны сработать gates:

- VTE risk;
- bleeding risk;
- renal function;
- platelet/HIT history;
- perioperative timing;
- neuraxial anesthesia/catheter timing, если релевантно.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=109

### `dosing.ufh.prophylaxis`

**КНФ РК:** `КНФ+`.

После операции, в зависимости от риска тромбоза: 5000 МЕ п/к каждые 8-12 часов или 7500 МЕ каждые 12 часов. Исходные 5000 ЕД 2-3 раза/сут дозово допустимы.

**Clinical correction:** не описывать НФГ только как "альтернатива при недоступности НМГ". Выбор зависит от клинического контекста, renal function, bleeding risk, HIT history и локального protocol.

**КНФ:**  
https://knf.kz/ru/content/monograph?id=108

---

## 8. Спазмолитики

### `recog.drotaverine`

**КНФ РК:** `КНФ+` по наличию и дозированию.

КНФ содержит парентеральный дротаверин 40 мг/2 мл. Для взрослых: 40-240 мг/сут в 1-3 в/м введения; при острой колике 40-80 мг медленно в/в.

**Teaching correction:** не утверждать без отдельного source, что дротаверин "не влияет на исход". Допустимо учить, что симптоматический спазмолитик не должен заменять адекватную аналгезию, диагностику и definitive management.

**КНФ:**  
https://www.knf.kz/content/monograph?id=13

### `recog.hyoscine`

**КНФ РК:** `КНФ+` по наличию.

КНФ относит гиосцина бутилбромид к симптоматическим средствам для облегчения ЖКТ-симптомов, связанных со спазмом гладкой мускулатуры.

**Teaching correction:** не копировать автоматически EBM-оценку дротаверина на hyoscine. Это отдельный препарат и отдельный evidence rule.

**КНФ content:**  
https://www.knf.kz/ru/content/index

### `recog.papaverine`

**КНФ РК:** `КНФ+` по наличию.

Папаверин присутствует в КНФ и в действующих формулярных материалах РК, включая инъекционную форму. Поэтому исходную фразу `показания в экстренной абдоминальной хирургии отсутствуют` удалить как слишком абсолютную и не соответствующую локальному формулярному контексту.

**Teaching rule:** если проект хочет маркировать рутинное применение папаверина как low-value care, это должно быть отдельное evidence-backed teaching rule, а не вывод из отсутствия препарата в формуляре.

---

## 9. Legacy и не-EBM practices

### `legacy.lytic-mixture`

**Статус:** оставить как отдельный объект для распознавания, но не определять его автоматически через статус каждого компонента.

Фиксированная комбинация `metamizole + diphenhydramine + papaverine` не должна считаться одобренной только потому, что отдельные компоненты присутствуют в КНФ.

Teaching text должен быть переписан нейтрально:

> Фиксированная "литическая смесь" не является стандартной универсальной схемой лечения острой абдоминальной боли. Каждый компонент должен иметь отдельное показание, дозу и safety rationale. Наличие компонентов в КНФ не подтверждает клиническую необходимость самой комбинации.

Не использовать пока как authoritative claims:

- "комбинация из прошлой эпохи";
- "димедрол мешает динамическому наблюдению живота";
- "папаверин не имеет показаний при острой абдоминальной боли".

Эти statements требуют отдельных источников.

### `legacy.metamizole-solo`

**Из legacy удалить.**

Метамизол натрия присутствует в КНФ РК (N02BB02). Сам факт его regulatory status в США/Великобритании не делает назначение метамизола в Казахстане автоматически non-EBM или legacy.

Новый объект:

`recog.metamizole` + отдельные `dosing/safety` rules из КНФ/регистрационной инструкции + отдельный evidence/regulatory teaching rule по риску агранулоцитоза.

**КНФ index:**  
https://knf.kz/ru/content/index

### `legacy.golod-holod-pokoy`

Оставить как исторический шаблон только если он распознается как "полная тактика". Не штрафовать сам по себе временный NPO, если он клинически показан конкретному пациенту.

Для острого панкреатита современный disease card должен отдельно содержать актуальные правила по раннему пероральному/энтеральному питанию, а не использовать slogan-level correction.

---

## 10. Итоговая release-матрица

| rule_id | КНФ | Клинический статус | Runtime |
|---|---|---|---|
| dosing.cefazolin.prophylaxis | КНФ± | signed two-reviewer teaching subset; KZ divergence | APPROVED teaching-only, weight/redosing excluded |
| dosing.appendectomy.prophylaxis | КНФ± | signed two-reviewer combination rule | APPROVED teaching-only |
| dosing.metronidazole.prophylaxis | КНФ± | signed two-reviewer reference dose; КНФ не идентичен | APPROVED teaching-only |
| dosing.amoxclav.iai | КНФ± | pathway-specific | HOLD local formulation verification |
| dosing.gentamicin.iai | КНФ± | pathway-specific + renal/TDM safety | HOLD |
| dosing.ceftriaxone-metro.iai | КНФ± | pathway-specific | REVIEWED, secondary review required |
| dosing.cefotaxime-metro.iai | КНФ± | точная KZ dose не подтверждена | HOLD |
| dosing.piptazo.iai-critical | КНФ± | WSES dose + renal gate | REVIEWED, secondary review required |
| dosing.ketorolac.adult | КНФ± | reference dose + safety gates | REVIEWED, secondary review required |
| dosing.ketorolac.elderly-renal-lowweight | КНФ± | reference dose + safety gates | REVIEWED, secondary review required |
| safety.ketorolac.contra | КНФ+ | ключевая safety logic подтверждена | REVIEWED, secondary review required |
| dosing.paracetamol.iv | КНФ± | reference dose, KNF not dose source | REVIEWED, secondary review required |
| dosing.tramadol.oral | КНФ+ | route-specific | REVIEWED, secondary review required |
| dosing.tramadol.parenteral | КНФ+ | KZ dose conflicts with international max-dose conventions | BLOCKED pending CDR |
| dosing.morphine.acute | КНФ± | KNF internally problematic for acute abdomen; dose unsourced | BLOCKED |
| dosing.ondansetron | КНФ± | 4 mg IV needs separate perioperative source | HOLD |
| dosing.metoclopramide | КНФ+ | 10 mg IV/IM, slow IV >=3 min; obstruction/perforation contraindication | REVIEWED, secondary review required |
| dosing.enoxaparin.prophylaxis.moderate-risk | КНФ+ | 20 mg SC q24h | REVIEWED, secondary review required |
| dosing.enoxaparin.prophylaxis.high-risk | КНФ+ | 40 mg SC q24h | REVIEWED, secondary review required |
| dosing.ufh.prophylaxis | КНФ+ | 5000 IU SC q8-12h supported | REVIEWED, secondary review required |
| recog.drotaverine | КНФ+ | recognize; do not overclaim outcomes | RECOGNITION ONLY until teaching source |
| recog.hyoscine | КНФ+ | recognize | RECOGNITION ONLY until teaching source |
| recog.papaverine | КНФ+ | original "no indication" claim removed | RECOGNITION ONLY until teaching source |
| legacy.lytic-mixture | components in KNF | combination not validated by presence of components | TEACHING BLOCKED pending evidence |
| recog.metamizole | КНФ+ | move out of legacy | RECOGNITION ONLY pending dosing/safety rule |

---

## 11. Что можно передавать разработчику сейчас

1. Заменить `DOSING_RULES_DRAFT_v0.1` этой версией как clinical review layer, но не присваивать всему файлу `approved_for_training`.
2. Разбить трамадол на oral и parenteral rules.
3. Разбить эноксапарин на moderate-risk 20 мг и high-risk 40 мг.
4. Исправить cefazolin redosing на q4h в reference layer и явно хранить KNF divergence.
5. Добавить appendectomy prophylaxis rule: cefazolin + metronidazole либо cefoxitin/cefotetan.
6. Удалить blanket-rule про NSAID + pancreatitis + antiplatelet.
7. Заблокировать morphine adult IV dose до отдельного dosing source.
8. У metoclopramide заменить "осторожность при непроходимости/компартмент" на противопоказание при GI bleeding, mechanical obstruction или perforation.
9. Перевести metamizole solo из `legacy` в `recog.metamizole`.
10. Не превращать наличие/отсутствие препарата в КНФ в автоматическую оценку клинической правильности назначения.

---

## 12. Основные проверенные источники

**КНФ РК, проверено 20.08.2026:**

- Цефазолин: https://knf.kz/ru/content/monograph?id=405
- Метронидазол: https://knf.kz/ru/content/monograph?id=445
- Пиперациллин/тазобактам: https://knf.kz/ru/content/monograph?id=404
- Цефтриаксон: https://knf.kz/ru/content/monograph?id=411
- Гентамицин: https://knf.kz/ru/content/monograph?id=433
- Кеторолак: https://knf.kz/ru/content/monograph?id=704
- Парацетамол: https://knf.kz/ru/content/monograph?id=769
- Трамадол: https://knf.kz/ru/content/monograph?id=766
- Морфин: https://knf.kz/ru/content/monograph?id=762
- Ондансетрон: https://knf.kz/ru/content/monograph?id=19
- Метоклопрамид: https://knf.kz/ru/content/monograph?id=17
- Эноксапарин: https://knf.kz/ru/content/monograph?id=109
- Гепарин натрия: https://knf.kz/ru/content/monograph?id=108
- Дротаверин: https://www.knf.kz/content/monograph?id=13
- КНФ content/index (hyoscine, metamizole and formulary presence checks): https://knf.kz/ru/content/index

**Международные reference sources:**

- Bratzler DW et al. Clinical Practice Guidelines for Antimicrobial Prophylaxis in Surgery. 2013: https://www.idsociety.org/practice-guideline/antimicrobial-prophylaxis-in-surgery/
- WSES/GAIS/SIS-E/WSIS/AAST Global Clinical Pathways for Intra-abdominal Infections. 2021: https://wjes.biomedcentral.com/articles/10.1186/s13017-021-00387-8
- ACG Clinical Guideline: Management of Acute Pancreatitis. 2024: https://pubmed.ncbi.nlm.nih.gov/38857482/

---

**Clinical governance note:** этот файл фиксирует результат первого
клинического ревью и сверки с КНФ. Только три строки в разделе «Подписанный
runtime subset» имеют записанную вторую подпись; для остальных medication doses,
anticoagulation, antibiotics и high-risk rules статус `approved_for_training`
присваивается только после второго независимого клинического ревью.
