const FACILITY_TEMPLATES = Object.freeze([
  {
    id: "district_ct_open",
    label: "Многопрофильная районная больница",
    resourceLevel: "limited",
    capabilities: {
      ct: { installed: true, coverage: "24/7" },
      ultrasound: { installed: true, coverage: "business_hours" },
      laparoscopy: { installed: false, units: 0 },
      laboratory: { installed: true, coverage: "24/7" },
      operatingRoom: { installed: true, coverage: "24/7" },
      anesthesia: { installed: true, coverage: "24/7" },
      gynecology: { installed: true, coverage: "on_call" },
      icu: { installed: true, prolongedVentilation: false },
      transfer: { installed: true, baselineMinutes: 150 },
    },
  },
  {
    id: "district_lap_no_ct",
    label: "Районная больница с операционным ресурсом",
    resourceLevel: "limited",
    capabilities: {
      ct: { installed: false, coverage: "none" },
      ultrasound: { installed: true, coverage: "on_call" },
      laparoscopy: { installed: true, units: 1 },
      laboratory: { installed: true, coverage: "24/7" },
      operatingRoom: { installed: true, coverage: "24/7" },
      anesthesia: { installed: true, coverage: "24/7" },
      gynecology: { installed: false, coverage: "none" },
      icu: { installed: true, prolongedVentilation: false },
      transfer: { installed: true, baselineMinutes: 190 },
    },
  },
  {
    id: "urban_shared_resources",
    label: "Городская многопрофильная больница",
    resourceLevel: "enhanced",
    capabilities: {
      ct: { installed: true, coverage: "24/7" },
      ultrasound: { installed: true, coverage: "24/7" },
      laparoscopy: { installed: true, units: 1 },
      laboratory: { installed: true, coverage: "24/7" },
      operatingRoom: { installed: true, coverage: "24/7" },
      anesthesia: { installed: true, coverage: "24/7" },
      gynecology: { installed: true, coverage: "24/7" },
      icu: { installed: true, prolongedVentilation: true },
      transfer: { installed: true, baselineMinutes: 45 },
    },
  },
  {
    id: "diagnostic_strong_open_surgery",
    label: "Межрайонный диагностический стационар",
    resourceLevel: "enhanced",
    capabilities: {
      ct: { installed: true, coverage: "24/7" },
      ultrasound: { installed: true, coverage: "on_call" },
      laparoscopy: { installed: false, units: 0 },
      laboratory: { installed: true, coverage: "24/7" },
      operatingRoom: { installed: true, coverage: "24/7" },
      anesthesia: { installed: true, coverage: "24/7" },
      gynecology: { installed: true, coverage: "on_call" },
      icu: { installed: true, prolongedVentilation: true },
      transfer: { installed: true, baselineMinutes: 95 },
    },
  },
  {
    id: "full_resource_center",
    label: "Многопрофильный клинический центр",
    resourceLevel: "maximal",
    capabilities: {
      ct: { installed: true, coverage: "24/7" },
      ultrasound: { installed: true, coverage: "24/7" },
      laparoscopy: { installed: true, units: 2 },
      laboratory: { installed: true, coverage: "24/7" },
      operatingRoom: { installed: true, coverage: "24/7" },
      anesthesia: { installed: true, coverage: "24/7" },
      gynecology: { installed: true, coverage: "24/7" },
      icu: { installed: true, prolongedVentilation: true },
      transfer: { installed: true, baselineMinutes: 20 },
    },
  },
]);

const REFERENCE_FACILITY = Object.freeze({
  ...FACILITY_TEMPLATES[FACILITY_TEMPLATES.length - 1],
  id: "reference_full_resource",
  label: "Эталонные условия",
  resourceLevel: "reference",
});

