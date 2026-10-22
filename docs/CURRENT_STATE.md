# Current code-backed state

This note is the short, code-backed baseline for Heddle's current implementation. It is meant to keep README and architecture claims honest while the project continues to change quickly.

Target product/runtime direction lives in `docs/LOCAL_AGENT_CONTROL_PLANE.md`.
Treat that document as an implementation plan, not as current shipped behavior.

## Current source of truth

The active schema lives in `packages/core/src/index.ts`.

Supported agent types:

- `codex`

Current `AgentConfig` fields:

- `name`
- `type`
- `enabled`
- `runtime`
- `role`
- `team`
- `model`
- `system`
- `flowMdRef`
- `description`
- `effort`
- `timeout`
- `parallel`
- `delegation`
- `mcps`
- `hooks`
- `skills`
- `agents`

Current `RoleDefinition` fields:

- `name`
- `type`
- `model`
- `system`
- `effort`
- `description`
- `mcps`

## Claims that should not be made yet

Do not document these as implemented unless the code changes first:

- `isolated` field in flow YAML.
- `capabilities` field in flow or role YAML.
- Cost, latency, throughput, or token-meter UI.
- DAG node execution, typed edge routing, loop/join/control nodes, or general graph runtime.
- Authenticated Codex leader → MCP → worker integration tests with sandbox/approval checks (the current golden-path test uses a simulated leader and fake workers).

## What is implemented

- A recursive agent-tree YAML schema.
- `examples/`-scoped flow CRUD and validation.
- Server run routes that create local run records and spawn the built `heddle` CLI in `--headless` mode.
- CLI-launched runs with event registration and persisted event streaming.
- `@aproto9787/heddle-runtime` as the shared home for flow loading, resource loading, prompt building, scoped MCP config generation, and hook execution.
- Provider profile discovery for local Codex installs.
- `@aproto9787/heddle-mcp` as a stdio MCP delegation bridge.
- Published npm CLI package at `@aproto9787/heddle`.
- `heddle mcp` as the CLI subcommand that exposes Heddle delegation tools to host leaders.
- Agent-specific dynamic MCP tools such as `heddle_delegate_reviewer`, alongside stable generic tools such as `heddle_delegate`.
- Best-effort async cancellation for MCP-delegated subagent processes started with `wait: false`.
- Root leader MCP config injection for Codex host sessions. Host leaders are instructed to use Heddle MCP delegation only; `heddle-subagent` is the internal worker runtime behind the MCP server.
- `heddle-subagent` as the generalized child-agent launcher.
- Goal Pursuit Mode in the default `leader-workers` flow for active `$interview-heddle`/`/goal` style work, including mandatory worker use for non-trivial goals, review/fix loops, usable verification, and user-advocate checks when goal shrinking or excessive conservatism is a risk.
- Direct Codex CLI launching in the CLI/subagent executables; the unused private adapters package has been removed.
- Minimal two-worker example in `examples/simple-team.yaml` (the larger leader-workers flow remains an advanced configuration).
- Canonical Claude-to-Codex migration and note formatting shared through `packages/core`; no independent server/CLI/subagent migration fallbacks.
- Role/hook/skill YAML CRUD.
- MCP/resource discovery and selected MCP config generation.
- SQLite run/event persistence under `.heddle/traces.db`.
- Shared Codex subprocess/event lifecycle in `packages/runtime/src/codex-session.ts` for interactive leaders, headless leaders and workers.
- Monotonic run and task terminal statuses from `packages/core/src/lifecycle.ts`, so late completion cannot overwrite cancellation.
- MCP-authored task state events and a read-only `GET /runs/:id/tasks` projection of SQLite timeline events; Studio integration is still pending.
- Unresolved worker tasks are projected as `unknown` with `reason: parent_run_terminal` only after a parent run is no longer running; this does not restart or terminate processes.
- Simulated leader/MCP/fake-worker/SQLite/SSE golden-path test on Linux and Windows.
- Shared Codex launcher now defaults to a workspace-write sandbox (interactive approvals on-request, headless approvals never); an explicit unsafe opt-in is available for externally isolated environments. Windows npm Codex shim resolution avoids shell interpolation of prompts (in Draft #26, not published).
- Actual Codex-authenticated and OS sandbox enforcement tests remain unverified.
- Risk-tier governance schemas, governance event persistence, reconstructed run manifests, and Studio run-detail governance panels.
- MCP governance tools for gate records, manifest updates, approvals, and rollback records.
- Tier C+ side-effect gate enforcement that blocks pass records until approval and rollback evidence exist.

## Active runtime ownership

The active execution path is CLI-driven. `apps/server/src/local-cli-runner.ts` still spawns the CLI for server-initiated runs, while `packages/cli/src/index.ts` and `subagent-launcher.ts` both execute Codex through the single `packages/runtime/src/codex-session.ts` session lifecycle. `packages/mcp` owns live delegate task state and emits best-effort status events; `apps/server/src/trace-store.ts` persists run state and events to SQLite. The read-only `GET /runs/:id/tasks` endpoint projects the worker states without starting a second live controller.

The redundant server `runner*.ts` façades and private `packages/adapters` package are gone. The first common session-engine slice is Draft PR #24; the state/SSE integration is stacked Draft PR #25. Neither is assumed merged merely because these docs live on their branch. Full cross-process task recovery and authenticated sandboxed Codex checks remain open.

## Safe wording for docs

Use wording like:

> On the v0.2 refactor branch, Heddle runs Codex leaders and workers through a common session lifecycle, with MCP-owned task states projected into SQLite for inspection.

Avoid wording like:

> Heddle has fully unified cross-process task ownership, generic graph orchestration, or proven authenticated sandbox enforcement.

Those would overstate the current implementation.
