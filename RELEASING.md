# Release procedure

Heddle publishes a pnpm workspace. This checklist applies to the **planned** CLI v0.1.3 release and the related runtime packages. Publishing must be performed by an authorized npm maintainer.

## 1. Preconditions

1. Confirm `master` passes the Ubuntu and Windows build, typecheck, test and Codex CLI smoke jobs.
2. Verify no unsupported version has already been published:
   ```bash
   npm view @aproto9787/heddle-core version
   npm view @aproto9787/heddle-runtime version
   npm view @aproto9787/heddle-mcp version
   npm view @aproto9787/heddle version
   ```
   Planned versions: core/runtime/mcp `0.1.1`, CLI `0.1.3`. Change the planned versions if any are already occupied.
3. Confirm `git status --short` is clean and inspect the proposed change log.
4. Verify your local Codex CLI supports the Heddle invocation arguments. CI checks the CLI 0.163.0 help interface; a real authenticated end-to-end delegation smoke test is still required on a trusted test repository.

## 2. Reproducible checks

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm -r build
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm --filter @aproto9787/heddle pack
```

Inspect the CLI pack archive, its `dist/` output, bundled example flow and manifest dependencies. Use a throwaway test environment; Heddle's current Codex launch configuration bypasses the built-in approval/sandbox boundary (see the security note below).

## 3. Publish order

Release public workspace dependencies **before** the CLI, to ensure its dependency ranges resolve:

```bash
corepack pnpm publish:npm:core
corepack pnpm publish:npm:runtime
corepack pnpm publish:npm:mcp
corepack pnpm publish:npm:cli
```

Do not rerun a partially successful batch without first checking published versions. The root `pnpm publish:npm` shortcut performs this same sequence but offers less opportunity to stop between packages.

## 4. Verify publication

Check `npm view` for all four package versions, install `@aproto9787/heddle@0.1.3` from npm in a clean environment, verify `heddle --version` reports `0.1.3`, and run a small real Codex delegation workflow in a **trusted, externally isolated** test repository. Only after the packages and runtime smoke pass should you create a `v0.1.3` GitHub tag/release.

## Security note and release gate

The current interactive/headless leader and subagent launch paths still include `--dangerously-bypass-approvals-and-sandbox`. It intentionally bypasses Codex security protections. Heddle must not be run against untrusted flows or repositories without external isolation. Before promoting v0.1.3 beyond an experimental release, review and ideally replace this default with a sandboxed/permission-aware launch path. This preparation PR does **not** change that runtime behavior.

## Limits of CI

The Codex CLI smoke job validates installed binary/version and documented CLI flags only. It does not authenticate, call a model, execute agents, validate delegated tool permissions, or verify prompts end-to-end.
