// src/index.js
import 'dotenv/config';
import { log } from './logger.js';
import { createApp } from './server.js';
import { ESLClient } from './esl/client.js';
import { db } from './db/index.js';

async function main() {
    log.info('Iniciando VoIP AI Agent...');

    // ── Banco de dados ──────────────────────────────────────────
    await db.connect();
    await db.migrate();
    log.info('PostgreSQL conectado.');

    // ── ESL – Event Socket com FreeSWITCH ──────────────────────
    const esl = new ESLClient({
        host: process.env.FS_HOST ?? '127.0.0.1',
        port: Number(process.env.FS_ESL_PORT ?? 8021),
        password: process.env.FS_ESL_PASSWORD ?? 'ClueCon',
    });
    await esl.connect();
    log.info('Conectado ao FreeSWITCH via ESL.');

    // ── HTTP server ─────────────────────────────────────────────
    const app = createApp({ esl, db, log });
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, () => log.info(`Servidor ouvindo na porta ${port}`));

    // ── Graceful shutdown ───────────────────────────────────────
    for (const sig of ['SIGTERM', 'SIGINT']) {
        process.on(sig, async () => {
            log.info(`${sig} recebido – encerrando...`);
            await esl.disconnect();
            await db.end();
            process.exit(0);
        });
    }
}

main().catch((err) => {
    log.error({ err }, 'Falha na inicialização');
    process.exit(1);
});