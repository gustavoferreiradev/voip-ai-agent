// src/media/audio-server.js
// Servidor WebSocket que recebe áudio PCM do FreeSWITCH via mod_audio_stream
// e faz streaming em tempo real para o Deepgram STT
import { WebSocketServer } from 'ws';
import { log } from '../logger.js';
import { DeepgramStreamer } from '../stt/deepgram.js';
import { askGPT } from '../llm/openai.js';
import { synthesize } from '../tts/tts.js';

// Mapa de sessões ativas: callUUID → { ws, stt, history, esl }
const sessions = new Map();

/**
 * Inicia o servidor WebSocket de áudio na porta especificada.
 * O FreeSWITCH conecta aqui via mod_audio_stream quando uma chamada é atendida.
 *
 * @param {object} opts
 * @param {number} opts.port       - Porta do WebSocket (padrão: 8090)
 * @param {object} opts.esl        - ESLClient para executar comandos no canal
 */
export function startAudioServer({ port = 8090, esl }) {
    const wss = new WebSocketServer({ port });

    wss.on('listening', () => {
        log.info({ port }, 'AudioServer: WebSocket de áudio ouvindo');
    });

    wss.on('connection', (ws, req) => {
        // O mod_audio_stream envia o UUID no header ou na URL
        const url = new URL(req.url, `http://localhost:${port}`);
        const uuid = url.searchParams.get('uuid') || url.pathname.replace('/', '');

        log.info({ uuid }, 'AudioServer: nova conexão de áudio');

        // Inicia a sessão
        const session = createSession({ uuid, ws, esl });
        sessions.set(uuid, session);

        ws.on('message', (data) => handleAudio(uuid, data));

        ws.on('close', () => {
            log.info({ uuid }, 'AudioServer: conexão encerrada');
            destroySession(uuid);
        });

        ws.on('error', (err) => {
            log.error({ uuid, err }, 'AudioServer: erro no WebSocket');
            destroySession(uuid);
        });
    });

    wss.on('error', (err) => {
        log.error({ err }, 'AudioServer: erro no servidor');
    });

    return wss;
}

// ── Criação de sessão ─────────────────────────────────────────

function createSession({ uuid, ws, esl }) {
    const history = []; // histórico multi-turn para o GPT

    // Inicia o streamer Deepgram
    const stt = new DeepgramStreamer({
        onTranscript: (text) => handleTranscript({ uuid, text, history, ws, esl }),
        onError: (err) => log.error({ uuid, err }, 'AudioServer: erro Deepgram'),
    });

    stt.start().then(() => {
        log.info({ uuid }, 'AudioServer: Deepgram conectado');
    }).catch((err) => {
        log.error({ uuid, err }, 'AudioServer: falha ao conectar Deepgram');
    });

    return { ws, stt, history, esl, uuid };
}

// ── Processa chunks de áudio ──────────────────────────────────

function handleAudio(uuid, data) {
    const session = sessions.get(uuid);
    if (!session) return;

    // mod_audio_stream envia JSON de metadados ou Buffer de áudio
    if (Buffer.isBuffer(data)) {
        // Chunk de áudio PCM — envia direto para o Deepgram
        session.stt.send(data);
    } else {
        // Mensagem de controle JSON do mod_audio_stream
        try {
            const msg = JSON.parse(data.toString());
            log.debug({ uuid, msg }, 'AudioServer: mensagem de controle');

            // start: início do streaming
            // stop:  fim do streaming
            if (msg.event === 'stop') {
                log.info({ uuid }, 'AudioServer: evento stop recebido');
                destroySession(uuid);
            }
        } catch {
            // Não é JSON — ignora
        }
    }
}

// ── Processa transcrição e aciona pipeline IA ─────────────────

async function handleTranscript({ uuid, text, history, ws, esl }) {
    if (!text?.trim()) return;
    log.info({ uuid, text }, 'AudioServer: transcrição recebida');

    history.push({ role: 'user', content: text });

    try {
        // 1. GPT-4o gera resposta
        const reply = await askGPT(history);
        history.push({ role: 'assistant', content: reply });
        log.info({ uuid, reply }, 'AudioServer: resposta GPT');

        // 2. TTS converte para áudio WAV
        const audioPath = await synthesize(reply, uuid);
        log.info({ uuid, audioPath }, 'AudioServer: TTS gerado');

        // 3. FreeSWITCH faz playback no canal
        await esl.execute(uuid, 'playback', audioPath);
        log.info({ uuid }, 'AudioServer: playback executado');

    } catch (err) {
        log.error({ uuid, err }, 'AudioServer: erro no pipeline IA');
    }
}

// ── Encerra sessão ────────────────────────────────────────────

function destroySession(uuid) {
    const session = sessions.get(uuid);
    if (!session) return;

    session.stt?.close();
    sessions.delete(uuid);
    log.info({ uuid }, 'AudioServer: sessão encerrada');
}

// Exporta o mapa de sessões para uso externo (ex: CallHandler)
export { sessions };