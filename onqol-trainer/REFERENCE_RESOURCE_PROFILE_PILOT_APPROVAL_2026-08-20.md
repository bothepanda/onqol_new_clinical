# ON QOL · approval профиля REFERENCE-FULL для ограниченного пилота

**Статус:** `APPROVED_FOR_SCOPED_PILOT`

**Approval ID:** `ONQOL-REFERENCE-FULL-20260820`

**Reviewer:** Каукенова Б.Н., clinical owner

**Дата решения:** 20.08.2026

**Scope:** RU / `reference` / APP-001–004 / `formative_only` / N=8 residents

## Решение

Для ограниченного пилота утверждён только сценарный профиль
`REFERENCE-FULL`. Это учебная эталонная среда с полным ресурсом, необходимым
для прохождения стабильного APP-001–004 пути. Она не описывает и не
сертифицирует возможности какого-либо реального стационара Казахстана.

В пределах этого approval:

- KZ-R1, KZ-R2, KZ-R3 и site-specific routing не используются;
- наличие препаратов крови и пункт назначения перевода не моделируются и не
  влияют на ход или результат пилота;
- `real facility mode` запрещён release gate;
- KK, APP-005, complication paths, alternative hidden truths и numeric scoring
  остаются исключёнными;
- approval нельзя переносить на другой язык, режим, case preset, facility или
  evaluative use без нового review record.

## Проверяемая связь с release gate

Каноническая запись находится в
`src/clinical/governance/pilotReleaseApprovals.js`. Для production GO переменная
`ONQOL_RESOURCE_PROFILE_REVIEW_ID` должна в точности равняться
`ONQOL-REFERENCE-FULL-20260820`. Сам approval не заменяет production binding и
не закрывает остальные manifest/configuration gates.

Будущий review KZ-R1/R2/R3 остаётся в `KZ_RESOURCE_PROFILES_REVIEW.md` со
статусом pending. Этот pending не блокирует текущий reference-only pilot, но
любая попытка включить real mode должна вернуть `NO-GO`.
