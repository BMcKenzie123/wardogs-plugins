import fs from 'node:fs/promises';
import path from 'node:path';
import { isNoiseAudit } from '../host/audit.ts';
import { definePlugin } from '../host/plugin.ts';

interface Options {
  /** Also append every kept entry to data/audit.jsonl. */
  toFile: boolean;
  /** Skip connection/auth-ok bookkeeping and read-only HTTP calls (this host's own polling). */
  skipNoise: boolean;
}

/** Logs each new admin-action audit entry as it appears; optionally to a file. */
export default definePlugin<Options>({
  name: 'audit-tail',
  description: 'Logs audit entries (writes and failed auths; polling noise skipped)',
  defaults: { toFile: true, skipNoise: true },
  setup(ctx) {
    ctx.on('audit.entry', ({ entry }) => {
      if (ctx.options.skipNoise && isNoiseAudit(entry)) return;
      ctx.log.info(`audit ${entry.event} by ${entry.peer}: ${entry.detail}`);
      if (ctx.options.toFile)
        return fs.appendFile(path.join(ctx.host.dataDir, 'audit.jsonl'), `${JSON.stringify(entry)}\n`);
    });
  },
});
