import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
export default definePlugin({
  name: 'audit-tail',
  description: 'Logs audit entries',
  defaults: { toFile: true },
  setup(ctx) {
    ctx.on('audit.entry', ({ entry }) => {
      ctx.log.info(`audit ${entry.event} by ${entry.peer}: ${entry.detail}`);
      if (ctx.options.toFile)
        return fs.appendFile(path.join(ctx.host.dataDir, 'audit.jsonl'), `${JSON.stringify(entry)}\n`);
    });
  },
});
