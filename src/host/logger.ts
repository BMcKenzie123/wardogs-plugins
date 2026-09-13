export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(prefix: string): Logger;
}
const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const format = (value: unknown): string =>
  value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);
export function createLogger(level: LogLevel, prefix = ''): Logger {
  const write = (kind: LogLevel, args: unknown[]): void => {
    if (rank[kind] < rank[level]) return;
    const p = prefix ? ` [${prefix}]` : '';
    console.log(
      `${new Date().toISOString()} ${kind.toUpperCase().padEnd(5)}${p} ${args.map(format).join(' ')}`,
    );
  };
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    child: (child) => createLogger(level, prefix ? `${prefix}:${child}` : child),
  };
}
