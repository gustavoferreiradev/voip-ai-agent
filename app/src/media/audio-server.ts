// src/media/audio-server.ts
import { type WebSocket, WebSocketServer } from 'ws';
import { db } from '../db/index.js';
import { env } from '../env.js';
import type { ESLClient } from '../esl/client.js';
import { type Message, type ToolHandlers, askGPT } from '../llm/openai.js';
import { log } from '../logger.js';
import { DeepgramStreamer } from '../stt/deepgram.js';
import { synthesize } from '../tts/tts.js';

interface Session {
  ws: WebSocket;
  stt: DeepgramStreamer;
  history: Message[];
  processing: boolean;
}

const sessions = new Map<string, Session>();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function startAudioServer(esl: ESLClient, port: number): void {
  const wss = new WebSocketServer({ port });

  wss.on('listening', () => log.info({ port }, 'AudioServer: WebSocket de áudio ouvindo'));

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const uuid = url.searchParams.get('uuid') ?? url.pathname.slice(1);
    if (!uuid) {
      ws.close();
      return;
    }

    log.info({ uuid }, 'AudioServer: nova conexão de áudio');

    const session = createSession(uuid, ws, esl);
    sessions.set(uuid, session);

    ws.on('message', (data) => handleAudio(uuid, data as Buffer | string));
    ws.on('close', () => {
      log.info({ uuid }, 'AudioServer: WS fechado');
      destroySession(uuid);
    });
    ws.on('error', (err) => {
      log.error({ uuid, err }, 'AudioServer: erro WS');
      destroySession(uuid);
    });
  });
}

function createSession(uuid: string, ws: WebSocket, esl: ESLClient): Session {
  const history: Message[] = [];
  const processing = false;

  const toolHandlers: ToolHandlers = {
    buscar_morador: async ({ apartamento }) => {
      if (!apartamento) return 'Apartamento não informado.';
      const r = await db.findResident(apartamento);
      if (!r) return `Apartamento ${apartamento} não encontrado no cadastro.`;
      return `Morador: ${r.name}, Apartamento: ${r.apartment}, Ramal: ${r.sip_extension}`;
    },

    ligar_para_morador: async ({ apartamento, motivo }) => {
      if (!apartamento) return 'Apartamento não informado.';
      const r = await db.findResident(apartamento);
      if (!r) return `Apartamento ${apartamento} não encontrado.`;

      log.info(
        { uuid, apartamento, ramal: r.sip_extension, motivo },
        'AudioServer: ligando para morador',
      );

      try {
        const result = await esl.originateSip({
          destination: r.sip_extension,
          sipIp: env.NODE_IP,
          callerId: 'Portaria',
          timeout: 30,
        });
        const residentUuid = result.trim().replace('+OK ', '');
        await sleep(3000);
        await esl.rawApi(`uuid_bridge ${uuid} ${residentUuid}`);
        return `Conectando com ${r.name} do apartamento ${apartamento}. Motivo: ${motivo ?? 'não informado'}.`;
      } catch (err) {
        log.error({ uuid, err }, 'AudioServer: erro ao ligar para morador');
        return `Não foi possível conectar com o morador do apartamento ${apartamento}.`;
      }
    },
  };

  const stt = new DeepgramStreamer({
    onTranscript: async (text) => {
      const session = sessions.get(uuid);
      if (!session || session.processing) return;
      session.processing = true;
      try {
        await handleTranscript(uuid, text, history, esl, toolHandlers);
      } finally {
        if (sessions.has(uuid)) session.processing = false;
      }
    },
    onError: (err) => log.error({ uuid, err }, 'AudioServer: erro Deepgram'),
  });

  stt
    .start()
    .then(() => log.info({ uuid }, 'AudioServer: Deepgram conectado'))
    .catch((err: unknown) => log.error({ uuid, err }, 'AudioServer: falha Deepgram'));

  return { ws, stt, history, processing };
}

function handleAudio(uuid: string, data: Buffer | string): void {
  const session = sessions.get(uuid);
  if (!session) return;

  if (Buffer.isBuffer(data)) {
    session.stt.send(data);
  } else {
    try {
      const msg = JSON.parse(data) as { event?: string };
      if (msg.event === 'stop') destroySession(uuid);
    } catch {
      // não é JSON
    }
  }
}

async function handleTranscript(
  uuid: string,
  text: string,
  history: Message[],
  esl: ESLClient,
  toolHandlers: ToolHandlers,
): Promise<void> {
  if (!text.trim()) return;
  log.info({ uuid, text }, 'AudioServer: transcrição recebida');

  history.push({ role: 'user', content: text });

  try {
    const reply = await askGPT(history, toolHandlers);
    history.push({ role: 'assistant', content: reply });
    log.info({ uuid, reply }, 'AudioServer: GPT respondeu');

    const audioPath = await synthesize(reply, uuid);
    await esl.execute(uuid, 'playback', audioPath);
    log.info({ uuid }, 'AudioServer: playback executado');
  } catch (err) {
    log.error({ uuid, err }, 'AudioServer: erro no pipeline IA');
  }
}

function destroySession(uuid: string): void {
  const s = sessions.get(uuid);
  if (!s) return;
  s.stt.close();
  sessions.delete(uuid);
  log.info({ uuid }, 'AudioServer: sessão encerrada');
}
