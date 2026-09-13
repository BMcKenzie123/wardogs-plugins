import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';

interface Options {
  checkMinutes: number;
  keep: number;
}

/** Line-set diff: which lines appeared and which disappeared. Order changes don't count. */
export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const a = new Set(before.split(/\r?\n/).filter((l) => l.trim()));
  const b = new Set(after.split(/\r?\n/).filter((l) => l.trim()));
  return { added: [...b].filter((l) => !a.has(l)), removed: [...a].filter((l) => !b.has(l)) };
}

/**
 * Keeps a copy of every ServerSettings.ini revision the server reports, so a bad edit from the
 * panel or from `wd config put` can be rolled back and so you can see what changed.
 */
export default definePlugin<Options>({
  name: 'config-backup',
  description: 'Saves every new config revision to data/config/ with a diff summary',
  defaults: { checkMinutes: 10, keep: 50 },
  setup(ctx) {
    const directory = path.join(ctx.host.dataDir, 'config');
    ctx.every(
      Number(ctx.options.checkMinutes) * 60_000,
      async () => {
        if (!ctx.snapshot()) return; // unreachable; try later
        const doc = await ctx.rcon.config();
        const lastRevision = ctx.state.get<string>('revision', '');
        if (lastRevision === doc.revision) return;

        await fs.mkdir(directory, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeRevision = String(doc.revision).replace(/[^A-Za-z0-9_.-]/g, '_');
        await fs.writeFile(path.join(directory, `${stamp}-${safeRevision}.ini`), doc.text);

        const previous = ctx.state.get<string>('text', '');
        const { added, removed } = lineDiff(previous, doc.text);
        ctx.state.set('revision', doc.revision);
        ctx.state.set('text', doc.text);
        const detail = lastRevision ? ` (+${added.length} −${removed.length} lines vs ${lastRevision})` : '';
        ctx.log.info(`backed up config revision ${doc.revision}${detail}`);
        for (const line of [...added.map((l) => `+ ${l}`), ...removed.map((l) => `- ${l}`)].slice(0, 5))
          ctx.log.info(`  ${line}`);

        const files = (await fs.readdir(directory)).filter((f) => f.endsWith('.ini')).sort();
        for (const file of files.slice(0, Math.max(0, files.length - Number(ctx.options.keep))))
          await fs.unlink(path.join(directory, file));
      },
      { immediate: true },
    );
    ctx.log.info(`checking every ${ctx.options.checkMinutes} min, keeping ${ctx.options.keep} backups`);
  },
});
