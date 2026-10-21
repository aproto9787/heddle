import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSubagentTask } from "./subagent-runner.js";

test("delegation roundtrip preserves the MCP task ID and parses worker REPORT", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "heddle-delegation-test-"));
  try {
    const fakeWorker = path.join(cwd, "fake-worker.cjs");
    await writeFile(fakeWorker, [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const get = (key) => args[args.indexOf(key) + 1];",
      "const report = 'status: done\\nsummary:\\n  - verified delegation\\n';",
      "fs.writeFileSync(get('--report'), report);",
      "process.stdout.write(report);",
    ].join("\n"), "utf8");
    const result = await runSubagentTask({
      agent: { name: "reviewer", type: "codex" },
      taskId: "mcp-shared-task-123",
      parentAgent: "leader",
      briefing: "review the change",
      flowPath: path.join(cwd, "fake-flow.yaml"),
      cwd,
      subagentBin: fakeWorker,
    });
    assert.equal(result.taskId, "mcp-shared-task-123");
    assert.equal(result.agent, "reviewer");
    assert.equal(result.status, "done");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.report.summary, ["verified delegation"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("aborted delegation finishes with cancelled state", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "heddle-delegation-abort-"));
  try {
    const fakeWorker = path.join(cwd, "fake-hang.cjs");
    await writeFile(fakeWorker, "setInterval(() => {}, 1000);\n", "utf8");
    const abort = new AbortController();
    const pending = runSubagentTask({
      agent: { name: "reviewer", type: "codex" },
      parentAgent: "leader",
      briefing: "wait",
      flowPath: path.join(cwd, "fake-flow.yaml"),
      cwd,
      subagentBin: fakeWorker,
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 200);
    const result = await pending;
    assert.equal(result.status, "cancelled");
    assert.notEqual(result.exitCode, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
