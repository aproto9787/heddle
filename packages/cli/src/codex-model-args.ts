/** Pass a model override only when the flow explicitly configures one.
 * Otherwise let Codex resolve its own user profile/configuration default.
 */
export function codexModelArgs(model: string | undefined): string[] {
  const selected = model?.trim();
  return selected ? ["--model", selected] : [];
}
