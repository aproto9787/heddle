import assert from "node:assert/strict";
import { test } from "node:test";
import { codexSecurityArgs } from "./codex-security-args.js";

test("interactive leaders request approval in a workspace-write sandbox", () => {
  assert.deepEqual(codexSecurityArgs(true, {}), [
    "--sandbox", "workspace-write", "--ask-for-approval", "on-request",
  ]);
});

test("headless agents cannot prompt but remain sandboxed", () => {
  assert.deepEqual(codexSecurityArgs(false, {}), [
    "--sandbox", "workspace-write", "--ask-for-approval", "never",
  ]);
});

test("unsafe mode requires an exact explicit opt-in", () => {
  assert.deepEqual(codexSecurityArgs(false, { HEDDLE_CODEX_UNSAFE: "1" }), [
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.deepEqual(codexSecurityArgs(false, { HEDDLE_CODEX_UNSAFE: "true" }), [
    "--sandbox", "workspace-write", "--ask-for-approval", "never",
  ]);
});
