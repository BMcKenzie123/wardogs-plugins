import http from 'node:http';
import https from 'node:https';
export function postJson(url: string, body: unknown): Promise<void> {
  return request(url, 'POST', JSON.stringify(body), 'application/json').then(() => undefined);
}
export function getText(url: string): Promise<string> {
  return request(url, 'GET');
}
function request(url: string, method: string, body?: string, contentType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      {
        method,
        headers: body
          ? { 'Content-Type': contentType!, 'Content-Length': Buffer.byteLength(body) }
          : undefined,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (x: string) => {
          text += x;
        });
        res.on('end', () =>
          res.statusCode && res.statusCode >= 200 && res.statusCode < 300
            ? resolve(text)
            : reject(new Error(`HTTP ${res.statusCode ?? 0}`)),
        );
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error(`timeout ${method} ${target.host}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
