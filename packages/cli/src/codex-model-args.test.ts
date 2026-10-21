import assert from "node:assert/strict";
import { test } from "node:test";
import { codexModelArgs } from "./codex-model-args.js";

test("no explicit Heddle model inherits the current Codex default", () => {
  assert.deepEqual(codexModelArgs(undefined), []);
  assert.deepEqual(codexModelArgs(""), []);
  assert.deepEqual(codexModelArgs("  "), []);
});

test("explicit Heddle model selects that Codex model", () => {
  assert.deepEqual(codexModelArgs("gpt-6.1-sol"), ["--model", "gpt-6.1-sol"]);
  assert.deepEqual(codexModelArgs(" custom-model "), ["--model", "custom-model"]);
});
