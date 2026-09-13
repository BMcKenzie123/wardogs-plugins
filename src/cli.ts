#!/usr/bin/env node
/**
 * wd — one-shot admin commands against the WARDOGS RCON API.
 * Usage: wd <command> [args] [--json]   (run `wd help` for the full list)
 */
import fs from 'node:fs/promises';
import { loadEnv, loadHostConfig, loadRconConfig } from './config.ts';
import { RconClient, RconConflictError, RconError } from './rcon/client.ts';
import type { FactionScore, MapSelection, Status } from './rcon/types.ts';

const HELP = `wd — WARDOGS RCON command line

Read
  wd status                         live match state
  wd players                        connected players
  wd caps                           supported routes (feature detection)
  wd bans                           ban list
  wd slots                          reserved-slot steamIds
  wd audit [limit]                  admin action log (1-500, default 50)
  wd rotation                       map rotation with now/next markers
  wd maps | lightings | experiences [map] | alternators <map>
  wd config get                     print ServerSettings.ini (redirect to a file to edit)
  wd sponsor                        sponsor banner URL
  wd watch                          poll status every POLL_MS and print one line per tick

Players / moderation
  wd broadcast <message…>           message everyone
  wd dm <steamId> <message…>        direct message
  wd kick <steamId> [reason…]       wd kill <steamId>
  wd faction <steamId> <faction>    change team (capability-gated)
  wd ban <steamId> [reason…]        wd unban <steamId>
  wd slot add <steamId>             wd slot rm <steamId>

Match control
  wd map <map> [--exp A+B] [--lighting X] [--alt Y]     change map now
  wd lighting <preset>              set lighting/weather live
  wd end | restart                  end / restart the current match

Rotation
  wd rotation add <map> [--exp A+B] [--lighting X] [--alt Y]
  wd rotation rm <i>                wd rotation move <i> up|down
  wd rotation save                  persist rotation changes

Config
  wd settings [--score-tick N] [--rotation on|off] [--mode ordered|random]
  wd config validate <file>
  wd config put <file> [--force] [--full-apply]        sends If-Match unless --force
  wd sponsor <imageUrl>

Flags
  --json                            print raw JSON instead of tables

Env: RCON_HOST RCON_PORT RCON_PASSWORD RCON_SCHEME RCON_TLS_INSECURE RCON_CA_FILE (see .env.example)`;

// ---------- arg parsing ----------

const VALUE_FLAGS = new Set(['exp', 'lighting', 'alt', 'score-tick', 'rotation', 'mode']);

interface Args {
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    if (VALUE_FLAGS.has(key) && i + 1 < argv.length) {
      flags[key] = argv[++i]!;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

// ---------- output helpers ----------

function table(rows: ReadonlyArray<object>, columns: string[]): string {
  if (!rows.length) return '(none)';
  const cell = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => cell((r as Record<string, unknown>)[c]).length)),
  );
  const line = (vals: string[]): string => vals.map((v, i) => v.padEnd(widths[i]!)).join('  ');
  return [
    line(columns),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((r) => line(columns.map((c) => cell((r as Record<string, unknown>)[c])))),
  ].join('\n');
}

function scoreOf(row: FactionScore): string {
  for (const [key, value] of Object.entries(row))
    if (key !== 'colorHex' && key !== 'name' && typeof value === 'number') return String(value);
  return '';
}

function statusLine(s: Status): string {
  const factions = s.factionScores.map((f) => `${f.name} ${scoreOf(f)}`.trim()).join(' · ');
  const min = Math.floor(s.matchSeconds / 60);
  const sec = String(Math.floor(s.matchSeconds % 60)).padStart(2, '0');
  return `${s.map} [${s.experiences.join('+') || '-'}] ${s.lighting} | ${s.players.current}/${s.players.max} players | ${factions || 'no factions'} | ${min}:${sec}`;
}

