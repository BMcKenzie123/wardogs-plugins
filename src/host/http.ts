import http from 'node:http';
import https from 'node:https';

interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export function requestJson<T>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
  return request<T>(method, url, opts, false);
}

export function postJson<T = void>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>('POST', url, { body, headers });
}

export async function getText(url: string, headers?: Record<string, string>): Promise<string> {
  return request<string>('GET', url, { headers }, true);
}

function request<T>(method: string, url: string, opts: RequestOptions, textResult: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (body !== undefined) {
      headers['Content-Type'] ??= 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, { method, headers }, (res) => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        response += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (method === 'GET' && [301, 302, 307, 308].includes(status) && location) {
          request<T>('GET', new URL(location, target).toString(), opts, textResult).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} ${method} ${url}: ${response.slice(0, 200)}`));
          return;
        }
        if (!response) {
          resolve(undefined as T);
          return;
        }
        if (textResult) {
          resolve(response as T);
          return;
        }
        try {
          resolve(JSON.parse(response) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(opts.timeoutMs ?? 15_000, () => {
      req.destroy(new Error(`timeout ${method} ${target.host}`));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
