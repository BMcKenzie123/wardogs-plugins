import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
export default definePlugin({
  name: 'stats-logger',
  description: 'Writes snapshots to JSONL',
  defaults: { snapshotEveryPolls: 15 },
  setup(ctx) {
    const dir = path.join(ctx.host.dataDir, 'stats');
    let n = 0;
    const write = async (x: unknown) => {
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(
        path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
        `${JSON.stringify(x)}\n`,
      );
    };
    ctx.on('tick', ({ snapshot }) => {
      if (++n % Number(ctx.options.snapshotEveryPolls) === 0)
        return write({
          t: snapshot.at,
          map: snapshot.status.map,
          matchSeconds: snapshot.status.matchSeconds,
          players: snapshot.players,
          factionScores: snapshot.status.factionScores,
        });
    });
    ctx.on('player.leave', ({ player, sessionSeconds }) =>
      write({
        t: Date.now(),
        event: 'session',
        steamId: player.steamId,
        name: player.name,
        sessionSeconds,
        kills: player.kills,
        deaths: player.deaths,
      }),
    );
  },
});
