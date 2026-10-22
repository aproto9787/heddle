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

test("finished parent runs expose unresolved worker status as unknown, not success", () => {
  const running = taskStatusEvent("r1", {
    taskId: "orphan", agent: "reviewer", status: "running", parentAgent: "leader",
  }, 1);
  assert.equal(projectTaskStatuses([running], "running")[0]?.status, "running");
  assert.deepEqual(projectTaskStatuses([running], "stale"), [{
    taskId: "orphan", agent: "reviewer", status: "unknown",
    parentAgent: "leader", reason: "parent_run_terminal",
  }]);
  assert.equal(projectTaskStatuses([running], "aborted")[0]?.status, "unknown");
  assert.equal(projectTaskStatuses([running], "done")[0]?.status, "unknown");

  // Projection is read-only, so an authentic late completion still wins.
  const completed = taskStatusEvent("r1", {
    taskId: "orphan", agent: "reviewer", status: "done",
  }, 2);
  assert.deepEqual(projectTaskStatuses([running, completed], "done"), [{
    taskId: "orphan", agent: "reviewer", status: "done", parentAgent: "leader",
  }]);
});
