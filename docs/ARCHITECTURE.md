# Heddle architecture — current v0.1.x implementation

This is the **as-built** architecture after the first simplification pass. For the planned v0.2 target, read [V0_2_SIMPLIFICATION.md](V0_2_SIMPLIFICATION.md). Do not confuse that target with shipped behavior.

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
| `packages/runtime` | Flow loading, configured agents, resource selection, provider discovery and subagent process execution |
| `packages/mcp` | Delegation JSON-RPC, tool definitions, async task state and governance RPCs |
| `packages/cli` | `heddle` and `heddle-subagent` commands, Codex homes and launcher glue |
| `apps/server` | Fastify endpoints, flow/resource CRUD, CLI launching, SSE and SQLite persistence |
| `apps/studio` | Browser UI and client state |

The previously unused private `packages/adapters` package and server `runner*.ts` re-export wrappers were removed. Tests now import canonical runtime helpers directly. There is no active second in-process server workflow engine. `apps/server/src/local-cli-runner.ts` **is active**: the server uses it to spawn the CLI.

## Current contracts

The active schema is `packages/core/src/index.ts`. Agent type is `codex`. A flow has a root `orchestrator` with recursive child `agents`. Model/role/team/runtime options are optional; the minimal [simple-team flow](../examples/simple-team.yaml) demonstrates the smallest useful team. Advanced governance flows remain available in `examples/leader-workers.yaml`.

Legacy `claude-code` inputs are migrated only through the exported core migration functions (also used by `packages/runtime/src/flow-loader.ts`). The caller may render migration notes using a shared core formatter; schema validation always follows conversion.

`heddle mcp` exposes typed dynamic direct-child tools and stable delegation, status, report and cancellation tools. Workers produce structured REPORT text. Concurrent state still exists in more than one runtime surface and will be consolidated in v0.2.

## Persistence and UI

`apps/server/src/trace-store.ts` writes run records and events into `.heddle/traces.db` using `node:sqlite`. The server exposes APIs for running/cancelling, status, flow editing, resources, governance records and SSE events. Studio consumes these APIs; it does not directly execute Codex.

Role, hook and skill files are optional resources, not required for a basic two-worker flow. Hook commands, when configured, execute local shell commands and must be considered trusted input.

## Known technical debt

- Leader and subagent each have their own Codex spawn/event-handling path in `packages/cli`; v0.2 should extract **one session engine** for both.
- MCP tasks, CLI process lifecycle and server run records each own pieces of state; converge on one task lifecycle and cancellation contract.
- `apps/server/src/index.ts` combines API routing, governance and orchestration bookkeeping in a single large module.
- The 450-line advanced example is inappropriate as a basic getting-started flow.
- A mocked Codex golden-path test for leader -> delegation -> worker -> report -> UI update is still missing.
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
```

Linux and Windows CI are required before merging structural changes.
