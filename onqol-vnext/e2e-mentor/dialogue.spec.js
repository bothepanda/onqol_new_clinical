import { test, expect } from "@playwright/test";
test("discussion remembers context, persists/export audit and never executes a medication", async ({ page }, testInfo) => {
  const bodies = [];
  await page.route("**/api/mentor/dialogue", async (route) => {
    const body = route.request().postDataJSON(); bodies.push(body);
    expect(body.context).not.toHaveProperty("truth");
    await route.fulfill({ json: { text: "Что в уже полученных данных больше всего поддерживает твоё заключение?", question: { text: "Что в уже полученных данных больше всего поддерживает твоё заключение?", expects: "синтез данных" }, audit: { status: "accepted", context: body.context, calls: [{ task: "mentor_draft", raw: "ci-mock" }], cardIds: ["K12"] } } });
  });
  await page.goto("/?seed=mentor-browser");
  await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  const shell = page.locator(".onqol-session-shell");
  const initialTurn = await shell.getAttribute("data-turn");
  await expect(page.getByRole("button", { name: "Обсудить с наставником" })).toHaveCount(0);
  const input = page.getByPlaceholder("Действие, вопрос или рассуждение…");
  await input.fill("Нужно ли назначать кетопрофен 100 мг в/в?"); await input.press("Enter");
  await expect(page.locator(".onqol-message-mentor")).toContainText("Что в уже полученных данных");
  await expect(shell).toHaveAttribute("data-turn", initialTurn);
  await input.fill("Я это уже объяснил"); await input.press("Enter");
  await expect(page.locator(".onqol-message-mentor")).toHaveCount(2);
  expect(bodies[1].context.history.some((x) => x.role === "mentor")).toBe(true);
  expect(bodies[1].context.facts.every((x) => !x.text.includes("кетопрофен"))).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать JSON" }).click();
  const download = await downloadPromise; const stream = await download.createReadStream(); const chunks = [];
  for await (const x of stream) chunks.push(x);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.learner_turns).toHaveLength(0);
  expect(exported.mentor_dialogue).toHaveLength(2);
  expect(exported.current_state.clock.elapsedMinutes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("mentor.png"), fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: /Продолжить/ }).click();
  await expect(page.locator(".onqol-message-mentor")).toHaveCount(2);
  const clinical = page.getByPlaceholder("Действие, вопрос или рассуждение…");
  await clinical.fill("осмотр живота"); await clinical.press("Enter");
  await expect(shell).toHaveAttribute("data-turn", String(Number(initialTurn) + 1));
  expect(bodies).toHaveLength(2);
});

test("outage yields a visible fallback without losing question", async ({ page }) => {
  await page.route("**/api/mentor/dialogue", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/"); await page.getByRole("button", { name: /^Эталонные условия/ }).click();
  await expect(page.getByRole("button", { name: "Обсудить с наставником" })).toHaveCount(0);
  const input = page.getByPlaceholder("Действие, вопрос или рассуждение…");
  await input.fill("Объясни миграцию боли"); await input.press("Enter");
  await expect(page.getByText(/Наставник сейчас недоступен/)).toBeVisible();
  await expect(page.locator(".onqol-message-learner").filter({ hasText: "Объясни миграцию боли" })).toBeVisible();
  await expect(input).toBeEnabled();
});

test("one message orders CBC and discusses CT; ambiguity executes nothing", async ({page}) => {
  const bodies=[];
  await page.route("**/api/mentor/dialogue", route=>{bodies.push(route.request().postDataJSON());return route.fulfill({json:{text:"Что ты хочешь уточнить этим исследованием?",question:null,audit:{status:"accepted",calls:[]}}});});
  await page.goto("/");await page.getByRole("button",{name:/^Эталонные условия/}).click();
  const input=page.getByPlaceholder("Действие, вопрос или рассуждение…");
  await input.fill("Назначаю кетопрофен 100 мг в/в — это вопрос для обсуждения");await input.press("Enter");
  await expect(page.getByText(/Ты хочешь выполнить действие сейчас/)).toBeVisible();
  await expect(page.locator(".onqol-session-shell")).toHaveAttribute("data-turn","0");
  expect(bodies).toHaveLength(0);
  await input.fill("Назначаю ОАК. Почему нужна КТ?");await input.press("Enter");
  await expect(page.getByText(/Что ты хочешь уточнить этим исследованием/)).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].context.facts.some(x=>/ОАК|Общий анализ крови/iu.test(x.text))).toBe(true);
  const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"Скачать JSON"}).click();
  const stream=await (await downloadPromise).createReadStream();const chunks=[];for await(const x of stream)chunks.push(x);
  const data=JSON.parse(Buffer.concat(chunks).toString());
  expect(data.learner_turns).toHaveLength(1);
  expect(data.mentor_dialogue).toHaveLength(2);
  const json=JSON.stringify(data.learner_turns[0]);
  expect(json).toContain("cbc");
  // CT is withheld, never an executed order.
  expect(data.learner_turns[0].interpretedCommands.filter(x => x.type === "ORDER_TEST").map(x => x.params.testId)).toEqual(["cbc"]);
  expect(data.learner_turns[0].withheldCommands.some(x => x.params.testId === "ct_abdomen")).toBe(true);
});
