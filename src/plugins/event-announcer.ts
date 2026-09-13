import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
import { postJson } from '../host/http.ts';

export interface ScheduledEvent {
  /** "mon" … "sun", or "*" for every day. */
  day: string;
  /** Local "HH:MM" (uses the TZ env var). */
  time: string;
  name: string;
  /** Vars: {name} {in} ("in 60 minutes" / "now") {when} ("fri 20:00"). */
  message: string;
}

interface Options {
  events: ScheduledEvent[];
  /** Reminder offsets in minutes before the event; 0 = at the start. */
  remindMinutesBefore: number[];
  /** Also post each reminder to Discord. */
  discord: boolean;
  webhookUrl: string;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The next start time of `ev` at or after (now - 60 s), or null if the event is malformed. */
export function nextOccurrence(ev: Pick<ScheduledEvent, 'day' | 'time'>, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(ev.time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  const day = ev.day.trim().toLowerCase();
  const wanted = day === '*' ? null : DAYS.indexOf(day.slice(0, 3));
  if (wanted === -1) return null;

  const c = new Date(now);
  c.setHours(hour, minute, 0, 0);
  for (let i = 0; i < 8; i++) {
    if ((wanted === null || c.getDay() === wanted) && c.getTime() >= now.getTime() - 60_000) return c;
    c.setDate(c.getDate() + 1);
  }
  return null;
}

/** Which reminder offsets fall in the current minute for this event. */
export function dueReminders(
  ev: Pick<ScheduledEvent, 'day' | 'time'>,
  offsets: number[],
  now: Date,
): Array<{ at: Date; offset: number }> {
  const at = nextOccurrence(ev, now);
  if (!at) return [];
  return offsets
    .filter((off) => {
      const t = at.getTime() - off * 60_000;
      return now.getTime() >= t && now.getTime() < t + 60_000;
    })
    .map((offset) => ({ at, offset }));
}

export function inWords(offsetMinutes: number): string {
  if (offsetMinutes <= 0) return 'now';
  if (offsetMinutes % 60 === 0) {
    const h = offsetMinutes / 60;
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  return `in ${offsetMinutes} minutes`;
}

/**
 * Broadcasts (and optionally posts to Discord) reminders for recurring community events —
 * clan nights, training, tournaments. Each reminder is sent once per occurrence, persisted.
 */
export default definePlugin<Options>({
  name: 'event-announcer',
  description: 'Reminds players in-game and on Discord about recurring community events',
  defaults: {
    events: [],
    remindMinutesBefore: [60, 15, 0],
    discord: true,
    webhookUrl: '',
  },
  setup(ctx) {
    const events = (Array.isArray(ctx.options.events) ? ctx.options.events : []).filter((e) => {
      const ok =
        e && typeof e.name === 'string' && typeof e.message === 'string' && nextOccurrence(e, new Date());
      if (!ok) ctx.log.warn(`ignoring malformed event: ${JSON.stringify(e)}`);
      return ok;
    });
    if (!events.length) {
      ctx.log.warn('no valid events configured; plugin is idle');
      return;
    }
    const offsets = (Array.isArray(ctx.options.remindMinutesBefore) ? ctx.options.remindMinutesBefore : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const url = ctx.options.discord ? ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '' : '';
    ctx.log.info(
      `${events.length} events, reminders at ${offsets.map(inWords).join(', ')}${url ? ', mirrored to Discord' : ''}`,
    );

    ctx.every(
      30_000,
      async () => {
        const now = new Date();
        const sent = ctx.state.get<Record<string, number>>('sent', {});
        let dirty = false;
        for (const ev of events) {
          for (const { at, offset } of dueReminders(ev, offsets, now)) {
            const key = `${ev.name}|${at.toISOString()}|${offset}`;
            if (sent[key]) continue;
            const text = fill(ev.message, {
              name: ev.name,
              in: inWords(offset),
              when: `${ev.day} ${ev.time}`,
            });
            // Server unreachable → skip in-game, still try Discord; the key is only recorded on success.
            let ok = true;
            if (ctx.snapshot()) {
              try {
                await ctx.rcon.broadcast(text);
              } catch (e) {
                ok = false;
                ctx.log.warn('broadcast failed', e);
              }
            }
            if (url) {
              try {
                await postJson(url, { username: 'WARDOGS', content: text });
              } catch (e) {
                ok = false;
                ctx.log.warn('discord post failed', e);
              }
            }
            if (ok) {
              sent[key] = at.getTime();
              dirty = true;
              ctx.log.info(`reminder: ${text}`);
            }
          }
        }
        // Forget reminders older than a week so the state file stays small.
        const cutoff = now.getTime() - 7 * 86_400_000;
        for (const [key, t] of Object.entries(sent))
          if (t < cutoff) {
            delete sent[key];
            dirty = true;
          }
        if (dirty) ctx.state.set('sent', sent);
      },
      { immediate: true },
    );
  },
});
