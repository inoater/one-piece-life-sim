import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** A minimal static file server, so the built page is tested over real http (workers and IndexedDB need an origin). */
export async function serveDirectory(directory: string): Promise<{ url: string; server: Server }> {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')).replace(
      /^(\.\.[/\\])+/,
      '',
    );
    const file = join(directory, path === '/' || path === '\\' ? 'opsim-preview.html' : path);
    if (!file.startsWith(directory)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response
        .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
        .end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no port');
  return { url: `http://127.0.0.1:${address.port}`, server };
}
