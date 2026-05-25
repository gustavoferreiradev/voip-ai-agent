import { db } from './db/index.js';
// src/index.ts
import { env } from './env.js';
import { ESLClient } from './esl/client.js';
import { createHttpServer } from './http/server.js';
import { log } from './logger.js';
import { startAudioServer } from './media/audio-server.js';

async function main(): Promise<void> {
  log.info('Iniciando VoIP AI Agent...');

  // ── PostgreSQL ──────────────────────────────────────────────
  await db.connect();
  await db.migrate();
  log.info('PostgreSQL conectado.');

  // ── ESL ─────────────────────────────────────────────────────
  const esl = new ESLClient();
  await esl.connect();
  log.info('FreeSWITCH ESL conectado.');

  // ── AudioServer (WebSocket p/ mod_audio_stream) ─────────────
  startAudioServer(esl, env.AUDIO_WS_PORT);
  log.info({ port: env.AUDIO_WS_PORT }, 'AudioServer iniciado.');

  // ── HTTP server (sem Express) ────────────────────────────────
  createHttpServer({ esl, db }, env.PORT);

  // ── Graceful shutdown ────────────────────────────────────────
  const shutdown = async (sig: string): Promise<void> => {
    log.info(`${sig} recebido — encerrando...`);
    esl.disconnect();
    await db.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Falha na inicialização:', err);
  process.exit(1);
});
