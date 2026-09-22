import { test, expect } from "@playwright/test";

for (const scenario of ["valid", "concept_rejection", "missing_gateway", "timeout"]) {
  test(`hybrid ${scenario}: visible progress, no lost turn, exported telemetry`, async ({ page }, testInfo) => {
    let calls = 0;
    await page.route("**/api/ai/**", async (route) => {
      calls++;
      const request = route.request().postDataJSON();
      expect(request.responseFormat.json_schema.strict).toBe(true);
      expect(request.sessionId).toMatch(/^session-/);
      if (scenario === "timeout") return;
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (scenario === "missing_gateway") { await route.fulfill({ status: 404, body: "Not found" }); return; }
      await route.fulfill({ json: { model: "ci-mock", usage: { prompt_tokens: 10, completion_tokens: 5 }, costUsd: 0.0000125,
        choices: [{ message: { content: JSON.stringify({ clinicalActions: [{ type: "ORDER_TEST", params: { testId: scenario === "concept_rejection" ? "ultrasound_abdomen" : "cbc", analytes: null }, evidenceSpans: ["общий анализ крови"], statedParameters: [] }],
          patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: "wave23-split-semantic-v1", confidence: 1 } }) } }] } });
    });
    await page.goto("/?seed=stage2-browser");
    await page.getByRole("button", { name: /^Эталонные условия/ }).click();
    const input = page.getByPlaceholder("Опишите действие или вопрос…");
    const shell = page.locator(".onqol-session-shell");
    const before = Number(await shell.getAttribute("data-turn"));
    await input.fill("оам и общий анализ крови");
    await input.press("Enter");
    await expect(page.getByRole("status")).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(shell).toHaveAttribute("data-turn", String(before + 1), { timeout: 10000 });
    await expect(input).toBeEnabled();
    expect(calls).toBe(1);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать JSON" }).click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    const telemetry = exported.interpreter.telemetryByTurn.at(-1);
    expect(telemetry.mode).toBe(["valid", "concept_rejection"].includes(scenario) ? "hybrid" : "hybrid_fallback_deterministic");
    if (scenario === "valid") { expect(telemetry.model).toBe("ci-mock"); expect(telemetry.added).toBe(1); }
    else if (scenario === "concept_rejection") {
      // v3: a rejected candidate is a candidate-level decision, not a failed task. The provider answered, the turn is
      // hybrid, the model's contradicted concept never becomes a command, and the deterministic reading is intact.
      expect(telemetry.errorCode).toBeNull();
      expect(telemetry.added).toBe(0);
      expect(telemetry.candidateDecisions[0]).toMatchObject({ type: "ORDER_TEST", validation: "REJECT" });
      expect(telemetry.candidateDecisions[0].reasonCodes).toContain("evidence_names_other_concept");
    } else expect(telemetry.errorCode).toBe(scenario === "timeout" ? "provider_timeout" : "gateway_unavailable");
    expect(exported.learner_turns).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`), fullPage: true });
  });
}
