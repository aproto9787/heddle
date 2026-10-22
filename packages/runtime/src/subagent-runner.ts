import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "@aproto9787/heddle-core";
import { startCodexSession } from "./codex-session.js";

export type SubagentBackend = "codex";

export interface ParsedSubagentReport {
  status: "done" | "blocked" | "needs_decision" | "unknown";
  summary: string[];
  artifacts: string[];
  blockers: string[];
  raw: string;
}

export interface RunSubagentTaskOptions {
  agent: AgentConfig;
  taskId?: string;
  parentAgent: string;
  briefing: string;
  flowPath: string;
  cwd: string;
  runId?: string;
  serverOrigin?: string;
  subagentBin: string;
  parentDepth?: number;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export interface RunSubagentTaskResult {
  taskId: string;
  agent: string;
  status: "done" | "blocked" | "needs_decision" | "error" | "cancelled" | "unknown";
  exitCode: number;
  report: ParsedSubagentReport;
  reportPath: string;
  stdout: string;
  stderr: string;
}

export function backendForAgent(agent: AgentConfig): SubagentBackend {
  return "codex";
}

export function parseSubagentReport(raw: string): ParsedSubagentReport {
  const lines = raw.split(/\r?\n/);
  const summary: string[] = [];
  const artifacts: string[] = [];
  const blockers: string[] = [];
  let status: ParsedSubagentReport["status"] = "unknown";
  let section: "summary" | "artifacts" | "blockers" | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    const statusMatch = /^status:\s*(done|blocked|needs_decision)\s*$/i.exec(trimmed);
    if (statusMatch) {
      status = statusMatch[1] as ParsedSubagentReport["status"];
      section = undefined;
      continue;
    }
    if (/^summary:\s*$/i.test(trimmed)) {
      section = "summary";
      continue;
    }
    if (/^artifacts:\s*$/i.test(trimmed)) {
      section = "artifacts";
      continue;
    }
    if (/^blockers:\s*$/i.test(trimmed)) {
      section = "blockers";
      continue;
    }
    const bullet = /^\s*-\s*(.+?)\s*$/.exec(line)?.[1];
    if (!bullet || !section) {
      continue;
    }
    if (section === "summary") summary.push(bullet);
    if (section === "artifacts") artifacts.push(bullet);
    if (section === "blockers") blockers.push(bullet);
  }

  return { status, summary, artifacts, blockers, raw };
}

export async function runSubagentTask(options: RunSubagentTaskOptions): Promise<RunSubagentTaskResult> {
  const taskId = options.taskId ?? randomUUID();
  const reportDir = await mkdtemp(path.join(os.tmpdir(), "heddle-mcp-subagent-"));
  const reportPath = path.join(reportDir, `${options.agent.name}-${taskId}.txt`);
  await mkdir(reportDir, { recursive: true });

  if (options.signal?.aborted) {
    return {
      taskId,
      agent: options.agent.name,
      status: "cancelled",
      exitCode: 1,
      report: parseSubagentReport(""),
      reportPath,
      stdout: "",
      stderr: "cancelled before subagent launch",
    };
  }

  const args = [
    options.subagentBin,
    "--name", options.agent.name,
    "--backend", backendForAgent(options.agent),
    "--parent", options.parentAgent,
    "--report", reportPath,
    "--briefing", options.briefing,
  ];
  if (options.agent.model) {
    args.push("--model", options.agent.model);
  }
  if (options.timeoutSeconds) {
    args.push("--max-seconds", String(options.timeoutSeconds));
  }

  const env = {
    ...process.env,
    HEDDLE_FLOW_PATH: options.flowPath,
    HEDDLE_FLOW_CWD: options.cwd,
    HEDDLE_AGENT: options.parentAgent,
    HEDDLE_PARENT_AGENT: options.parentAgent,
    HEDDLE_PARENT_DEPTH: String(options.parentDepth ?? 0),
    HEDDLE_SUBAGENT_BIN: options.subagentBin,
    ...(options.runId ? { HEDDLE_RUN_ID: options.runId } : {}),
    ...(options.serverOrigin ? { HEDDLE_SERVER_ORIGIN: options.serverOrigin } : {}),
  };

  const session = startCodexSession({
    command: process.execPath,
    args,
    cwd: options.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    signal: options.signal,
  });
  const { exitCode, stdout, stderr, cancelled, error } = await session.finished;
  if (error) throw error;

  let reportRaw = stdout;
  try {
    reportRaw = await readFile(reportPath, "utf8");
  } catch {
    // stdout is the fallback because heddle-subagent writes the final report there.
  }

  const report = parseSubagentReport(reportRaw);
  const status = cancelled
    ? "cancelled"
    : exitCode === 0
    ? report.status
    : report.status === "unknown"
      ? "error"
      : report.status;

  return {
    taskId,
    agent: options.agent.name,
    status,
    exitCode,
    report,
    reportPath,
    stdout,
    stderr,
  };
}
