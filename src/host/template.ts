export function fill(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_all, key: string) => String(vars[key] ?? `{${key}}`));
}