const SHIFT_CONSTRAINTS = Object.freeze([
  {
    id: "ct_repair",
    resource: "ct",
    status: "unavailable",
    eligible: (facility) => facility.capabilities.ct.installed,
    revealText: "КТ-аппарат остановлен на ремонт. Точного времени запуска пока нет.",
    debriefText: "КТ был установлен, но недоступен из-за ремонта.",
  },
  {
    id: "ct_queue",
    resource: "ct",
    status: "delayed",
    delayMinutes: 110,
    eligible: (facility) => facility.capabilities.ct.installed,
    revealText: "КТ работает, но впереди два экстренных пациента. Ожидание около 110 минут.",
    debriefText: "Доступ к КТ был отложен очередью примерно на 110 минут.",
  },
  {
    id: "ultrasound_specialist_leave",
    resource: "ultrasound",
    status: "unavailable",
    eligible: (facility) => facility.capabilities.ultrasound.installed,
    revealText: "Врач УЗД в отпуске; замены на этой смене нет.",
    debriefText: "Аппарат УЗИ был, но специалист отсутствовал.",
  },
  {
    id: "ultrasound_after_nine",
    resource: "ultrasound",
    status: "delayed",
    delayMinutes: 380,
    eligible: (facility) => facility.capabilities.ultrasound.installed,
    revealText: "Специалист УЗД будет только к 09:00. До этого исследование выполнить некому.",
    debriefText: "УЗИ было доступно только с 09:00.",
  },
  {
    id: "laparoscopy_busy_gynecology",
    resource: "laparoscopy",
    status: "delayed",
    delayMinutes: 90,
    eligible: (facility) => facility.capabilities.laparoscopy.installed,
    revealText: "Единственная лапароскопическая стойка сейчас используется на экстренной гинекологической операции. Ожидание около 90 минут.",
    debriefText: "Лапароскопическая стойка была временно занята на гинекологической операции.",
  },
  {
    id: "anesthesiologist_busy",
    resource: "anesthesia",
    status: "delayed",
    delayMinutes: 70,
    eligible: (facility) => facility.capabilities.anesthesia.installed,
    revealText: "Дежурный анестезиолог занят на другой экстренной операции ориентировочно ещё 70 минут.",
    debriefText: "Начало операции ограничивала занятость единственного анестезиолога.",
  },
  {
    id: "laboratory_reagent_gap",
    resource: "laboratory",
    status: "unavailable",
    eligible: (facility) => facility.capabilities.laboratory.installed,
    revealText: "Анализатор исправен, но нужный реагент закончился; результата на этой смене не будет.",
    debriefText: "Лабораторное исследование было недоступно из-за отсутствия реагента.",
  },
  {
    id: "transfer_vehicle_out",
    resource: "transfer",
    status: "delayed",
    delayMinutes: 140,
    eligible: (facility) => facility.capabilities.transfer.installed,
    revealText: "Санитарный транспорт на другом вызове. Ожидание машины около 140 минут сверх дороги.",
    debriefText: "Перевод задерживался из-за отсутствия свободного санитарного транспорта.",
  },
]);

const ACTION_RESOURCES = Object.freeze({
  cbc: "laboratory",
  urinalysis: "laboratory",
  pregnancy_test: "laboratory",
  crp: "laboratory",
  biochemistry: "laboratory",
  abdominal_ultrasound: "ultrasound",
  pelvic_ultrasound: "ultrasound",
  ct_abdomen: "ct",
  transfer_before_source_control: "transfer",
});

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "onqol-v25")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function copyFacility(facility) {
  return {
    ...facility,
    capabilities: Object.fromEntries(
      Object.entries(facility.capabilities).map(([key, value]) => [key, { ...value }])
    ),
  };
}

function constraintCount(random) {
  const roll = random();
  if (roll < 0.3) return 0;
  if (roll < 0.78) return 1;
  return 2;
}

function chooseConstraints(facility, random) {
  const desired = constraintCount(random);
  const candidates = SHIFT_CONSTRAINTS.filter((constraint) => constraint.eligible(facility));
  const chosen = [];
  const usedResources = new Set();

  while (chosen.length < desired && candidates.length) {
    const constraint = pick(candidates, random);
    candidates.splice(candidates.indexOf(constraint), 1);
    if (usedResources.has(constraint.resource)) continue;
    chosen.push({ ...constraint });
    usedResources.add(constraint.resource);
  }
  return chosen;
}

export function createScenarioSeed(prefix = "shift") {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) return `${prefix}-${cryptoObject.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}`;
}

