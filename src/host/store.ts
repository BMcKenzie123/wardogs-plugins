import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from './logger.ts';
export class Store {
  private data: Record<string, unknown> = {};
  private dirty = false;
  private timer?: NodeJS.Timeout;
  private filePath: string;
  private logger: Logger;
  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger;
  }
  async load(): Promise<void> {
    try {
      const x: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (x && typeof x === 'object' && !Array.isArray(x)) this.data = x as Record<string, unknown>;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn('could not load state', e);
    }
  }
  get<T>(key: string, fallback: T): T {
    return key in this.data ? (this.data[key] as T) : fallback;
  }
  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.mark();
  }
  delete(key: string): void {
    delete this.data[key];
    this.mark();
  }
  private mark(): void {
    this.dirty = true;
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 500);
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.filePath);
  }
}
