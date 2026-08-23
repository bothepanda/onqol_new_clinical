import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "./rng.js";

test("same seed produces identical draws across independent instances", () => {
  const a = createRng("seed-alpha");
  const b = createRng("seed-alpha");
  const seqA = [a.stream("x").float(), a.stream("x").int(1, 100), a.stream("y").pick(["a", "b", "c"])];
  const seqB = [b.stream("x").float(), b.stream("x").int(1, 100), b.stream("y").pick(["a", "b", "c"])];
  assert.deepEqual(seqA, seqB);
});

test("different seeds diverge", () => {
  const a = createRng("seed-alpha").stream("x").float();
  const b = createRng("seed-beta").stream("x").float();
  assert.notEqual(a, b);
});

test("named streams are independent: adding a draw to one does not shift another", () => {
  const rng1 = createRng("seed-gamma");
  const untouched = rng1.stream("labs").float();

  const rng2 = createRng("seed-gamma");
  rng2.stream("complications").float(); // an extra draw on a different stream
  const stillUntouched = rng2.stream("labs").float();

  assert.equal(untouched, stillUntouched);
});
