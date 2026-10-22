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

/** Reconstruct a read-only task projection from persisted run timeline events. */
export function projectTaskStatuses(events: readonly TimelineEvent[]): AgentTaskSnapshot[] {
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
  return [...tasks.values()];
}
