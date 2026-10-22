import type { RunStatus, TimelineEvent } from "./index.js";

/** A common, monotonic lifecycle contract for local delegated tasks. */
export type AgentTaskStatus =
  | "running" | "done" | "blocked" | "needs_decision"
  | "error" | "cancelled" | "unknown";

export type AgentTaskTerminalStatus = Exclude<AgentTaskStatus, "running">;

export function transitionTaskStatus(
  current: AgentTaskStatus,
  requested: AgentTaskStatus,
): AgentTaskStatus {
  return current === "running" ? requested : current;
}

/** A terminal run state must not be overwritten by a late process callback. */
export function transitionRunStatus(current: RunStatus, requested: RunStatus): RunStatus {
  return current === "running" ? requested : current;
}

export interface AgentTaskSnapshot {
  taskId: string;
  agent: string;
  status: AgentTaskStatus;
  parentAgent?: string;
  /** Derived-only: the parent run ended without a terminal worker event. */
  reason?: "parent_run_terminal";
}

export const TASK_STATUS_TOOL = "heddle-task";

/** Existing timeline event types carry task state; no new wire protocol. */
export function taskStatusEvent(
  runId: string,
  task: AgentTaskSnapshot,
  ts = Date.now(),
): TimelineEvent {
  return {
    runId,
    ts,
    type: task.status === "running" ? "tool_use" : "tool_result",
    toolName: TASK_STATUS_TOOL,
    agentName: task.agent,
    parentAgent: task.parentAgent,
    summary: `${task.agent} ${task.status}`,
    raw: {
      taskId: task.taskId,
      agent: task.agent,
      status: task.status,
      ...(task.parentAgent ? { parentAgent: task.parentAgent } : {}),
    },
  };
}

/**
 * Reconstruct a read-only task projection from persisted run events.
 * Missing worker completion is reported as unknown only when the parent run
 * is already terminal. This does NOT restart or kill any external processes.
 */
export function projectTaskStatuses(
  events: readonly TimelineEvent[],
  runStatus: RunStatus = "running",
): AgentTaskSnapshot[] {
  const tasks = new Map<string, AgentTaskSnapshot>();
  for (const event of events) {
    if (event.toolName !== TASK_STATUS_TOOL || !event.raw ||
        typeof event.raw !== "object" || Array.isArray(event.raw)) continue;
    const raw = event.raw as Record<string, unknown>;
    const taskId = raw.taskId;
    const agent = raw.agent;
    const status = raw.status;
    if (typeof taskId !== "string" || !taskId ||
        typeof agent !== "string" || !agent ||
        typeof status !== "string" ||
        !["running", "done", "blocked", "needs_decision", "error", "cancelled", "unknown"].includes(status)) {
      continue;
    }
    const previous = tasks.get(taskId);
    const nextStatus = status as AgentTaskStatus;
    tasks.set(taskId, {
      taskId,
      agent,
      status: previous ? transitionTaskStatus(previous.status, nextStatus) : nextStatus,
      parentAgent: typeof raw.parentAgent === "string" ? raw.parentAgent : previous?.parentAgent,
    });
  }
  if (runStatus === "running") return [...tasks.values()];
  // Do not persist inferred terminal worker statuses: a delayed genuine
  // worker report may still arrive and should replace this read-only guess.
  return [...tasks.values()].map((task) => task.status === "running"
    ? { ...task, status: "unknown" as const, reason: "parent_run_terminal" as const }
    : task);
}
