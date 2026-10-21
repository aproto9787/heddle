/** A leader can request approval interactively; headless workers cannot. */
export function codexSecurityArgs(
  interactive: boolean,
  env: Pick<NodeJS.ProcessEnv, "HEDDLE_CODEX_UNSAFE"> = process.env,
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
