import assert from "node:assert/strict";
import { test } from "node:test";
import { projectTaskStatuses, taskStatusEvent, transitionRunStatus, transitionTaskStatus } from "./lifecycle.js";

test("terminal task and run states never regress", () => {
  assert.equal(transitionTaskStatus("running", "done"), "done");
  assert.equal(transitionTaskStatus("cancelled", "done"), "cancelled");
  assert.equal(transitionTaskStatus("done", "cancelled"), "done");
  assert.equal(transitionTaskStatus("blocked", "error"), "blocked");
  assert.equal(transitionRunStatus("running", "aborted"), "aborted");
  assert.equal(transitionRunStatus("aborted", "done"), "aborted");
  assert.equal(transitionRunStatus("done", "error"), "done");
  assert.equal(transitionRunStatus("stale", "done"), "stale");
});

test("events reconstruct worker status while ignoring late completion", () => {
  const started = taskStatusEvent("r1", { taskId: "t1", agent: "reviewer", status: "running", parentAgent: "leader" }, 1);
  const cancelled = taskStatusEvent("r1", { taskId: "t1", agent: "reviewer", status: "cancelled", parentAgent: "leader" }, 2);
  const lateDone = taskStatusEvent("r1", { taskId: "t1", agent: "reviewer", status: "done" }, 3);
  assert.deepEqual(projectTaskStatuses([started, cancelled, lateDone]), [{
    taskId: "t1", agent: "reviewer", status: "cancelled", parentAgent: "leader",
  }]);
  assert.equal(started.type, "tool_use");
  assert.equal(cancelled.type, "tool_result");
});

test("task projection ignores unrelated or malformed run events", () => {
  const e = taskStatusEvent("r1", { taskId: "t1", agent: "implementer", status: "done" });
  assert.deepEqual(projectTaskStatuses([
    { runId: "r1", ts: 1, type: "assistant", summary: "hi" },
    { ...e, raw: { status: "done" } },
    e,
  ]), [{ taskId: "t1", agent: "implementer", status: "done", parentAgent: undefined }]);
});
