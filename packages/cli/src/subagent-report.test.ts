import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractCodexFinalMessage,
  initialReport,
  isCompleteReport,
  recoverReport,
} from "./subagent-report.js";

test("isCompleteReport rejects the initial did-not-start placeholder", () => {
  assert.equal(isCompleteReport(initialReport("debater-a"), "debater-a"), false);
});

test("recoverReport returns a valid report from Codex JSON stdout when available", () => {
  const stdout = `${JSON.stringify({
    type: "item.completed",
    item: {
      type: "message",
      role: "assistant",
      content: [{
        type: "output_text",
        text: "status: done\nsummary:\n  - recovered from stdout\n  - review: pass\n",
      }],
    },
  })}\n`;

  assert.equal(extractCodexFinalMessage(stdout), "status: done\nsummary:\n  - recovered from stdout\n  - review: pass");
  assert.equal(recoverReport({
    name: "debater-a",
    exitCode: 0,
    stdout,
    stderr: "",
  }), "status: done\nsummary:\n  - recovered from stdout\n  - review: pass\n");
});

test("recoverReport creates a diagnostic blocked report when stdout has no report", () => {
  const report = recoverReport({
    name: "debater-a",
    exitCode: 0,
    stdout: "",
    stderr: "Reading additional input from stdin...\n",
  });

  assert.equal(isCompleteReport(report, "debater-a"), true);
  assert.match(report, /status: blocked/);
  assert.match(report, /debater-a did not write a valid REPORT file/);
  assert.match(report, /child stderr: Reading additional input from stdin\.\.\./);
});

test("isCompleteReport requires a bullet inside summary rather than another section", () => {
  const cases = [
    "status: blocked\nsummary:\nblockers:\n  - waiting for input\n",
    "status: done\nsummary:\nartifacts:\n  - src/file.ts:1\n",
    "status: done\nsummary:\n  \nblockers:\n  - incorrectly counted as summary\n",
  ];

  for (const report of cases) {
    assert.equal(isCompleteReport(report, "reviewer"), false, report);
  }
});

test("isCompleteReport accepts summary bullets with CRLF and later sections", () => {
  const report = [
    "status: done",
    "summary:",
    "  - reviewed source changes",
    "artifacts:",
    "  - src/file.ts:1",
    "",
  ].join("\r\n");
  assert.equal(isCompleteReport(report, "reviewer"), true);
});

test("recoverReport rejects incomplete Codex final message and uses diagnostic fallback", () => {
  const invalidReport = "status: done\nsummary:\nblockers:\n  - no actual summary\n";
  const stdout = JSON.stringify({
    type: "item.completed",
    item: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: invalidReport }],
    },
  });
  const report = recoverReport({
    name: "reviewer",
    exitCode: 0,
    stdout,
    stderr: "",
  });

  assert.match(report, /^status: blocked\n/);
  assert.match(report, /reviewer did not write a valid REPORT file/);
});

test("isCompleteReport ignores bullets before the summary section", () => {
  const report = [
    "status: done",
    "artifacts:",
    "  - src/file.ts:2",
    "summary:",
    "blockers:",
    "  - task was not actually summarized",
    "",
  ].join("\n");

  assert.equal(isCompleteReport(report, "reviewer"), false);
});
