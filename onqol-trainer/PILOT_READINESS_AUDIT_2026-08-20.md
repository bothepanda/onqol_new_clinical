# ON QOL · аудит готовности ограниченного пилота

Дата: 20.08.2026

Scope: N=8 residents, RU, `REFERENCE-FULL` / reference mode, APP-001–004,
formative-only.

Решение: **условный кандидат; текущий production status — NO-GO** до закрытия
девяти внешних/configuration gates.

## Что проверено

- product boundary и изоляция V1;
- deterministic patient truth, scoring-off и inactive clinical branches;
- semantic router, reasoning, operationalization и stable path до discharge;
- model gateway, origin/token controls, rate limits, telemetry и error handling;
- consent, provider disclosure, local TTL, pseudonym, reports и replay export;
- production release gate, Vercel headers, CI, Node/runtime и dependency chain;
- RU/KK/real-mode boundaries, desktop/mobile start flow и двухсессионная изоляция;
- participant, privacy, launch, smoke и clinical-governance документы.

## Закрытые дефекты

| Приоритет | Дефект | Исправление и доказательство |
| --- | --- | --- |
| P0 | Проверка беременности могла создать неназванную внематочную гипотезу | diagnosis/reasoning grounding по словам участника; отрицательный и явный differential live-check |
| P0 | «Контроль источника завершён» нечётко совпадал с командой «завершить» и преждевременно открывал debrief | end-case команды теперь строгие и называют кейс/сессию; live retest остаётся в simulation и проверяет prerequisites |
| P0 | После операции broad `active_observation` возвращал неверную ветвь | deterministic phase narrowing в `postoperative_reassessment`; stable endpoint regression |
| P0 | Произвольные строки env могли изображать clinical/privacy approval | canonical manifest с id, reviewer, date, evidence, exact content/scope и matching deployment id |
| P0 | Пилот мог стартовать с неверным кодом или local fallback | authenticated status preflight, обязательный consent, production fallback disabled |
| P0 | Памятка обещала анонимность и отсутствие server/provider retention | раскрыт реальный provider/local/export data flow и default abuse-log boundary; ложные каналы WhatsApp/email удалены |
| P1 | Reports, pseudonym и orphan analytics не имели полного 7-day lifecycle | TTL/purge/rotation реализованы и покрыты тестами; consent version/timestamp входит в session/export |
| P1 | Export не включал same-session clinical reports и cost telemetry | reports включаются автоматически; provider latency/token usage агрегируются без prompts/secrets |
| P1 | Полный npm audit нашёл 4 high- и 1 low-severity build-chain advisories | lockfile обновлён совместимо; повторный full audit — 0 vulnerabilities |
| P2 | Production clinical chunk превышал 500 kB warning | governance/evidence вынесены в отдельный chunk; largest clinical chunk 457.43 kB |
| P2 | Часть внутренних phase id показывалась пользователю | добавлены RU/KK display labels для всех stable states |

## Verification snapshot

- `npm ci`: reproducible install complete.
- `npm test`: **462/462 passed**.
- `npm run lint`: passed.
- `npm run build`: Vite 8.2.2 production build passed, no chunk warning.
- `npm audit`: **0 vulnerabilities**.
- RU runtime-copy freshness check: **50** достижимых записей и **49** уникальных
  отображаемых блоков; все остаются `needs owner review`. Исходные 1364
  статических строк отфильтрованы по реальной достижимости в заданном маршруте.
- local production browser: wrong/blank code fail closed; valid code still requires
  consent; 390×844 has no horizontal overflow; console has no error/warning.
- live provider checks: no invented ectopic hypothesis; explicit differential
  preserved; numeric escalation criteria accepted; source-control completion no
  longer ends the case.
- cohort router smoke: **8/8 technical router requests**, failures 0,
  median 3098 ms, max 3229 ms,
  70,537 provider tokens total.

Последняя цифра — только восемь router calls, не восемь полных кейсов. Это
операционный риск стоимости: до всей когорты обязательны spend limit и просмотр
token telemetry первых двух сессий.

## Оставшиеся release gates

Configuration and deployment binding:

