import { test, expect } from "@playwright/test";

async function start(page, mode = "Эталонные условия", seed = "e2e-reference") {
  await page.goto(`/?seed=${seed}`);
  await page.getByRole("button", { name: new RegExp(`^${mode}`) }).click();
  await expect(page.getByPlaceholder("Опишите действие или вопрос…")).toBeVisible();
}

async function say(page, text) {
  const input = page.getByPlaceholder("Опишите действие или вопрос…");
  const shell = page.locator(".onqol-session-shell");
  const before = Number(await shell.getAttribute("data-turn"));
  await input.fill(text);
  await input.press("Enter");
  await expect(shell).toHaveAttribute("data-turn", String(before + 1));
}

test("Journey A: полный reference-путь заканчивается видимым дебрифом", async ({ page }) => {
  await start(page);
  for (const text of [
    "опрошу пациента", "живот", "ОАК", "КТ ОБП", "переоценю витальные через 2 часа",
    "думаю, это аппендицит. идём на операцию", "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в", "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут", "получаю согласие", "иду лапароскопически",
    "удаляю аппендикс, аспирирую жидкость", "в отделение", "vitals каждые 4 часа",
    "можно пить", "переоценю витальные через 24 часа", "выписываю",
  ]) await say(page, text);
  await expect(page.getByTestId("debrief")).toBeVisible();
  await expect(page.getByRole("button", { name: "Скачать журнал кейса" })).toBeVisible();
  await expect(page.getByText("Ограничения симулятора", { exact: true })).toBeVisible();
});

test("Journey B: отказ операции не открывает послеоперационное отделение", async ({ page }) => {
  await start(page, "Эталонные условия", "e2e-route");
  for (const text of ["идём на операцию", "венозный доступ", "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в", "получаю согласие", "иду лапароскопически", "перевожу в хирургическое отделение"]) await say(page, text);
  await expect(page.getByText(/Послеоперационный маршрут доступен только после завершения операции/)).toBeVisible();
  await expect(page.getByTestId("debrief")).toHaveCount(0);
});

test("Journey C: reload предлагает resume и сохраняет время/историю", async ({ page }) => {
  await start(page, "Эталонные условия", "e2e-persist");
  await say(page, "опрошу пациента");
  await say(page, "переоценю витальные через час");
  // core history (10 min, approved simulation calibration) + a 60-minute
  // stated reassessment = 01:10.
  await expect(page.getByText(/В кейсе: 01:10/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить кейс" }).click();
  await expect(page.getByText(/В кейсе: 01:10/)).toBeVisible();
  await expect(page.getByText("опрошу пациента", { exact: true })).toBeVisible();
  await say(page, "что с пациентом сейчас?");
  await expect(page.getByText(/Прошло 70 мин/)).toBeVisible();
});

test("Journey D: реальное ограничение скрыто до столкновения и показано как факт больницы", async ({ page }) => {
  await start(page, "Реальная больница", "e2e-2");
  await expect(page.getByText("КТ сейчас недоступна: аппарат на ремонте, срок восстановления неизвестен.", { exact: true })).toHaveCount(0);
  await say(page, "КТ ОБП");
  await expect(page.getByText("КТ сейчас недоступна: аппарат на ремонте, срок восстановления неизвестен.", { exact: true })).toBeVisible();
  await expect(page.getByText(/ошибка симулятора/i)).toHaveCount(0);
});
