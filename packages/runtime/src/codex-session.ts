import { spawn, type StdioOptions } from "node:child_process";

/** Shared lifecycle for interactive leaders, headless leaders and Codex workers. */
export interface CodexSessionOptions {
  command?: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  stdinText?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  captureOutput?: boolean;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  onStdoutLine?: (line: string) => void;
}

export interface CodexSessionResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  error?: Error;
}

export interface CodexSession {
  finished: Promise<CodexSessionResult>;
  stop: (graceMs?: number) => void;
  cancel: () => void;
  isRunning: () => boolean;
}

/**
 * Heddle launches Codex with a workspace sandbox by default.
 * These are Codex global flags: they must come before the 'exec' subcommand.
 *
 * HEDDLE_CODEX_UNSAFE=1 is a deliberate compatibility escape hatch only for
 * separately isolated environments. Normal local sessions must not bypass
 * approvals or the OS sandbox.
 */
export interface CodexSecurityEnv {
  HEDDLE_CODEX_UNSAFE?: string;
}

export function codexSecurityArgs(
  interactive: boolean,
  env: CodexSecurityEnv = process.env,
): string[] {
  if (env.HEDDLE_CODEX_UNSAFE === "1") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  return [
    "--sandbox", "workspace-write",
    "--ask-for-approval", interactive ? "on-request" : "never",
  ];
}

/** One Codex invocation contract for leaders and delegated workers. */
export function codexArgs(input: {
  mode: "interactive" | "exec";
  model?: string;
  prompt?: string;
  stdinPrompt?: boolean;
  env?: CodexSecurityEnv;
}): string[] {
  const model = input.model?.trim();
  const modelArgs = model ? ["--model", model] : [];
  const security = codexSecurityArgs(input.mode === "interactive", input.env);
  if (input.mode === "interactive") {
    return [...security, ...modelArgs];
  }
  return [
    ...security,
    "exec",
    "--json",
    "--skip-git-repo-check",
    ...modelArgs,
    input.stdinPrompt ? "-" : (input.prompt ?? ""),
  ];
}

/** Shared Codex JSON stream parser used by both leaders and workers. */
export interface CodexStreamEvent {
  type: "assistant" | "tool_use" | "tool_result";
  summary: string;
  toolName?: string;
  timestamp: number;
  raw: Record<string, unknown>;
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1) + "…";
}

export function parseCodexStreamLine(line: string, maxSummaryLength = 160): CodexStreamEvent | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as Record<string, unknown>;
  if (raw.type !== "item.completed" || !raw.item || typeof raw.item !== "object") {
    return undefined;
  }
  const item = raw.item as Record<string, unknown>;
  const kind = typeof item.type === "string" ? item.type : "unknown";
  const time = typeof raw.timestamp === "number" ? raw.timestamp
    : typeof raw.timestamp === "string" ? Date.parse(raw.timestamp) : NaN;
  const timestamp = Number.isFinite(time) ? time : Date.now();
  const event = (type: CodexStreamEvent["type"], summary: string, toolName?: string): CodexStreamEvent => ({
    type, summary: compact(summary, maxSummaryLength), toolName, timestamp, raw,
  });

  if (kind === "agent_message") {
    const message = typeof item.text === "string" ? item.text : "";
    return message.trim() ? event("assistant", message) : undefined;
  }
  if (kind === "message" && item.role === "assistant") {
    const blocks = Array.isArray(item.content) ? item.content : [];
    const message = blocks.map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        return typeof block.text === "string" ? block.text : "";
      }
      return "";
    }).filter(Boolean).join(" ");
    return message.trim() ? event("assistant", message) : undefined;
  }
  if (kind === "reasoning") {
    return event("assistant", "reasoning: " + (typeof item.text === "string" ? item.text : "reasoning"), "reasoning");
  }
  if (kind === "command_execution") {
    return event("tool_use", typeof item.command === "string" ? item.command : "command", "Bash");
  }
  if (kind === "file_change") {
    const operation = typeof item.operation === "string" ? item.operation : "edit";
    const path = typeof item.path === "string" ? item.path : "";
    return event("tool_result", operation + " " + path, "Edit");
  }
  return event("tool_use", typeof item.summary === "string" ? item.summary : kind, kind);
}

export function startCodexSession(options: CodexSessionOptions): CodexSession {
  let running = false;
  let stopped = false;
  let cancelled = Boolean(options.signal?.aborted);
  let timedOut = false;
  let stdout = "";
  let stderr = "";
  let lineBuffer = "";
  let error: Error | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  let endSession!: (result: CodexSessionResult) => void;
  const finished = new Promise<CodexSessionResult>((resolve) => { endSession = resolve; });

  // Do not launch a process when the caller already cancelled the task.
  if (cancelled) {
    endSession({ exitCode: 1, signal: null, stdout: "", stderr: "", cancelled: true, timedOut: false });
    return { finished, stop: () => undefined, cancel: () => undefined, isRunning: () => false };
  }

  const child = spawn(options.command ?? "codex", options.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  running = true;

  const stop = (graceMs = 3_000) => {
    if (!running || stopped) return;
    stopped = true;
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
    if (graceMs >= 0) {
      forceKillTimer = setTimeout(() => {
        if (!running) return;
        try { child.kill("SIGKILL"); } catch { /* process already exited */ }
      }, graceMs);
    }
  };
  const cancel = () => {
    if (!running) return;
    cancelled = true;
    stop();
  };
  const onAbort = () => cancel();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) cancel();

  const emitLine = (line: string) => {
    if (line.trim()) options.onStdoutLine?.(line.replace(/\r$/, ""));
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (options.captureOutput !== false) stdout += chunk;
    options.onStdoutChunk?.(chunk);
    lineBuffer += chunk;
    let next = lineBuffer.indexOf("\n");
    while (next >= 0) {
      emitLine(lineBuffer.slice(0, next));
      lineBuffer = lineBuffer.slice(next + 1);
      next = lineBuffer.indexOf("\n");
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (options.captureOutput !== false) stderr += chunk;
    options.onStderrChunk?.(chunk);
  });

  if (options.stdinText !== undefined) {
    child.stdin?.on("error", () => undefined); // Codex can exit before consuming stdin.
    child.stdin?.end(options.stdinText);
  }
  if (options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
  }

  // 'close', unlike 'exit', guarantees that buffered stdout/stderr were drained.
  child.once("error", (failure: Error) => { error = failure; });
  child.once("close", (code, signal) => {
    running = false;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    options.signal?.removeEventListener("abort", onAbort);
    emitLine(lineBuffer);
    endSession({
      exitCode: signal || error ? 1 : (code ?? 1),
      signal,
      stdout,
      stderr,
      cancelled,
      timedOut,
      error,
    });
  });
  return { finished, stop, cancel, isRunning: () => running };
}
