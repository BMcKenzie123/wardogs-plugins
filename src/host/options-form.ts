/**
 * Turns a plugin's options into HTML form fields and parses them back, typed by the plugin's defaults.
 * Kinds: str (text), num (number), bool (select), lines (string[] one per line), json (anything else).
 */
export type FieldKind = 'str' | 'num' | 'bool' | 'lines' | 'json';

export function kindOf(sample: unknown): FieldKind {
  if (typeof sample === 'number') return 'num';
  if (typeof sample === 'boolean') return 'bool';
  if (typeof sample === 'string') return 'str';
  if (Array.isArray(sample) && sample.every((x) => typeof x === 'string')) return 'lines';
  return 'json';
}

export function encodeValue(kind: FieldKind, value: unknown): string {
  switch (kind) {
    case 'lines':
      return Array.isArray(value) ? value.map(String).join('\n') : '';
    case 'json':
      return value === undefined ? '' : JSON.stringify(value, null, 2);
    case 'bool':
      return value ? 'true' : 'false';
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

/** Parse one field. Throws with a readable message on bad input. */
export function decodeValue(kind: FieldKind, raw: string, key: string): unknown {
  switch (kind) {
    case 'num': {
      const n = Number(raw.trim());
      if (raw.trim() === '' || !Number.isFinite(n)) throw new Error(`${key}: "${raw}" is not a number`);
      return n;
    }
    case 'bool':
      return raw === 'true' || raw === '1' || raw === 'on';
    case 'lines':
      return raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    case 'json': {
      const text = raw.trim();
      if (!text) throw new Error(`${key}: empty; use [] or {} for "nothing"`);
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`${key}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    default:
      return raw;
  }
}

/**
 * Read `o:<key>` / `k:<key>` pairs from a posted form into an options object. Keys present in `defaults`
 * but missing from the form are left untouched (the caller merges with the current options).
 */
export function parseOptionFields(fields: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of fields) {
    if (!name.startsWith('o:')) continue;
    const key = name.slice(2);
    const kind = (fields.get(`k:${key}`) ?? 'str') as FieldKind;
    out[key] = decodeValue(kind, raw, key);
  }
  return out;
}

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * HTML fields for every option, typed by `defaults` (falling back to the current value's type).
 * Keys listed in `choices` render as a dropdown of those values (plus the current one if it is off-list).
 */
export function renderOptionFields(
  defaults: Record<string, unknown>,
  options: Record<string, unknown>,
  choices: Record<string, readonly string[]> = {},
): string {
  const keys = [...new Set([...Object.keys(defaults), ...Object.keys(options)])];
  return keys
    .map((key) => {
      const list = choices[key] ?? [];
      const kind = list.length ? 'str' : kindOf(key in defaults ? defaults[key] : options[key]);
      const value = encodeValue(kind, options[key]);
      const def = encodeValue(kind, defaults[key]);
      const hint =
        def && def !== value
          ? `<span class="def">default: ${esc(def.length > 60 ? `${def.slice(0, 57)}…` : def)}</span>`
          : '';
      const wide = kind === 'lines' || kind === 'json' || value.length > 70 || value.includes('\n');
      let input: string;
      if (list.length)
        input = `<select name="o:${esc(key)}">${(list.includes(value) ? list : [value, ...list])
          .map((v) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(v)}</option>`)
          .join('')}</select>`;
      else if (kind === 'bool')
        input = `<select name="o:${esc(key)}"><option value="true"${value === 'true' ? ' selected' : ''}>true</option><option value="false"${value === 'false' ? ' selected' : ''}>false</option></select>`;
      else if (kind === 'num')
        input = `<input type="number" step="any" name="o:${esc(key)}" value="${esc(value)}">`;
      else if (wide)
        input = `<textarea name="o:${esc(key)}" rows="${Math.min(12, Math.max(2, value.split('\n').length + 1))}" spellcheck="false">${esc(value)}</textarea>`;
      else input = `<input type="text" name="o:${esc(key)}" value="${esc(value)}">`;
      const label =
        kind === 'lines'
          ? `${esc(key)} <span class="def">(one per line)</span>`
          : kind === 'json'
            ? `${esc(key)} <span class="def">(JSON)</span>`
            : esc(key);
      return `<div class="field${wide ? ' wide' : ''}"><label>${label}</label><input type="hidden" name="k:${esc(key)}" value="${kind}">${input}${hint}</div>`;
    })
    .join('');
}
