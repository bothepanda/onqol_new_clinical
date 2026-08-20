# ON QOL · лист пуска ограниченного пилота

Версия 20.08.2026. Целевой scope: **N=8 residents**, RU, `reference`,
APP-001–004, `formative_only`; KK, реальная больница, APP-005, осложнения,
альтернативные hidden truths и числовой scoring исключены.

Текущий статус определяется только командой `npm run release:check`. Пока хотя
бы один пункт ниже не закрыт доказательством, решение — **NO-GO**.

## 1. Конфигурация деплоя

- [ ] `OPENAI_API_KEY`: новый project-scoped ключ; прежний ключ отозван.
- [ ] `ONQOL_MAIN_ACCESS_TOKEN`: случайный код не короче 24 символов, отдельный
  от ключа провайдера.
- [ ] `ONQOL_MAIN_ALLOWED_ORIGIN`: точный HTTPS origin без path и завершающего `/`.
- [ ] На хостинге включены защита домена, аутентификация и durable spend/rate
  controls.
- [ ] Все секреты доступны server/build environment и отсутствуют в `VITE_*`,
  git, логах и скачиваемом bundle.

## 2. Manifest-based approvals

Канонический файл —
`src/clinical/governance/pilotReleaseApprovals.js`. Запись переводится из
`pending` в `approved` только после фактического ревью и должна содержать:

```js
{
  status: "approved",
  approval_id: "ONQOL-...", // уникальный id, минимум 12 символов после префикса
  reviewer: "ФИО и роль",
  approved_at: "2026-08-20T00:00:00+05:00",
  evidence: "путь к подписанному артефакту или журналу проверки",
  scope: "точно утверждённый scope"
}
```

Deployment variable должна в точности совпасть с `approval_id` той же записи:

| Manifest record | Deployment variable | Текущий статус и evidence |
| --- | --- | --- |
| `provider_key_rotation` | `ONQOL_PROVIDER_KEY_ROTATION_ID` | pending: новый ключ должен работать, старый — быть отозван |
| `hosting_protection` | `ONQOL_HOSTING_PROTECTION_ID` | pending: защита должна быть проверена на реальном URL |
| `clinical_signoff` | `ONQOL_CLINICAL_SIGNOFF_ID` | **approved** для точного RU/REFERENCE-FULL/APP-001–004/formative-only scope: Сарина Т.Т., 20.08.2026, evidence `PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20.pdf`; deployment id должен быть `ONQOL-CLINICAL-20260820` |
| `ru_language_review` | `ONQOL_RU_LANGUAGE_REVIEW_ID` | pending: 50 достижимых записей / 49 уникальных блоков подготовлены в `PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.md` и PDF; снимки — `PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json` |
| `resource_profile_review` | `ONQOL_RESOURCE_PROFILE_REVIEW_ID` | **approved** только для `REFERENCE-FULL`: `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md`; deployment id должен быть `ONQOL-REFERENCE-FULL-20260820` |
| `privacy_owner_approval` | `ONQOL_PRIVACY_OWNER_APPROVAL_ID` | pending: уведомление, согласие, передача и удаление должны быть утверждены |

Произвольная строка в env не является подписью: gate требует одновременно
полную запись в manifest и совпадающий id в environment.

## 3. Сборка и проверка

```bash
npm ci
npm test
npm run lint
npm audit
npm run release:check
npm run build
```

На Vercel используется `npm run verify:pilot && vite build`; prebuilt-обход для
пилота запрещён. После GO выполнить smoke на выданном участникам URL:

```bash
ONQOL_SMOKE_URL=https://pilot.example.kz \
ONQOL_MAIN_ACCESS_TOKEN='...' \
npm run smoke:cohort
```

Успех автоматического smoke: **8/8 technical router requests**, ноль
401/403/429/5xx, заполненные latency/token metrics. Это не восемь завершённых
сессий участников. Затем выполнить ручной desktop/mobile сценарий из
`PILOT_SMOKE_TEST.md`.

## 4. Операционный запуск

- [ ] Организатор находится в комнате во время всех сессий.
- [ ] Утверждены закрытое хранилище, список получателей, способ очной передачи
  JSON и дата удаления; личные почта/мессенджеры исключены.
- [ ] Участник видит уведомление, provider-retention и consent checkbox до старта.
- [ ] Загружен лимит расходов и настроено наблюдение за 401/403/429/5xx,
  latency и token usage.
- [ ] Первые две сессии просмотрены до продолжения когорты; клиническая ошибка
  или смешение сессий останавливают пилот.

## 5. Что не считается GO

- зелёные unit-тесты без внешних подписей;
- `FULL CLINICAL TEST` или development fallback;
- локальный smoke вместо protected deployment smoke;
- утверждение только автором там, где manifest требует независимого reviewer;
- включение KK, real mode, scoring или неподписанных clinical branches новым env-флагом.
