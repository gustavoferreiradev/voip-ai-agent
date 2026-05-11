// src/server.js
import express from 'express';

export function createApp({ esl, db, log }) {
    const app = express();
    app.use(express.json());

    // ── Healthcheck ─────────────────────────────────────────────
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', ts: new Date().toISOString() });
    });

    // ── Originar chamada para ramal SIP registrado ──────────────
    // POST /call { "destination": "1000", "callerId": "9999" }
    app.post('/call', async (req, res) => {
        const { destination, callerId = '1000', sipIp } = req.body;
        if (!destination) {
            return res.status(400).json({ error: 'destination obrigatório' });
        }
        try {
            // Se sipIp fornecido, usa endpoint explícito (mais confiável com FS PBX)
            const result = sipIp
                ? await esl.originateSip({ destination, sipIp, callerId })
                : await esl.originate({ destination, callerId });
            log.info({ destination, result }, 'Chamada originada');
            res.json({ status: 'originating', destination, result });
        } catch (err) {
            log.error({ err }, 'Erro ao originar chamada');
            res.status(500).json({ error: err.message });
        }
    });

    // ── Originar via gateway SIP externo ─────────────────────────
    // POST /call/gateway { "destination": "5549999999999", "callerId": "5549000000000", "gateway": "meu-gateway" }
    app.post('/call/gateway', async (req, res) => {
        const { destination, callerId = '1000', gateway = 'default' } = req.body;
        if (!destination) {
            return res.status(400).json({ error: 'destination obrigatório' });
        }
        try {
            const result = await esl.originateGateway({ destination, callerId, gateway });
            log.info({ destination, gateway, result }, 'Chamada via gateway originada');
            res.json({ status: 'originating', destination, gateway, result });
        } catch (err) {
            log.error({ err }, 'Erro ao originar via gateway');
            res.status(500).json({ error: err.message });
        }
    });

    // ── Listar transcrições ──────────────────────────────────────
    app.get('/transcripts/:uuid', async (req, res) => {
        try {
            const rows = await db.query(
                'SELECT * FROM transcripts WHERE call_uuid = $1 ORDER BY created_at',
                [req.params.uuid]
            );
            res.json(rows.rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return app;
}