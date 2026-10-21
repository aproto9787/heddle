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
- Automated golden-path test coverage for leader → workers.

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
- Risk-tier governance schemas, governance event persistence, reconstructed run manifests, and Studio run-detail governance panels.
- MCP governance tools for gate records, manifest updates, approvals, and rollback records.
- Tier C+ side-effect gate enforcement that blocks pass records until approval and rollback evidence exist.

## Active runtime split

The active execution path is CLI-driven. `apps/server/src/local-cli-runner.ts` launches the CLI for server-initiated runs. `packages/cli/src/index.ts` launches the Codex leader, `packages/mcp` handles delegation tools and task status, and `packages/cli/src/subagent-launcher.ts` handles delegated child execution. `packages/runtime` supplies shared loaders, prompts and subprocess helpers. `apps/server/src/trace-store.ts` persists events.

The redundant server-side `runner*.ts` façade modules and the unused private `packages/adapters` workspace package have been removed. No replacement runtime is shipped in this cleanup. A single Codex session engine is a planned **future** change under [V0_2_SIMPLIFICATION.md](V0_2_SIMPLIFICATION.md).

## Safe wording for docs

Use wording like:

> Heddle currently runs recursive YAML-defined Codex agent teams using a CLI leader, MCP delegation and child Codex processes.

Avoid wording like:

> Heddle already has one unified execution engine, generic graph orchestration or proven end-to-end sandbox enforcement.

Those would overstate the current implementation.
