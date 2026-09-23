import { test } from "node:test";
import assert from "node:assert/strict";
import { TYPE_ANCHORS } from "./conceptGrounding.js";

const anchored = (word) => TYPE_ANCHORS.STOP_INFUSION.some((stem) => word.includes(stem));

test("first-person and idiomatic ways to stop an infusion carry a lexical anchor", () => {
  for (const word of ["останавливаю инфузию", "приостанавливаю болюс", "перекрою капельницу", "больше не вводим", "прекращаю инфузию"]) {
    assert.equal(anchored(word), true, word);
  }
  assert.equal(anchored("назначаю фуросемид"), false);
});
