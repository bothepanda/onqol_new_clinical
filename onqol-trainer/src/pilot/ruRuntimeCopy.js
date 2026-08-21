/**
 * Learner-facing copy for the scoped Russian pilot.
 *
 * This module deliberately contains only the production route authorised for
 * RU / REFERENCE-FULL / APP-001-004 / formative-only. Internal test, Kazakh and
 * real-facility copy stays outside this contract and cannot enter the review
 * package by dependency scanning.
 */
export const PILOT_RU_UI = Object.freeze({
  subtitle: "Клинический тренажёр",
  alpha: "Учебный пилот",
  landingTitle: "Выберите режим прохождения кейса.",
  landingBody: "Экстренная абдоминальная хирургия.",
  modeRegionLabel: "Режим прохождения кейса",
  addressFormTitle: "Как к тебе обращаться",
  addressFormHelp:
    "Наставник говорит на «ты». В русском прошедшее время имеет род — выбор нужен только для этого и больше нигде не используется. Можно не выбирать.",
  addressFormRegionLabel: "Форма обращения",
  addressFormNeutral: "Не указывать",
  addressFormFeminine: "Женский род",
  addressFormMasculine: "Мужской род",
  reference: "Учебный режим",
  referenceBody:
    "Учебный сценарий: необходимые для кейса ресурсы доступны. Это не профиль реального стационара.",
  case: "Экстренная абдоминальная хирургия",
  referenceShort: "Учебный режим",
  synthetic: "Учебный профиль; не описывает возможности реального стационара",
  state: "Состояние сессии",
  clinicalTime: "Клиническое время",
  phase: "Этап",
  actions: "Действия",
  noActions: "Зафиксированных действий пока нет",
  known: "Условия кейса",
  hidden: "Дополнительные условия пока не выявлены",
  sessionCode: "Код сессии",
  sessionCodeHelp: "Укажите его в форме обратной связи",
  sessionData: "Данные сессии",
  records: "записей",
  download: "Скачать данные сессии",
  finish: "Прервать сессию",
  finishConfirm: "Прервать сессию? Она будет отмечена как незавершённая, без оценки.",
  finishConfirmAction: "Да, прервать",
  cancel: "Продолжить кейс",
  restart: "Новый кейс",
  placeholder: "Что ты спрашиваешь или делаешь?",
  send: "Отправить",
  loading: "Запрос выполняется…",
  retry: "Повторить",
  requestError: "Не удалось получить ответ. Проверьте соединение и попробуйте ещё раз.",
  localNotice:
    "Соединение с сервисом отсутствует. Локальная проверка интерфейса не предназначена для пилотной сессии.",
  accessCode: "Код доступа к тренажёру",
  accessCodePlaceholder: "Введите код пилота",
  accessCodeHelp: "Код хранится только до закрытия этой вкладки.",
  backendChecking: "Проверяем соединение с сервисом…",
  backendReady: "Код принят. Тренажёр готов.",
  backendCodeRequired: "Введите действующий код пилота.",
  backendUnavailable: "Нет соединения с сервисом. Начать пилотную сессию нельзя.",
  pilotDataTitle: "Как обрабатываются данные пилота",
  pilotDataBody:
    "Ваши реплики и ответы тренажёра передаются внешнему сервису для ведения кейса. В скачиваемые данные сессии входит очищенная копия диалога; автоматическое удаление явных идентификаторов не гарантирует полную анонимность.",
  pilotDataRetention:
    "Локальные записи и сообщения об ошибках удаляются через 7 дней при следующем открытии приложения. Поставщик внешнего сервиса по умолчанию может хранить содержимое запросов в журналах контроля злоупотреблений до 30 дней; иной режим хранения должен быть отдельно подтверждён для проекта.",
  providerPolicyLink: "Политика обработки данных",
  pilotDataRestriction:
    "В сессии используется случайный код. Не вводите сведения о реальных пациентах.",
  pilotConsent:
    "Я прочитал(а) описание обработки данных и согласен(на) участвовать в этом пилотном тестировании.",
});

export const PILOT_RU_REPORT_UI = Object.freeze({
  open: "Сообщить об ошибке",
  title: "Сообщить о клинической ошибке",
  lead:
    "Замечание сохранится только в этом браузере и войдёт в скачиваемые данные сессии вместе с версией кейса и последними ходами. Само по себе оно ничего не меняет в тренажёре.",
  category: "Что не так",
  role: "Кто сообщает",
  comment: "Что именно неверно",
  commentPlaceholder: "Своими словами: что тренажёр сказал или сделал и почему это неправильно",
  disputed: "Что сказал тренажёр (по желанию)",
  disputedPlaceholder: "Скопируйте спорную фразу",
  submit: "Сохранить локально",
  cancel: "Отмена",
  saved: "Замечание сохранено локально и будет включено в данные этой сессии.",
  queue: "Локальные замечания",
  exportQueue: "Скачать замечания",
  roles: Object.freeze({
    resident_year_1: "Резидент, 1 курс",
    resident_year_2: "Резидент, 2 курс",
    resident_year_3: "Резидент, 3 курс",
    resident_year_4: "Резидент, 4 курс",
    faculty: "Преподаватель",
    unspecified: "Не указано",
  }),
});

export const PILOT_RU_PHASE_LABELS = Object.freeze({
  ems_handoff: "Передача пациента",
  data_gathering: "Сбор данных",
  presentation: "Первичная оценка",
  diagnostic_workup: "Диагностика",
  primary_assessment: "Первичная оценка",
  differential_1: "Дифференциальный ряд",
  tests_and_treatment: "Исследования и лечение",
  reassessment: "Переоценка",
  decision: "Решение",
  preop: "Подготовка к операции",
  post_source_control: "После контроля источника",
  operation: "Операция завершена",
  postop_destination: "Послеоперационный маршрут",
  ward_care: "Послеоперационное наблюдение",
  discharge: "Выписка и дальнейшее наблюдение",
  complete: "Кейс завершён",
});

export const PILOT_RU_ACTION_STATUS_LABELS = Object.freeze({
  proposed: "предложено",
  ordered: "назначено",
  performed: "выполнено",
  resulted: "результат получен",
  reassessed: "переоценено",
  blocked: "заблокировано",
});

export function pilotRuPhaseLabel(phase) {
  return PILOT_RU_PHASE_LABELS[phase] || "Текущий этап";
}

export function pilotRuActionStatus(status) {
  return PILOT_RU_ACTION_STATUS_LABELS[status] || "зафиксировано";
}
