import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.HEDDLE_SERVER_AUTOSTART = "0";

const { buildServer } = await import("../apps/server/dist/index.js");
const { resetTraceStore } = await import("../apps/server/dist/trace-store.js");
const { HeddleMcpServer } = await import("../packages/mcp/dist/index.js");
const { runSubagentTask } = await import("../packages/runtime/dist/index.js");

function toolPayload(response) {
  assert.ok(response?.result?.content?.[0]?.text);
  return JSON.parse(response.result.content[0].text);
}

async function waitFor(check, description, limitMs = 10_000) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out: " + description);
}

async function readStatusStream(streamPromise, count) {
  const response = await streamPromise;
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader, "SSE body reader must exist");
  const decoder = new TextDecoder();
  const observed = [];
  let buffer = "";
  try {
    while (observed.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const message = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const eventType = message.split("\n").find((line) => line.startsWith("event: "));
        const dataLine = message.split("\n").find((line) => line.startsWith("data: "));
        if (eventType === "event: run_event" && dataLine) {
          const parsed = JSON.parse(dataLine.slice(6));
          if (parsed.toolName === "heddle-task") observed.push(parsed);
        }
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel();
  }
  assert.equal(observed.length, count, "worker lifecycle changes should reach SSE");
  return observed;
}

test("simulated leader → MCP → worker subprocess → SQLite and SSE", { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heddle-golden-"));
  resetTraceStore();
  const app = buildServer();
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const runId = "golden-" + Date.now();
  let reportPath;
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    if (reportPath) await rm(path.dirname(reportPath), { recursive: true, force: true });
  });

  const flowPath = path.join(root, "flow.yaml");
  await writeFile(flowPath, [
    "name: Golden Test",
    "repo: .",
    "orchestrator:",
    "  name: leader",
    "  type: codex",
    "  agents:",
    "    - name: reviewer",
    "      type: codex",
    "      system: Review a patch.",
    "",
  ].join("\n"));

  const workerPath = path.join(root, "fake-worker.cjs");
  await writeFile(workerPath, [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const find = (name) => args[args.indexOf(name) + 1];",
    "const report = 'status: done\\nsummary:\\n  - approved fake patch\\n';",
    "fs.writeFileSync(find('--report'), report);",
    "process.stdout.write(report);",
  ].join("\n"));

  const registered = await fetch(origin + "/runs/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId, flowName: "Golden Test", flowPath: "examples/simple-team.yaml",
      source: "cli", agentType: "codex", startTime: new Date().toISOString(),
    }),
  });
  assert.equal(registered.status, 201);

  const sse = fetch(origin + "/runs/" + runId + "/stream");
  await new Promise((resolve) => setTimeout(resolve, 80));

  const mcp = new HeddleMcpServer({
    env: {
      HEDDLE_FLOW_PATH: flowPath,
      HEDDLE_FLOW_CWD: root,
      HEDDLE_AGENT: "leader",
      HEDDLE_RUN_ID: runId,
      HEDDLE_SERVER_ORIGIN: origin,
      HEDDLE_SUBAGENT_BIN: workerPath,
    },
    delegateRunner: runSubagentTask,
  });
  const delegated = await mcp.handleRequest({
    id: 1,
    method: "tools/call",
    params: {
      name: "heddle_delegate_reviewer",
      arguments: { briefing: "Review the fake patch." },
    },
  });
  const task = toolPayload(delegated);
  assert.equal(task.status, "running");
  assert.equal(task.agent, "reviewer");

  const finished = await waitFor(async () => {
    const response = await mcp.handleRequest({
      id: 2,
      method: "tools/call",
      params: { name: "heddle_read_report", arguments: { taskId: task.taskId } },
    });
    const value = toolPayload(response);
    return value.status === "done" ? value : undefined;
  }, "MCP result");
  reportPath = finished.reportPath;
  assert.equal(finished.taskId, task.taskId);
  assert.deepEqual(finished.report.summary, ["approved fake patch"]);

  const tasks = await waitFor(async () => {
    const response = await fetch(origin + "/runs/" + runId + "/tasks");
    assert.equal(response.status, 200);
    const data = await response.json();
    return data.tasks[0]?.status === "done" ? data.tasks : undefined;
  }, "SQLite worker status");
  assert.deepEqual(tasks, [{
    taskId: task.taskId, agent: "reviewer", status: "done", parentAgent: "leader",
  }]);

  const events = await readStatusStream(sse, 2);
  assert.deepEqual(events.map((event) => event.raw.status).sort(), ["done", "running"]);
  assert.ok(events.every((event) => event.raw.taskId === task.taskId));

  const completed = await fetch(origin + "/runs/" + runId + "/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "done", exitCode: 0, endTime: new Date().toISOString() }),
  });
  assert.equal(completed.status, 200);
  const detail = await (await fetch(origin + "/runs/" + runId)).json();
  assert.equal(detail.status, "done");
  assert.equal(detail.exitCode, 0);
});
