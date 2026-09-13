import http from 'node:http';
import type { Logger } from './logger.ts';

export interface Route {
  method: 'GET';
  path: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
}

let server: http.Server | undefined;
let activePort: number | undefined;
let refs = 0;
const routes = new Map<string, Route>();

export function acquireWebServer(
  port: number,
  logger: Logger,
): { register(route: Route): () => void; release(): void } {
  if (!server) {
    server = http.createServer((req, res) => {
      const route = routes.get(`${req.method} ${new URL(req.url ?? '/', 'http://localhost').pathname}`);
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      Promise.resolve(route.handler(req, res)).catch((error: unknown) => {
        logger.error('web handler failed', error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal server error');
      });
    });
    server.on('error', (error: unknown) => logger.error('web server error (is the port free?)', error));
    server.listen(port, '0.0.0.0');
    activePort = port;
    logger.info(`web server listening at http://0.0.0.0:${port}`);
  } else if (activePort !== port) {
    logger.warn(`web server already acquired on port ${activePort}`);
  }
  refs += 1;
  let released = false;
  return {
    register(route) {
      const key = `${route.method} ${route.path}`;
      routes.set(key, route);
      return () => routes.delete(key);
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