export function generateScenario({ mode = "real", seed = createScenarioSeed() } = {}) {
  const random = mulberry32(hashSeed(seed));
  const facility = copyFacility(mode === "reference" ? REFERENCE_FACILITY : pick(FACILITY_TEMPLATES, random));
  const constraints = mode === "reference" ? [] : chooseConstraints(facility, random);
  return {
    id: `${mode}:${seed}`,
    seed,
    mode,
    facility,
    constraints,
    generated: true,
    source: "synthetic_training_scenario",
  };
}

export function requestedTechnique(input) {
  const text = String(input || "").toLowerCase().replace(/ё/g, "е");
  if (/лапароскоп|лаэ|лапароскопическ/.test(text)) return "laparoscopic";
  if (/открыт|лапаротом|мак\s*-?\s*бурней|волкович/.test(text)) return "open";
  return null;
}

export function resourceForAction(actionId, input = "") {
  if (actionId === "open_appendectomy_here") {
    return requestedTechnique(input) === "laparoscopic" ? "laparoscopy" : "operatingRoom";
  }
  return ACTION_RESOURCES[actionId] || null;
}

function permanentUnavailability(resource, capability) {
  if (capability?.installed !== false) return null;
  const messages = {
    ct: "КТ-аппарата в этой больнице нет.",
    ultrasound: "Аппарата УЗИ в этой больнице нет.",
    laparoscopy: "Лапароскопическую стойку в больнице не закупали.",
    laboratory: "Это исследование в лаборатории больницы не выполняется.",
    operatingRoom: "Экстренная операционная в этом стационаре отсутствует.",
    anesthesia: "Анестезиологической службы в этом стационаре нет.",
    transfer: "Собственного санитарного транспорта у больницы нет.",
  };
  return messages[resource] || "Запрошенный ресурс в больнице отсутствует.";
}

export function resolveScenarioResource(scenario, resource) {
  if (!resource) return { resource: null, status: "available", available: true, delayMinutes: 0 };

  const capability = scenario.facility.capabilities[resource];
  const permanentMessage = permanentUnavailability(resource, capability);
  if (permanentMessage) {
    return {
      resource,
      status: "unavailable",
      available: false,
      delayMinutes: 0,
      reasonId: `facility:${resource}:not_installed`,
      revealText: permanentMessage,
      debriefText: permanentMessage,
      permanent: true,
    };
  }

  if (resource === "ultrasound" && capability?.coverage === "business_hours") {
    return {
      resource,
      status: "delayed",
      available: false,
      delayMinutes: 380,
      reasonId: "facility:ultrasound:business_hours",
      revealText: "Ночью специалиста УЗД нет; планово он будет к 09:00.",
      debriefText: "УЗИ в этой больнице доступно только в рабочие часы.",
      permanent: true,
    };
  }

  const override = scenario.constraints.find((constraint) => constraint.resource === resource);
  if (override) {
    return {
      resource,
      status: override.status,
      available: false,
      delayMinutes: override.delayMinutes || 0,
      reasonId: override.id,
      revealText: override.revealText,
      debriefText: override.debriefText,
      permanent: false,
    };
  }

  return { resource, status: "available", available: true, delayMinutes: 0 };
}

export function resolveActionResource(scenario, actionId, input = "") {
  return resolveScenarioResource(scenario, resourceForAction(actionId, input));
}

export function revealedScenarioFacts(scenario, revealedResourceIds = []) {
  const revealed = new Set(revealedResourceIds);
  return [...revealed].map((resource) => {
    const matching = scenario.constraints.find((constraint) => constraint.resource === resource);
    if (matching) return { resource, status: matching.status, text: matching.revealText };
    const resolution = resolveActionResource(
      scenario,
      resource === "operatingRoom" ? "open_appendectomy_here" : Object.keys(ACTION_RESOURCES).find((id) => ACTION_RESOURCES[id] === resource)
    );
    return { resource, status: resolution.status, text: resolution.revealText || "Ресурс доступен." };
  });
}

export const v25FacilityTemplates = FACILITY_TEMPLATES;
export const v25ShiftConstraints = SHIFT_CONSTRAINTS;
