import { definePlugin } from '../host/plugin.ts';
export default definePlugin({
  name: 'motd',
  description: 'Periodic broadcast messages',
  defaults: { intervalMinutes: 10, minPlayers: 1, messages: [] as string[] },
  setup(ctx) {
    const messages = Array.isArray(ctx.options.messages) ? ctx.options.messages : [];
    if (!messages.length) {
      ctx.log.warn('no messages configured');
      return;
    }
    ctx.every(Number(ctx.options.intervalMinutes) * 60000, async () => {
      const s = ctx.snapshot();
      if (!s || s.status.players.current < Number(ctx.options.minPlayers)) return;
      const i = ctx.state.get('index', 0);
      await ctx.rcon.broadcast(String(messages[i % messages.length]));
      ctx.state.set('index', i + 1);
    });
  },
});
