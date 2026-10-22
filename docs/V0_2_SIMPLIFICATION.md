# Heddle v0.2 — Architecture Simplification Plan

Status: **design baseline**, not an announced or shipped v0.2 release.
Owner: Heddle maintainers. Scope: simplify an existing local Codex agent orchestrator, not invent a new workflow engine.

## Product contract

**One purpose:** run a local Codex leader, delegate bounded jobs to local workers through Heddle MCP, and collect their reports and run history.

Core user journeys:

1. Run a small existing team: `heddle --flow examples/simple-team.yaml`.
2. Delegate a task to an implementer or reviewer and receive a REPORT.
3. View run/worker status and history in the optional Studio UI.
4. Cancel work and enforce a meaningful execution permission boundary.

Non-goals for v0.2: generic DAG/graph execution, distributed workers, alternative model providers, full enterprise policy engines, marketing dashboards or new plugins unrelated to Codex delegation.

## Current route (v0.1.x)

```text
optional Studio
  -> Fastify server (API + SQLite + CLI process launcher)
  -> heddle CLI -> Codex leader
  -> Heddle MCP tools -> heddle-subagent -> Codex worker
  -> server run/event endpoints -> SQLite -> Studio SSE
```

Four public/private workspace packages remain after the initial cleanup (`core`, `runtime`, `mcp`, `cli`), plus `apps/server` and `apps/studio`. The removed private adapters package was not used by the active execution path.

## Target architecture

```text
Studio (optional)  CLI
        \\          /
         Heddle Engine
       /      |       \\
   Codex     MCP     RunStore
   sessions  tools    SQLite
     |
  leader + workers
```

- **Engine owns execution**: a single launcher, process lifecycle, cancellation, report validation, event normalization, and bounded concurrency. No second execution path inside the web server.
- **MCP is an interface**: JSON-RPC tool validation maps to engine commands; it does not own a second independent process/task model.
- **Studio/API are optional surfaces**: thin adapters for the same engine; CLI must work without a running browser or Fastify server.
- **One configuration contract**: flow definition/migration/validation live in a single module (currently `packages/core`). Leader and child consume one normalized structure.
- **One run state**: task IDs, ownership, status and events are defined once. Avoid tracking equivalent state independently in CLI, MCP and Fastify.
- **Safe-by-default**: do not remove approval/rollback enforcement while consolidating governance; never silently preserve unrestricted Codex execution as a safe default.

This describes the **target**, not the current implementation.

## Stage 1 — Remove no-op layers (merged in #21)

- [x] Delete the unused private `packages/adapters` package and stale TypeScript references.
- [x] Delete redundant server `runner*.ts` re-export façades; tests import the canonical runtime package.
- [x] Replace server/CLI/subagent legacy migration fallbacks with one `core` migration function and formatter.
- [x] Add a minimal two-worker flow without requiring role, team, governance, hook or skill boilerplate.
- [x] Validate frozen pnpm installation, workspace build, typecheck and tests on Linux/Windows in CI.

These steps intentionally avoid changing public npm entry points, runtime ownership or permission behavior. Do **not** remove `apps/server/src/local-cli-runner.ts`: it is the live server-to-CLI launcher.

## Stage 2 — Single execution owner (in progress, #24)

1. Define `RunRequest`, `AgentTask`, `RunEvent` and terminal states in the engine. Explicit owner for task IDs and cancellation.
2. Extract Codex spawn/stream/report logic from both `packages/cli/src/index.ts` and `subagent-launcher.ts` into one tested engine module.
3. Route leader and delegated worker through the same session runtime; keep distinct leader/worker permission profiles.
4. Make MCP `delegate/get_status/read_report/cancel` operate on the engine task table.
5. Reduce the Fastify server to API, persistent storage and SSE. Remove obsolete compatibility runners **only after** real callers and tests move.
6. Add mocked Codex golden-path tests for leader → worker → report, cancellation, timeout and crash recovery. Verify behavior on Windows.

PR #24 extracts shared Codex command arguments, JSON stream framing/parsing, subprocess exit/cancel/timeout handling and routes interactive leaders, headless leaders and workers through that runtime. The MCP-created task ID is propagated to worker results, and cancelled task state cannot be overwritten by a late report. Unit tests and fake worker subprocess tests run on Linux/Windows.

Still **not complete**: MCP/CLI/Studio run state ownership remains split, a full fake leader → real MCP → worker → persisted UI history golden path is missing, and authenticated sandboxed Codex end-to-end behavior has not been proven. This PR intentionally leaves the separate safety PR #20 unchanged.

Do not merge until all old tests and new end-to-end tests pass. Preserve existing REST endpoints and CLI flags during the transition.

## Stage 3 — Minimal default configuration

The default flow should need only `name`, `repo`, `orchestrator`, and a small `agents` list. Optional advanced fields remain available but should not be injected into basic flows unless requested.

- A beginner sees only "leader + workers" and run history.
- The existing detailed `leader-workers.yaml` becomes an *advanced example* rather than the default documentation path.
- Keep legacy YAML ingestion through the core migration once, at the loading boundary.
- Separate user-visible necessary approvals from optional governance analytics. Never weaken action authorization.

## Stage 4 — Packaging/UI consolidation (breaking-release candidate)

After the engine is proven, consider reducing the publishable runtime surface to a single CLI npm package, keeping internals private, and packaging Studio/server as optional components. Existing published `@aproto9787/heddle-core`, `-runtime` and `-mcp` consumers need an explicit compatibility strategy before a v0.2 major structural release.

## Measurable acceptance criteria

- **One** place implements Codex process spawning / execution policy for both leader and worker.
- **One** authoritative task/run state model and **one** cancellation path.
- Basic flow under **30 YAML lines**, no mandatory governance boilerplate.
- No dead package/project references and no duplicated legacy migration implementations.
- Same working CLI commands, server endpoints and MCP tool names unless a breaking migration is documented.
- Frozen install + build + typecheck + tests pass on both Windows and Linux.
- Real Codex 0.163.0+ smoke in a trusted isolated workspace before any security-sensitive release.

## Release boundaries

Current open PRs `#19` (release preparation) and `#20` (sandboxed defaults) are independent of this refactor and must not be assumed merged. Rebase/retest prior to a release. This plan is intentionally independent of npm publishing.
