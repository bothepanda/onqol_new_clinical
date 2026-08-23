/**
 * UI chrome strings only (Core Foundation Spec §65). Clinical content stays
 * in `src/content/**` and is authored per-locale there, separately, by a
 * clinical reviewer - never mixed into this file. This file is the whole
 * locale layer for the shell: header, mode cards, sidebar labels, composer.
 */
export const LOCALES = Object.freeze(["ru", "kk", "en"]);

export const STRINGS = Object.freeze({
  ru: {
    brand: "ON QOL",
    localeSwitch: { ru: "РУС", kk: "ҚАЗ", en: "ENG" },
    account: { label: "Личный кабинет", status: "Скоро" },
    mode: {
      title: "Выберите режим",
      lead: "Каждая сессия — новый пациент. Время в симуляции реально в обоих режимах.",
      referenceTitle: "Эталонные условия",
      referenceDesc: "Полностью обеспеченный синтетический стационар. Время выполнения исследований и процедур остаётся реалистичным.",
      realTitle: "Реальная больница",
      realDesc: "Реалистичный профиль стационара: ресурсы могут быть отсрочены, недоступны, заняты или временно не работать.",
    },
    caseBar: { presentation: "Острый живот", mode: { reference: "Эталонные условия", real: "Реальная больница" } },
    sidebar: {
      hospitalTime: "Время в стационаре",
      caseTime: "В кейсе",
      vitals: "Витальные показатели",
      constraints: "Ограничения смены",
      noConstraints: "Ограничений нет",
      download: "Скачать JSON",
    },
    composer: { placeholder: "Опишите действие или вопрос…", send: "Отправить" },
  },
  kk: {
    brand: "ON QOL",
    localeSwitch: { ru: "РУС", kk: "ҚАЗ", en: "ENG" },
    account: { label: "Жеке кабинет", status: "Жақында" },
    mode: {
      title: "Режимді таңдаңыз",
      lead: "Әр сессия — жаңа пациент. Уақыт екі режимде де шынайы өтеді.",
      referenceTitle: "Эталондық жағдай",
      referenceDesc: "Толық жабдықталған синтетикалық стационар. Зерттеу мен процедура уақыты шынайы болып қалады.",
      realTitle: "Нақты аурухана",
      realDesc: "Аурухананың шынайы профилі: ресурстар кешігуі, қолжетімсіз болуы немесе бос болмауы мүмкін.",
    },
    caseBar: { presentation: "Жедел құрсақ", mode: { reference: "Эталондық жағдай", real: "Нақты аурухана" } },
    sidebar: {
      hospitalTime: "Аурухана уақыты",
      caseTime: "Кейсте",
      vitals: "Витальді көрсеткіштер",
      constraints: "Ауысым шектеулері",
      noConstraints: "Шектеулер жоқ",
      download: "JSON жүктеу",
    },
    composer: { placeholder: "Әрекетті немесе сұрақты сипаттаңыз…", send: "Жіберу" },
  },
  en: {
    brand: "ON QOL",
    localeSwitch: { ru: "RUS", kk: "KAZ", en: "ENG" },
    account: { label: "Account", status: "Soon" },
    mode: {
      title: "Choose a mode",
      lead: "Every session is a new patient. Simulated time is realistic in both modes.",
      referenceTitle: "Reference Hospital",
      referenceDesc: "A fully resourced synthetic hospital. Investigation and procedure time remains realistic.",
      realTitle: "Real-world Hospital",
      realDesc: "A realistic hospital profile: resources may be delayed, unavailable, occupied, or temporarily down.",
    },
    caseBar: { presentation: "Acute abdomen", mode: { reference: "Reference Hospital", real: "Real-world Hospital" } },
    sidebar: {
      hospitalTime: "Hospital time",
      caseTime: "In case",
      vitals: "Latest vitals",
      constraints: "Shift constraints",
      noConstraints: "No constraints",
      download: "Download JSON",
    },
    composer: { placeholder: "Describe an action or question…", send: "Send" },
  },
});

export function t(locale, path) {
  const parts = path.split(".");
  let node = STRINGS[locale] ?? STRINGS.ru;
  for (const part of parts) node = node?.[part];
  if (node === undefined) {
    let fallback = STRINGS.ru;
    for (const part of parts) fallback = fallback?.[part];
    return fallback ?? path;
  }
  return node;
}
