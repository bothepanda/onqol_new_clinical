import { test, expect } from "@playwright/test";
import { renderFlexibleSpeech } from "../src/ai/patient/flexiblePatient.js";
const key = "onqol-flexible-patient-v2";
const enter = async (page, text) => { await page.getByRole("textbox").fill(text); await page.getByRole("textbox").press("Enter"); await expect(page.getByRole("textbox")).toBeEnabled(); };

test("governed dialogue: disclosure, immutable truth, restore, safe export and stop", async ({ page }, testInfo) => {
  let calls = 0;
  await page.route("**/api/**", async (route) => {
    if (!route.request().url().endsWith("/api/flexible/turn")) return route.fulfill({ status: 503, json: { error: "fixture_only" } });
    const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["input", "sessionId"]);
    expect(JSON.stringify(body)).not.toContain("operativeTruthRu");
    const result = await renderFlexibleSpeech({ input: body.input, provider: { async complete(request) {
      calls++;
      const stage = request.responseFormat.json_schema.name;
      return { text: JSON.stringify(stage === "patient_render" ? { variant: 0, opening: "answer", closing: "none" } : { grounded: true, issues: [] }) };
    } } });
    await route.fulfill({ json: result });
  });
  await page.goto("/?seed=flex-v2-browser");
  await page.getByRole("button", { name: /^Гибкий клинический диалог/ }).click();
  await enter(page, "Была рвота?");
  await expect(page.getByText(/Отвечу на ваш вопрос/)).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(2);
  const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  expect(before.start.clinicalContentPolicy).toBe("approved_only");
  await page.reload(); await page.getByRole("button", { name: /^Гибкий клинический диалог/ }).click();
  await expect(page.getByText(/Отвечу на ваш вопрос/)).toBeVisible();
  const restored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  expect(restored.expectedEvents).toEqual(before.expectedEvents);
  await enter(page, "кетопрофен 100 мг в/м");
  await enter(page, "переоценю боль через 10 минут");
  await expect(page.getByText("Последние измеренные показатели")).toBeVisible();
  await expect(page.locator(".onqol-vitals")).toBeVisible();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  expect(stored.expectedEvents.some((e) => e.type === "MEDICATION_ADMINISTERED")).toBe(true);
  expect(stored.expectedEvents.some((e) => e.type === "TREATMENT_EFFECT_APPLIED")).toBe(false);
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Скачать сессию" }).click();
  const download = await downloaded; const stream = await download.createReadStream(); let raw = ""; for await (const part of stream) raw += part;
  const exported = JSON.parse(raw);
  expect(exported.version).toBe("flexible-patient-2-transcript"); expect(exported.current_state).toBeUndefined(); expect(exported.events).toBeUndefined(); expect(raw).not.toContain("operativeTruthRu");
  await page.getByRole("button", { name: "Остановить сессию" }).click();
  await expect(page.getByText(/Кейс не завершён/)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("onqol-flexible-v2-desktop.png"), fullPage: true });
});

test("mobile renderer failure does not undo executed action; V1 is retained without migration", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { error: "offline-fixture" } }));
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("onqol-flexible-patient-v1", JSON.stringify({ facts: { invented: true }, version: "flexible-patient-1" })));
  await page.getByRole("button", { name: /^Гибкий клинический диалог/ }).click();
  await expect(page.getByText(/Старая экспериментальная сессия/)).toBeVisible();
  await enter(page, "осмотрю живот");
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  expect(stored.expectedEvents.some((e) => e.type === "EXAMINATION_PERFORMED")).toBe(true);
  expect(stored.patientDialogue.some((x) => x.fallbackUsed)).toBe(true);
  expect(JSON.stringify(stored)).not.toContain("invented");
  expect(await page.evaluate(() => localStorage.getItem("onqol-flexible-patient-v1"))).toContain("invented");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("onqol-flexible-v2-mobile.png"), fullPage: true });
});
