/**
 * `{placeholder}` filling for player-facing copy. Per-call vars win; globals (set once at startup from
 * the host config, e.g. `{discord}` = DISCORD_INVITE) fill what the plugin did not. Unknown placeholders
 * are left as-is so a typo is visible instead of silently blank.
 */
const globals: Record<string, unknown> = {};

export function setTemplateGlobals(vars: Record<string, unknown>): void {
  for (const key of Object.keys(globals)) delete globals[key];
  for (const [key, value] of Object.entries(vars))
    if (value !== undefined && value !== null) globals[key] = value;
}

export function templateGlobals(): Readonly<Record<string, unknown>> {
  return globals;
}

export function fill(template: string, vars: Record<string, unknown> = {}): string {
  return template.replace(/\{([^}]+)\}/g, (_all, key: string) =>
    String(vars[key] ?? globals[key] ?? `{${key}}`),
  );
}
