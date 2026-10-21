# Changelog

Changes are grouped by the npm CLI version.

## [Unreleased] — planned CLI 0.1.3

### Fixed
- Subagent REPORT validity now requires a nonempty summary bullet inside the `summary` section; unrelated `blockers` or `artifacts` bullets no longer trigger premature completion. (#16)
- MCP synchronous delegation waits retain their timeout handle so unresolved child promises cannot cause test/process cancellation before the wait cap. (#15)
- Codex agents without an explicit model now inherit the model selected by the user's Codex installation, instead of automatically pinning `gpt-5.5`. Older flows that explicitly pin a model are preserved. (#18)

### Maintenance
- Cross-platform build, typecheck and test checks added for Windows and Linux. (#15)
- pnpm lockfile committed and CI switched to frozen installs. (#17)
- Codex CLI 0.163.0 interface smoke check added to CI (no authenticated live execution).
- Prepared public package versions: `@aproto9787/heddle-core@0.1.1`, `@aproto9787/heddle-runtime@0.1.1`, `@aproto9787/heddle-mcp@0.1.1`, and `@aproto9787/heddle@0.1.3`.

This is release preparation, not evidence that packages have been published. See [RELEASING.md](RELEASING.md).
