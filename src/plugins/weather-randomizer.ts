import { definePlugin } from '../host/plugin.ts';

interface Options {
  lightings: string[];
  /** Same length as `lightings` to weight the draw; empty = uniform. */
  weights: number[];
  excludeCurrent: boolean;
  /** Wait this long after a new match before changing the lighting, so nothing is sent while players are still loading in. */
  delaySeconds: number;
}

/** Weighted random pick. Falls back to uniform when `weights` doesn't line up with `items`. */
export function pickWeighted<T>(
  items: T[],
  weights: number[],
  rng: () => number = Math.random,
): T | undefined {
  if (!items.length) return undefined;
  if (weights.length !== items.length) return items[Math.floor(rng() * items.length)];
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let target = rng() * total;
  for (let index = 0; index < items.length; index += 1) {
    target -= Math.max(0, weights[index]!);
    if (target < 0) return items[index];
  }
  return items[items.length - 1];
}

/**
 * Picks a new lighting preset every time a match starts. A map change is a level load and players
 * reconnect for a minute or two afterwards, so the change is delayed until they are in.
 */
export default definePlugin<Options>({
  name: 'weather-randomizer',
  description: 'Random lighting each new match, optionally weighted',
  defaults: { lightings: ['DayClear', 'DayLateGray'], weights: [], excludeCurrent: true, delaySeconds: 90 },
  setup(ctx) {
    const lightings = Array.isArray(ctx.options.lightings) ? ctx.options.lightings : [];
    const weighted = Array.isArray(ctx.options.weights) && ctx.options.weights.length === lightings.length;
    if (!lightings.length) {
      ctx.log.warn('no lightings configured; plugin is idle');
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    ctx.onStop(() => {
      if (timer) clearTimeout(timer);
    });
    const apply = async (map: string, current: string): Promise<void> => {
      // Filter items and weights together so they stay aligned.
      const pairs = lightings
        .map((lighting, index) => ({ lighting, weight: weighted ? ctx.options.weights[index]! : 1 }))
        .filter((pair) => !ctx.options.excludeCurrent || pair.lighting !== current);
      const choice = pickWeighted(
        pairs.map((pair) => pair.lighting),
        weighted ? pairs.map((pair) => pair.weight) : [],
      );
      if (!choice) return;
      await ctx.rcon.setLighting(choice);
      ctx.log.info(`new match on ${map}: lighting → ${choice}`);
    };
    ctx.on('match.new', ({ snapshot }) => {
      if (timer) clearTimeout(timer); // a second new match inside the delay: only the latest counts
      const delay = Math.max(0, Number(ctx.options.delaySeconds) || 0) * 1000;
      timer = setTimeout(() => {
        timer = undefined;
        const live = ctx.snapshot() ?? snapshot;
        apply(live.status.map, live.status.lighting).catch((e: unknown) =>
          ctx.log.warn('lighting change failed', e),
        );
      }, delay);
    });
    ctx.log.info(
      `${lightings.length} lighting choices${weighted ? ' (weighted)' : ''}, ${ctx.options.delaySeconds}s after each new match`,
    );
  },
});