1. production `OPENAI_API_KEY` после rotation/revocation;
2. случайный `ONQOL_MAIN_ACCESS_TOKEN` длиной не менее 24 символов;
3. точный protected HTTPS `ONQOL_MAIN_ALLOWED_ORIGIN`.
4. `ONQOL_RESOURCE_PROFILE_REVIEW_ID=ONQOL-REFERENCE-FULL-20260820` в
   production environment.
5. `ONQOL_CLINICAL_SIGNOFF_ID=ONQOL-CLINICAL-20260820` в production environment.

Pending manifest approvals:

6. provider key rotation/revocation;
7. deployed hosting protection;
8. pilot-wide RU learner-copy review по
   `PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.md` и одноимённому PDF; снимки
   выполнения — `PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json`;
9. privacy owner approval для notice/consent/transfer/storage/deletion workflow.

`resource_profile_review` закрыт в manifest только для `REFERENCE-FULL` с
evidence `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md`. KZ-R1/R2/R3
остаются pending для будущего real mode и текущий pilot не блокируют; real mode
сам запрещён release gate.

## Финальная сверка gates

| Gate | Status before | Status after | Evidence | Remaining owner action |
| --- | --- | --- | --- | --- |
| `clinical_signoff` | pending; pilot-wide подписанного артефакта не было | **approved** для точного RU/REFERENCE-FULL/APP-001–004/formative-only scope | рукописно отмечены четыре кейса, общий checklist, решение, дата 20.08.2026 и подпись Сарины Т.Т.; исходный PDF сохранён без переэкспорта как `PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20.pdf`; approval id `ONQOL-CLINICAL-20260820` | установить matching production deployment id; не расширять approval на KK, real mode, APP-005, осложнения, альтернативные hidden truths или numeric scoring |
| `ru_language_review` | pending; CDR-11/17 охватывал часть строк и имел пустую подпись | **pending**, пакет достижимого текста подготовлен | 50 записей / 49 уникальных блоков в `PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.md` и PDF; воспроизводимые снимки в `PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json`; freshness check в CI/Vercel | просмотреть все `needs owner review`, зафиксировать решение и approval id |
| `resource_profile_review` | pending вместе с неподтверждёнными KZ-R1/R2/R3 | **approved** только для `REFERENCE-FULL`; real mode forbidden | `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md`, `ONQOL-REFERENCE-FULL-20260820`; два release-gate теста | установить matching production deployment id; KZ-R1/R2/R3 не закрывать ради этого пилота |
| Cohort size | N=8 был указан не во всех актуальных документах; smoke мог читаться как cohort | **N=8 residents** зафиксирован; smoke переименован | participant memo, clinical matrix, launch sheet, spec, privacy, smoke report | набрать ровно 8 участников; не считать `8/8 technical router requests` пользовательскими сессиями |
| `provider_key_rotation` | pending | pending | canonical manifest | rotate/revoke и добавить evidence + matching id |
| `hosting_protection` | pending | pending | canonical manifest | проверить exact deployed URL и добавить evidence + matching id |
| `privacy_owner_approval` | pending | pending | `PRIVACY_RETENTION.md`, participant notice/consent | утвердить notice, transfer, storage и deletion workflow |

Текущий `release:check`: `NO-GO`, `manifest_valid=true`,
`runtime_blockers=[]`, `resource_profile_review=approved`. Остались девять
реальных blocker codes: три production credentials/origin, четыре pending
approvals и два production binding для уже утверждённых clinical sign-off и
`REFERENCE-FULL`.

После их фактического закрытия: `npm run release:check` должен впервые вернуть
GO, затем выполняются cohort smoke и ручной desktop/mobile smoke уже на exact
participant URL. Локальный GO или `FULL CLINICAL TEST` не заменяют этот шаг.

## Внешние основания критериев

- OpenAI, API data controls (2026):
  https://developers.openai.com/api/docs/guides/your-data
- OWASP, Content Security Policy Cheat Sheet (current 2026):
  https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- npm, `npm audit` documentation (2026):
  https://docs.npmjs.com/cli/v11/commands/npm-audit/
