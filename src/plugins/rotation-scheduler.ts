import { definePlugin } from '../host/plugin.ts';
import type { MapSelection } from '../rcon/types.ts';

export interface RotationSchedule {
  /** "mon" … "sun", or "*" for every day. */
  days: string[];
  /** Local "HH:MM". A window with from > to wraps past midnight (e.g. 22:00–02:00). */
  from: string;
  to: string;
  entries: MapSelection[];
}

interface Options {
  schedules: RotationSchedule[];
  checkSeconds: number;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function allows(days: string[], day: string): boolean {
  const wanted = days.map((value) => value.trim().toLowerCase().slice(0, 3));
  return wanted.includes('*') || wanted.includes(day);
}

/** Index of the schedule active at `now`, or -1. First match wins. */
export function activeSchedule(schedules: RotationSchedule[], now: Date): number {
  const time = hhmm(now);
  const today = DAYS[now.getDay()]!;
  const yesterday = DAYS[(now.getDay() + 6) % 7]!;
  return schedules.findIndex((schedule) => {
    if (schedule.from <= schedule.to)
      return allows(schedule.days, today) && time >= schedule.from && time <= schedule.to;
    // Wraps midnight: the evening part belongs to the listed day, the early-morning part to the day after.
    return (
      (allows(schedule.days, today) && time >= schedule.from) ||
      (allows(schedule.days, yesterday) && time <= schedule.to)
    );
  });
}

/**
 * Swaps the whole map rotation when a schedule window opens (prime-time maps on Friday night,
 * small maps on weekday afternoons, …). Leaving a window changes nothing until another one opens.
 */
export default definePlugin<Options>({
  name: 'rotation-scheduler',
  description: 'Replaces the map rotation by weekday and time window',
  defaults: { schedules: [], checkSeconds: 60 },
  setup(ctx) {
    const schedules = Array.isArray(ctx.options.schedules) ? ctx.options.schedules : [];
    if (!schedules.length) {
      ctx.log.warn('no schedules configured; plugin is idle');
      return;
    }
    ctx.every(
      Number(ctx.options.checkSeconds) * 1000,
      async () => {
        const index = activeSchedule(schedules, new Date());
        if (index < 0) return;
        const schedule = schedules[index]!;
        const key = `${index}|${schedule.days.join(',')}|${schedule.from}-${schedule.to}`;
        if (ctx.state.get<string>('applied', '') === key) return;
        if (!ctx.snapshot()) return; // server unreachable; try again next check

        const rotation = await ctx.rcon.rotation();
        for (let i = rotation.entries.length - 1; i >= 0; i -= 1) await ctx.rcon.removeRotationEntry(i);
        for (const entry of schedule.entries) await ctx.rcon.addRotationEntry(entry);
        await ctx.rcon.saveRotation();
        ctx.state.set('applied', key);
        ctx.log.info(
          `applied schedule ${schedule.days.join('/')} ${schedule.from}-${schedule.to}: ${schedule.entries.map((e) => e.map).join(', ')}`,
        );
      },
      { immediate: true },
    );
    ctx.log.info(`${schedules.length} schedules, checking every ${ctx.options.checkSeconds}s`);
  },
});
