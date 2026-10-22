import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  codexArgs,
  resolveCodexCommand,
  parseCodexStreamLine,
  startCodexSession,
} from "./codex-session.js";

test("interactive leaders request approval inside a workspace-write sandbox", () => {
  assert.deepEqual(codexArgs({ mode: "interactive", env: {} }), [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "on-request",
  ]);
  assert.deepEqual(codexArgs({ mode: "interactive", model: " current-model ", env: {} }), [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "on-request",
    "--model", "current-model",
  ]);
});

test("headless leaders and workers put global security flags before exec", () => {
  assert.deepEqual(codexArgs({ mode: "exec", prompt: "hello", env: {} }), [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "never",
    "exec", "--json", "--skip-git-repo-check", "hello",
  ]);
  assert.deepEqual(codexArgs({ mode: "exec", stdinPrompt: true, model: "test-model", env: {} }), [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "never",
    "exec", "--json", "--skip-git-repo-check", "--model", "test-model", "-",
  ]);
});

test("unsafe bypass is available only via exact explicit opt-in", () => {
  assert.deepEqual(codexArgs({ mode: "interactive", env: { HEDDLE_CODEX_UNSAFE: "1" } }), [
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.deepEqual(codexArgs({ mode: "exec", prompt: "review", env: { HEDDLE_CODEX_UNSAFE: "1" } }), [
    "--dangerously-bypass-approvals-and-sandbox",
    "exec", "--json", "--skip-git-repo-check", "review",
  ]);
  assert.deepEqual(codexArgs({ mode: "exec", prompt: "review", env: { HEDDLE_CODEX_UNSAFE: "true" } }), [
    "--sandbox", "workspace-write",
    "--ask-for-approval", "never",
    "exec", "--json", "--skip-git-repo-check", "review",
  ]);
});

test("parseCodexStreamLine maps completed tool and assistant messages", () => {
  const input = (item: object) => JSON.stringify({
    type: "item.completed", timestamp: "2026-10-22T00:00:00Z", item,
  });
  const assistant = parseCodexStreamLine(input({ type: "agent_message", text: "Task complete" }));
  assert.equal(assistant?.type, "assistant");
  assert.equal(assistant?.summary, "Task complete");
  assert.equal(assistant?.timestamp, Date.parse("2026-10-22T00:00:00Z"));

  const command = parseCodexStreamLine(input({ type: "command_execution", command: "npm test" }));
  assert.equal(command?.type, "tool_use");
  assert.equal(command?.toolName, "Bash");
  const file = parseCodexStreamLine(input({ type: "file_change", operation: "update", path: "src/a.ts" }));
  assert.equal(file?.type, "tool_result");
  assert.equal(file?.toolName, "Edit");

  assert.equal(parseCodexStreamLine('not-json'), undefined);
  assert.equal(parseCodexStreamLine(JSON.stringify({ type: "turn.completed" })), undefined);
});

test("shared process joins fragmented stdout, flushes final line and drains stderr", async () => {
  const first = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } });
  const second = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "echo ok" } });
  const script = [
    "const first = " + JSON.stringify(first) + ";",
    "const second = " + JSON.stringify(second) + ";",
    "process.stdout.write(first.slice(0, 10));",
    "setTimeout(() => {",
    "  process.stdout.write(first.slice(10) + '\\r\\n');",
    "  process.stdout.write(second);",
    "  process.stderr.write('diagnostic');",
    "}, 10);",
  ].join("\n");
  const lines: string[] = [];
  const session = startCodexSession({
    command: process.execPath,
    args: ["-e", script],
    onStdoutLine: (line) => lines.push(line),
  });
  const result = await session.finished;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "diagnostic");
  assert.deepEqual(lines, [first, second]);
  assert.equal(parseCodexStreamLine(lines[0])?.type, "assistant");
  assert.equal(parseCodexStreamLine(lines[1])?.type, "tool_use");
});

test("shared session sends its stdin text to worker-style processes", async () => {
  const script = [
    "let body = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => body += chunk);",
    "process.stdin.on('end', () => process.stdout.write('brief:' + body));",
  ].join("\n");
  const session = startCodexSession({
    command: process.execPath,
    args: ["-e", script],
    stdio: ["pipe", "pipe", "pipe"],
    stdinText: "review the patch",
  });
  const result = await session.finished;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "brief:review the patch");
});

test("shared session cancels a running child without hanging", async () => {
  const controller = new AbortController();
  const session = startCodexSession({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    signal: controller.signal,
  });
  controller.abort();
  const result = await session.finished;
  assert.equal(result.cancelled, true);
  assert.notEqual(result.exitCode, 0);
});

test("shared session enforces the deadline even if child never finishes", async () => {
  const session = startCodexSession({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 200,
  });
  const result = await session.finished;
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test("pre-aborted runs never launch a subprocess", async () => {
  const controller = new AbortController();
  controller.abort();
  const session = startCodexSession({
    command: "never-should-execute",
    args: [],
    signal: controller.signal,
  });
  const result = await session.finished;
  assert.equal(result.cancelled, true);
  assert.equal(result.error, undefined);
});

test("spawn errors are surfaced instead of waiting for child termination", async () => {
  const session = startCodexSession({
    command: "heddle-command-that-does-not-exist-8675309",
    args: [],
  });
  const result = await session.finished;
  assert.ok(result.error);
  assert.notEqual(result.exitCode, 0);
});

test("Windows npm codex.cmd shim resolves to a safe Node launcher (no shell)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "heddle-codex-shim-"));
  try {
    const js = path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(path.dirname(js), { recursive: true });
    await writeFile(path.join(dir, "codex.cmd"), "@echo off\n");
    await writeFile(js, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    const argumentsWithShellChars = ["--model", "other model", "hello & echo hacked"];
    const resolved = resolveCodexCommand("codex", argumentsWithShellChars, { PATH: dir }, "win32");
    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [js, ...argumentsWithShellChars]);
    const session = startCodexSession({
      command: resolved.command,
      args: resolved.args,
    });
    const result = await session.finished;
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), argumentsWithShellChars);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows native codex.exe is preferred to npm shims", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "heddle-codex-native-"));
  try {
    const exe = path.join(dir, "codex.exe");
    await writeFile(exe, "");
    await writeFile(path.join(dir, "codex.cmd"), "");
    const result = resolveCodexCommand("codex", ["--help"], { PATH: dir }, "win32");
    assert.equal(result.command, exe);
    assert.deepEqual(result.args, ["--help"]);
    assert.deepEqual(resolveCodexCommand(process.execPath, ["-v"], { PATH: dir }, "win32"), {
      command: process.execPath, args: ["-v"],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