function selection(map: string, flags: Args['flags']): MapSelection {
  const sel: MapSelection = { map };
  if (typeof flags.exp === 'string') sel.experiences = flags.exp.split('+').filter(Boolean);
  if (typeof flags.lighting === 'string') sel.lighting = flags.lighting;
  if (typeof flags.alt === 'string') sel.zoneAlternator = flags.alt;
  return sel;
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new UsageError(`missing ${what}`);
  return value;
}

class UsageError extends Error {}

// ---------- commands ----------

async function run(
  args: Args,
  c: RconClient,
  print: (v: unknown, pretty?: () => string) => void,
): Promise<void> {
  const [cmd, a1, a2, ...rest] = args.positional;
  const tail = (from: number): string => args.positional.slice(from).join(' ');

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;

    // ----- read -----
    case 'status': {
      const s = await c.status();
      print(s, () => {
        const rot = s.rotation
          ? `now ${s.rotation.nowIndex ?? '-'} next ${s.rotation.nextIndex ?? '-'}`
          : 'n/a';
        return [
          `${s.serverName}`,
          statusLine(s),
          `scoreTick ${s.scoreTick.current} (${s.scoreTick.min}-${s.scoreTick.max}) · scoreCap ${s.scoreCap} · alternator ${s.alternator || '-'} · rotation ${rot}`,
        ].join('\n');
      });
      return;
    }
    case 'players': {
      const p = await c.players();
      print(p, () => table(p.players, ['name', 'steamId', 'faction', 'kills', 'deaths', 'cash', 'pingMs']));
      return;
    }
    case 'caps': {
      const caps = await c.capabilities();
      print(caps, () => [...caps.routes, `config.writable=${caps.config.writable}`].join('\n'));
      return;
    }
    case 'bans': {
      const b = await c.bans();
      print(b, () => table(b.bans, ['steamId', 'bannedAtUtc', 'bannedBy', 'reason']));
      return;
    }
    case 'slots': {
      const s = await c.reservedSlots();
      print(s, () => s.reservedSlots.join('\n') || '(none)');
      return;
    }
    case 'audit': {
      const a = await c.audit(a1 ? Number(a1) : 50);
      print(a, () => table(a.entries, ['timestampUtc', 'event', 'peer', 'detail']));
      return;
    }
    case 'maps':
      print(await c.catalogMaps());
      return;
    case 'lightings':
      print(await c.catalogLightings());
      return;
    case 'experiences':
      print(a1 ? await c.mapExperiences(a1) : await c.catalogExperiences());
      return;
    case 'alternators':
      print(await c.mapAlternators(need(a1, 'map id')));
      return;
    case 'sponsor':
      if (a1) print(await c.setSponsor(a1));
      else {
        const s = await c.sponsor();
        print(s, () => s.imageUrl || '(none)');
      }
      return;
    case 'watch': {
      const pollMs = loadHostConfig().pollMs;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const t = new Date().toISOString().slice(11, 19);
        try {
          console.log(`${t} ${statusLine(await c.status())}`);
        } catch (e) {
          console.log(`${t} DOWN ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }

    // ----- players / moderation -----
    case 'broadcast':
      print(await c.broadcast(need(tail(1), 'message')));
      return;
    case 'dm':
      print(await c.message(need(a1, 'steamId'), need(tail(2), 'message')));
      return;
    case 'kick':
      print(await c.kick(need(a1, 'steamId'), tail(2) || undefined));
      return;
    case 'kill':
      print(await c.kill(need(a1, 'steamId')));
      return;
    case 'faction':
      print(await c.setFaction(need(a1, 'steamId'), need(tail(2), 'faction')));
      return;
    case 'ban':
      print(await c.ban(need(a1, 'steamId'), tail(2) || undefined));
      return;
    case 'unban':
      print(await c.unban(need(a1, 'steamId')));
      return;
    case 'slot':
      if (a1 === 'add') print(await c.addReservedSlot(need(a2, 'steamId')));
      else if (a1 === 'rm' || a1 === 'remove') print(await c.removeReservedSlot(need(a2, 'steamId')));
      else throw new UsageError('usage: wd slot add|rm <steamId>');
      return;

    // ----- match control -----
    case 'map':
      print(await c.changeMap(selection(need(a1, 'map id'), args.flags)));
      return;
    case 'lighting':
      print(await c.setLighting(need(a1, 'lighting preset')));
      return;
    case 'end':
      print(await c.endMatch());
      return;
    case 'restart':
      print(await c.restartMatch());
      return;

    // ----- rotation -----
    case 'rotation': {
      if (!a1) {
        const r = await c.rotation();
        print(r, () => {
          const rows = r.entries.map((e, i) => ({
            i,
            status: e.status,
            map: e.map,
            experiences: e.experiences.join('+'),
            lighting: e.lighting,
            zoneAlternator: e.zoneAlternator,
            denied: e.denied ? 'yes' : '',
          }));
          return `enabled=${r.enabled} mode=${r.mode}\n${table(rows, ['i', 'status', 'map', 'experiences', 'lighting', 'zoneAlternator', 'denied'])}`;
        });
        return;
      }
      if (a1 === 'add') print(await c.addRotationEntry(selection(need(a2, 'map id'), args.flags)));
      else if (a1 === 'rm' || a1 === 'remove') print(await c.removeRotationEntry(Number(need(a2, 'index'))));
      else if (a1 === 'move') {
        const dir = rest[0];
        if (dir !== 'up' && dir !== 'down') throw new UsageError('usage: wd rotation move <i> up|down');
        print(await c.moveRotationEntry(Number(need(a2, 'index')), dir));
      } else if (a1 === 'save') print(await c.saveRotation());
      else throw new UsageError('usage: wd rotation [add|rm|move|save]');
      return;
    }

    // ----- config -----
    case 'settings': {
      const patch: { scoreTick?: number; rotationEnabled?: boolean; rotationMode?: string } = {};
      if (typeof args.flags['score-tick'] === 'string') patch.scoreTick = Number(args.flags['score-tick']);
      if (typeof args.flags.rotation === 'string') patch.rotationEnabled = args.flags.rotation === 'on';
      if (typeof args.flags.mode === 'string') patch.rotationMode = args.flags.mode;
      if (!Object.keys(patch).length)
        throw new UsageError(
          'usage: wd settings [--score-tick N] [--rotation on|off] [--mode ordered|random]',
        );
      print(await c.patchSettings(patch));
      return;
    }
    case 'config': {
      if (a1 === 'get') {
        const doc = await c.config();
        print(doc, () => doc.text);
        return;
      }
      if (a1 === 'validate') {
        print(await c.validateConfig(await fs.readFile(need(a2, 'file'), 'utf8')));
        return;
      }
      if (a1 === 'put') {
        const text = await fs.readFile(need(a2, 'file'), 'utf8');
        const force = args.flags.force === true;
        const ifMatch = force ? undefined : (await c.config()).revision;
        print(await c.putConfig(text, { ifMatch, force, fullApply: args.flags['full-apply'] === true }));
        return;
      }
      throw new UsageError('usage: wd config get|validate <file>|put <file> [--force] [--full-apply]');
    }

    default:
      throw new UsageError(`unknown command "${cmd}" (try: wd help)`);
  }
}

// ---------- main ----------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const json = args.flags.json === true;
  const print = (v: unknown, pretty?: () => string): void => {
    if (json || !pretty) console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    else console.log(pretty());
  };
  if (!args.positional[0] || args.positional[0] === 'help' || args.flags.help) {
    console.log(HELP);
    return 0;
  }
  loadEnv();
  const client = new RconClient(loadRconConfig());
  try {
    await run(args, client, print);
    return 0;
  } catch (e) {
    if (e instanceof RconConflictError) {
      console.error(
        `config revision conflict (server is at "${e.result.revision}"); re-fetch with 'wd config get' or use --force`,
      );
      console.error(JSON.stringify(e.result, null, 2));
      return 2;
    }
    if (e instanceof RconError) {
      console.error(`${e.method} ${e.path} → ${e.status || e.code}: ${e.message}`);
      return 1;
    }
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    client.close();
  }
}

main().then((code) => {
  process.exitCode = code;
});
