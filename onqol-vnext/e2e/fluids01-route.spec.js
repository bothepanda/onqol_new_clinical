import { test, expect } from "@playwright/test";

async function say(page, text) {
  const input = page.getByPlaceholder("Опишите действие или вопрос…");
  const shell = page.locator(".onqol-session-shell");
  const before = Number(await shell.getAttribute("data-turn"));
  await input.fill(text);
  await input.press("Enter");
  await expect(shell).toHaveAttribute("data-turn", String(before + 1));
}

test("FLUIDS-01: ?case= открывает второй кейс, болюс и переоценка видны, сессия восстанавливается", async ({ page }) => {
  await page.goto("/?case=FLUIDS-01&seed=e2e-fluids");
  await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  await expect(page.getByPlaceholder("Опишите действие или вопрос…")).toBeVisible();
  for (const text of ["измеряю давление и пульс", "болюс 500 мл рингер-лактата", "переоцениваю давление и диурез"]) await say(page, text);
  await expect(page.getByText(/рингер/i).first()).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить кейс" }).click();
  await expect(page.getByText("болюс 500 мл рингер-лактата", { exact: true })).toBeVisible();
});

test("FLUIDS-01 не трогает сохранённый кейс APP-004", async ({ page }) => {
  await page.goto("/?seed=e2e-app-keep");
  await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  await say(page, "опрошу пациента");
  await page.goto("/?case=FLUIDS-01");
  await expect(page.getByRole("button", { name: "Продолжить кейс" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Продолжить кейс" })).toBeVisible();
});

test("dev diagnostics: hidden without ?diag=1, shown with it", async ({ page }) => {
  await page.goto("/?seed=e2e-diag");
  await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  await expect(page.getByTestId("dev-diagnostics")).toHaveCount(0);
  await page.goto("/?seed=e2e-diag&diag=1");
  await page.getByRole("button", { name: "Начать новый" }).click();
  await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  await expect(page.getByTestId("dev-diagnostics")).toBeVisible();
  await page.getByText("Сессия", { exact: true }).click();
  await expect(page.getByTestId("dev-diagnostics")).toContainText("e2e-diag");
});
