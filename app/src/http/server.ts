// src/http/server.ts
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { Database } from '../db/index.js';
import type { ESLClient } from '../esl/client.js';
import { log } from '../logger.js';

type Context = { esl: ESLClient; db: Database };

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  send(res, 200, { status: 'ok', ts: new Date().toISOString() });
}

async function handleCall(req: IncomingMessage, res: ServerResponse, ctx: Context): Promise<void> {
  const body = (await readBody(req)) as Record<string, string>;
  const { destination, callerId = '1000', sipIp } = body;

  if (!destination) {
    send(res, 400, { error: 'destination obrigatório' });
    return;
  }

  try {
    const result = sipIp
      ? await ctx.esl.originateSip({ destination, sipIp, callerId })
      : await ctx.esl.originate({ destination, callerId });

    log.info({ destination, result }, 'Chamada originada');
    send(res, 200, { status: 'originating', destination, result });
  } catch (err) {
    log.error({ err }, 'Erro ao originar chamada');
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleTranscripts(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
): Promise<void> {
  const uuid = req.url?.split('/').at(-1) ?? '';
  const { rows } = await ctx.db.query(
    'SELECT * FROM transcripts WHERE call_uuid = $1 ORDER BY created_at',
    [uuid],
  );
  send(res, 200, rows);
}

export function createHttpServer(ctx: Context, port: number): void {
  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    try {
      if (method === 'GET' && pathname === '/health') {
        await handleHealth(req, res);
      } else if (method === 'POST' && pathname === '/call') {
        await handleCall(req, res, ctx);
      } else if (method === 'GET' && pathname.startsWith('/transcripts/')) {
        await handleTranscripts(req, res, ctx);
      } else {
        send(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      log.error({ err }, 'HTTP: erro interno');
      send(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(port, () => log.info({ port }, 'HTTP server ouvindo'));
}
