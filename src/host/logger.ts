export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(prefix: string): Logger;
}

/** Receives every formatted line the logger prints; used to keep a recent-activity buffer. */
export type LogSink = (line: string) => void;

const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const format = (value: unknown): string =>
  value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);

export function createLogger(level: LogLevel, prefix = '', sink?: LogSink): Logger {
  const write = (kind: LogLevel, args: unknown[]): void => {
    if (rank[kind] < rank[level]) return;
    const p = prefix ? ` [${prefix}]` : '';
    const line = `${new Date().toISOString()} ${kind.toUpperCase().padEnd(5)}${p} ${args.map(format).join(' ')}`;
    console.log(line);
    sink?.(line);
  };
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    child: (child) => createLogger(level, prefix ? `${prefix}:${child}` : child, sink),
  };
}

/** Fixed-size ring of recent log lines, newest last. */
export class LogBuffer {
  private lines: string[] = [];
  private max: number;
  constructor(max = 300) {
    this.max = max;
  }
  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
  recent(n = 50): string[] {
    return this.lines.slice(-n);
  }
}
