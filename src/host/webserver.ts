import http from 'node:http';
import type { Logger } from './logger.ts';

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void | Promise<void>;

export interface Route {
  method: 'GET' | 'POST';
  path: string;
  handler: RouteHandler;
}

const MAX_BODY = 1_000_000;

let server: http.Server | undefined;
let activePort: number | undefined;
let refs = 0;
const routes = new Map<string, Route>();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * One HTTP listener shared by every plugin that serves something (dashboard, admin panel, metrics,
 * health). Plugins register routes and release their reference on stop; the server closes at zero.
 */
export function acquireWebServer(
  port: number,
  logger: Logger,
  bind = '0.0.0.0',
): { register(route: Route): () => void; release(): void } {
  if (!server) {
    server = http.createServer((req, res) => {
      const method = (req.method ?? 'GET').toUpperCase();
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const route = routes.get(`${method} ${pathname}`);
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      (method === 'POST' ? readBody(req) : Promise.resolve(''))
        .then((body) => route.handler(req, res, body))
        .catch((error: unknown) => {
          logger.error('web handler failed', error);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('internal server error');
        });
    });
    server.on('error', (error: unknown) => logger.error('web server error (is the port free?)', error));
    server.listen(port, bind);
    activePort = port;
    logger.info(`web server listening at http://${bind}:${port}`);
  } else if (activePort !== port) {
    logger.warn(`web server already acquired on port ${activePort}; ignoring ${port}`);
  }
  refs += 1;
  let released = false;
  return {
    register(route) {
      const key = `${route.method} ${route.path}`;
      if (routes.has(key)) logger.warn(`route ${key} already registered; replacing`);
      routes.set(key, route);
      return () => {
        if (routes.get(key) === route) routes.delete(key);
      };
    },
    release() {
      if (released) return;
      released = true;
      refs -= 1;
      if (refs > 0 || !server) return;
      server.closeAllConnections();
      server.close();
      server = undefined;
      activePort = undefined;
      routes.clear();
    },
  };
}
