/** A leader can request approval interactively; headless workers cannot. */
export function codexSecurityArgs(
  interactive: boolean,
  env: { HEDDLE_CODEX_UNSAFE?: string } = process.env,
): string[] {
  // Unsafe mode is deliberately opt-in, for externally isolated environments.
  if (env.HEDDLE_CODEX_UNSAFE === "1") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  return [
    "--sandbox", "workspace-write",
    "--ask-for-approval", interactive ? "on-request" : "never",
  ];
}

/** Global sandbox/approval flags must precede the `exec` subcommand.
 * Codex CLI 0.163.0 rejects `--ask-for-approval` when passed after `exec`.
 */
export function codexHeadlessExecPrefix(
  env: { HEDDLE_CODEX_UNSAFE?: string } = process.env,
): string[] {
  return [...codexSecurityArgs(false, env), "exec"];
}
