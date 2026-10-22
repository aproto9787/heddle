# Heddle architecture — current v0.1.x implementation

This describes the source on the stacked v0.2 refactor branches (#24 and #25), not the current published npm CLI. For the planned v0.2 target, read [V0_2_SIMPLIFICATION.md](V0_2_SIMPLIFICATION.md). Do not confuse that target with shipped behavior.

## What it does

Heddle runs a local Codex leader with YAML-defined child agents. The leader delegates through Heddle MCP tools, and each child runs a separate Codex process. Reports and timeline events are recorded for local inspection.

## Execution route

```text
Browser Studio (optional)
    |
    v HTTP / SSE
Fastify server --------------> SQLite .heddle/traces.db
    |
    v spawns CLI for POST /runs
heddle CLI ------------------> Codex leader
                                   |
                                   v Heddle MCP delegation
                               MCP server -> task record
                                   |
                                   v runtime subagent runner
                            heddle-subagent -> Codex child
                                   |
                                   v reports / events
                             server -> SQLite -> Studio
```

From a terminal, `heddle` can also launch the root Codex session directly; Studio and a running server are not prerequisites for starting an interactive session. Event posting is best-effort if no run server is available.

## Source modules

| Location | Responsibility |
| --- | --- |
| `packages/core` | Agent/flow/role schemas; validation; legacy migration and notes; run/governance types |
| `packages/runtime` | Flow loading, shared Codex session lifecycle and event parsing, resource selection, provider discovery and worker execution |
| `packages/mcp` | Delegation JSON-RPC, authoritative in-process live task state, status events and governance RPCs |
| `packages/cli` | `heddle` and `heddle-subagent` commands, Codex homes and launcher glue |
| `apps/server` | Fastify endpoints, flow/resource CRUD, CLI launching, SSE and SQLite persistence |
| `apps/studio` | Browser UI and client state |

The previously unused private `packages/adapters` package and server `runner*.ts` re-export wrappers were removed. Tests now import canonical runtime helpers directly. There is no active second in-process server workflow engine. `apps/server/src/local-cli-runner.ts` **is active**: the server uses it to spawn the CLI.

## Current contracts

The active schema is `packages/core/src/index.ts`. Agent type is `codex`. A flow has a root `orchestrator` with recursive child `agents`. Model/role/team/runtime options are optional; the minimal [simple-team flow](../examples/simple-team.yaml) demonstrates the smallest useful team. Advanced governance flows remain available in `examples/leader-workers.yaml`.

Legacy `claude-code` inputs are migrated only through the exported core migration functions (also used by `packages/runtime/src/flow-loader.ts`). The caller may render migration notes using a shared core formatter; schema validation always follows conversion.

`heddle mcp` exposes typed direct-child tools, delegation/status/report/cancel APIs and governance tools. Workers produce structured REPORT text. Core lifecycle transitions are shared across MCP and server. MCP owns live task state; the server stores a read-only projection of task status events, and does not run a second task controller.

## Persistence and UI

`apps/server/src/trace-store.ts` writes run records and events into `.heddle/traces.db` using `node:sqlite`. Aborted runs become terminal before child termination, and late CLI status cannot overwrite them. In addition to existing run/event/SSE routes, `GET /runs/:id/tasks` returns the persisted worker status projection; Studio does not yet consume this endpoint.

Role, hook and skill files are optional resources, not required for a basic two-worker flow. Hook commands, when configured, execute local shell commands and must be considered trusted input.

## Known technical debt

- One shared Codex session launcher is implemented in `packages/runtime/src/codex-session.ts`; an authenticated real-Codex leader/worker run has not yet been verified.
- Live MCP task ownership and persistent server run records still run in different processes. Shared monotonic lifecycle rules and SQLite projection are in place, but durable cross-process recovery is not.
- `apps/server/src/index.ts` combines API routing, governance and orchestration bookkeeping in a single large module.
- The 450-line advanced example is inappropriate as a basic getting-started flow.
- A simulated leader → actual MCP → fake worker → SQLite/SSE golden path now runs in CI; actual CLI/Studio and authenticated Codex end-to-end still need validation.
- Packaging remains a multi-package pnpm workspace; reducing published surface requires a separate compatibility review.

## Security / compatibility

At the time of this document, `master` still starts Codex with an approval/sandbox bypass in some paths. Security-hardening PR #20 is **not assumed merged**. Treat this as a trusted local tool; do not run untrusted flows or repositories without external isolation.

The staged [v0.2 plan](V0_2_SIMPLIFICATION.md) preserves current CLI commands, REST endpoints and MCP tools until an intentional breaking release. Any permission changes require real integration tests, not only mocked unit tests.

## Development checks

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm test:golden
```

Linux and Windows CI are required before merging structural changes.
