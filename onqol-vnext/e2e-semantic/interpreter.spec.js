import { test, expect } from "@playwright/test";

const response = (clinicalActions = []) => ({ clinicalActions, patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: "wave23-split-semantic-v1", confidence: 0.9 } });
const action = (type, params, evidence) => ({ type, params, evidenceSpans: [evidence], statedParameters: [] });
async function start(page) {
  await page.goto("/?seed=semantic-browser");
  await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  return page.getByPlaceholder("Действие, вопрос или рассуждение…");
}
async function exported(page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать JSON" }).click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
test.beforeEach(async ({ page }) => {
  // No test can accidentally reach a real provider (including the mentor).
  await page.route("**/api/mentor/dialogue", (route) => route.fulfill({ json: {
    text: "Как это влияет на твой следующий шаг?", question: null,
    audit: { status: "accepted", calls: [], context: route.request().postDataJSON().context },
  } }));
});

test("free phrasing orders only CBC, exports interpretation and survives resume", async ({ page }, testInfo) => {
  let calls = 0;
  const text = "Пусть лаборант определит число белых клеток в крови";
  await page.route("**/api/ai/interpreter", (route) => {
    calls += 1;
    const request = route.request().postDataJSON();
    expect(JSON.parse(request.messages[1].content).rawLearnerText).toBe(text);
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(response([action("ORDER_TEST", { testId: "cbc" }, text)])) } }], model: "browser-fixture" } });
  });
  const input = await start(page);
  await input.fill(text); await input.press("Enter");
  await expect(input).toBeEnabled();
  await expect(page.locator(".onqol-session-shell")).toHaveAttribute("data-turn", "1");
  const data = await exported(page);
  expect(data.learner_turns[0].interpretedCommands.filter((c) => c.type === "ORDER_TEST").map((c) => c.params.testId)).toEqual(["cbc"]);
  expect(data.interpreter.byTurn).toEqual(["semantic_first"]);
  expect(data.interpreter.telemetryByTurn[0].providerEvidence.captured).toBe(true);
  expect(data.current_state.clock.elapsedMinutes).toBe(0);
  expect(data.events.some((event) => event.type === "TEST_RESULTED")).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("semantic-first.png"), fullPage: true });
  await page.reload(); await page.getByRole("button", { name: /Продолжить/ }).click();
  expect((await exported(page)).learner_turns).toEqual(data.learner_turns);
  expect(calls).toBe(1);
});

test("provider outage is visible and cannot execute a dictionary-recognized order", async ({ page }) => {
  await page.route("**/api/ai/interpreter", (route) => route.fulfill({ status: 503, json: { error: "provider_error" } }));
  const input = await start(page);
  await input.fill("назначаю ОАК"); await input.press("Enter");
  await expect(page.getByText(/Не удалось разобрать сообщение/)).toBeVisible();
  const data = await exported(page);
  expect(data.events.some((event) => event.type === "TEST_ORDERED")).toBe(false);
  expect(data.current_state.clock.elapsedMinutes).toBe(0);
  expect(data.interpreter.byTurn).toEqual(["semantic_first_unavailable"]);
});

test("a quoted medication order executes nothing and asks about intent", async ({ page }) => {
  const text = "Назначаю кетопрофен 100 мг в/в — это вопрос для обсуждения";
  await page.route("**/api/ai/interpreter", (route) => route.fulfill({ json: {
    choices: [{ message: { content: JSON.stringify(response([action("ORDER_MEDICATION", { drugId: "ketoprofen" }, "Назначаю кетопрофен 100 мг в/в")])) } }], model: "browser-fixture",
  } }));
  const input = await start(page);
  await input.fill(text); await input.press("Enter");
  await expect(page.getByText(/Ты хочешь выполнить действие сейчас/)).toBeVisible();
  const data = await exported(page);
  expect(data.events.some((event) => event.type === "MEDICATION_ADMINISTERED")).toBe(false);
  expect(data.current_state.clock.elapsedMinutes).toBe(0);
});

test("discussion-only interpretation is retained in the export", async ({ page }) => {
  await page.route("**/api/ai/interpreter", (route) => route.fulfill({ json: {
    choices: [{ message: { content: JSON.stringify(response()) } }], model: "browser-fixture",
  } }));
  const input = await start(page);
  await input.fill("Объясни миграцию боли"); await input.press("Enter");
  await expect(page.getByText(/Как это влияет на твой следующий шаг/)).toBeVisible();
  const data = await exported(page);
  expect(data.mentor_dialogue[0].interpretation.mode).toBe("semantic_first");
  expect(data.mentor_dialogue[0].interpretation.telemetry.providerEvidence.captured).toBe(true);
  expect(data.current_state.clock.elapsedMinutes).toBe(0);
});

test("a short answer uses the displayed mentor question and never orders its example", async ({ page }) => {
  let calls = 0;
  const question = "Что ожидаешь увидеть в анализах?";
  await page.route("**/api/mentor/dialogue", (route) => route.fulfill({ json: {
    text: question, question: { text: question, expects: "обоснование" }, audit: { status: "accepted", calls: [] },
  } }));
  await page.route("**/api/ai/interpreter", (route) => {
    calls += 1;
    const payload = JSON.parse(route.request().postDataJSON().messages[1].content);
    if (calls === 2) expect(payload.precedingSystemQuestion.expectsReasoningOnly).toBe(true);
    const value = calls === 2 ? response([action("ORDER_TEST", { testId: "cbc" }, "ОАК")]) : response();
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(value) } }], model: "browser-fixture" } });
  });
  const input = await start(page);
  await input.fill("Объясни ход обследования"); await input.press("Enter");
  await expect(page.locator(".onqol-message-mentor").filter({ hasText: question })).toHaveCount(1);
  await input.fill("ОАК"); await input.press("Enter");
  await expect(page.locator(".onqol-message-mentor").filter({ hasText: question })).toHaveCount(2);
  const data = await exported(page);
  expect(data.events.some((event) => event.type === "TEST_ORDERED")).toBe(false);
  expect(calls).toBe(2);
});
