import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommand, validateCommand } from "./commandTypes.js";

test("an order missing a required parameter returns CLARIFY with exactly what is missing", () => {
  // Contract §8.2: "кетопрофен 100 мг" without a route asks the nurse for it.
  const command = createCommand({ id: "c1", type: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "100mg" } });
  const result = validateCommand(command);
  assert.equal(result.outcome, "CLARIFY");
  assert.deepEqual(result.missing, ["route"]);
});

test("a fully specified medication order is SUFFICIENT", () => {
  const command = createCommand({
    id: "c1",
    type: "ORDER_MEDICATION",
    params: { drugId: "ketoprofen", dose: "100mg", route: "iv" },
  });
  assert.equal(validateCommand(command).outcome, "SUFFICIENT");
});

test("an infusion needs duration or an explicit bolus, not either silently assumed", () => {
  const noDuration = createCommand({ id: "c1", type: "ORDER_INFUSION", params: { fluidId: "crystalloid", volumeMl: 500 } });
  assert.equal(validateCommand(noDuration).outcome, "CLARIFY");

  const withDuration = createCommand({
    id: "c2",
    type: "ORDER_INFUSION",
    params: { fluidId: "crystalloid", volumeMl: 500, durationMinutes: 60 },
  });
  assert.equal(validateCommand(withDuration).outcome, "SUFFICIENT");

  const bolus = createCommand({ id: "c3", type: "ORDER_INFUSION", params: { fluidId: "crystalloid", volumeMl: 500, bolus: true } });
  assert.equal(validateCommand(bolus).outcome, "SUFFICIENT");
});

test("commands with no required params (e.g. TAKE_HISTORY) are always SUFFICIENT", () => {
  const command = createCommand({ id: "c1", type: "TAKE_HISTORY", params: {} });
  assert.equal(validateCommand(command).outcome, "SUFFICIENT");
});

test("an unknown command type throws at construction rather than silently passing through", () => {
  assert.throws(() => createCommand({ id: "c1", type: "DO_SOMETHING_UNDEFINED", params: {} }));
});
