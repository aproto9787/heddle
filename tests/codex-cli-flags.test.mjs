import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { codexArgs, resolveCodexCommand } from "../packages/runtime/dist/index.js";

/** Parse-only smoke: checks the real CLI parser, no account, network or model call. */
test("Codex 0.163.0 accepts Heddle's sandbox and approval argument ordering", () => {
  const cases = [
    {
      mode: "interactive",
      args: codexArgs({ mode: "interactive", env: {} }),
    },
    {
      mode: "exec",
      args: codexArgs({ mode: "exec", prompt: "not executed", env: {} }).slice(0, -1),
    },
    {
      mode: "unsafe",
      args: codexArgs({
        mode: "exec", prompt: "not executed",
        env: { HEDDLE_CODEX_UNSAFE: "1" },
      }).slice(0, -1),
    },
  ];
  for (const item of cases) {
    const resolved = resolveCodexCommand("codex", [...item.args, "--help"]);
    const result = spawnSync(resolved.command, resolved.args, {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0,
      item.mode + " args rejected: " + result.stderr);
    assert.match(result.stdout, /Codex|Usage|USAGE|codex/i);
  }
});
