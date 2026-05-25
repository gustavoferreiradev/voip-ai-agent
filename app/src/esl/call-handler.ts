// src/esl/call-handler.ts
import { env } from '../env.js';
import { log } from '../logger.js';
import type { ESLClient } from './client.js';

export class CallHandler {
  readonly #uuid: string;
  readonly #esl: ESLClient;
  #running = false;

  constructor(uuid: string, esl: ESLClient) {
    this.#uuid = uuid;
    this.#esl = esl;
  }

  async start(): Promise<void> {
    this.#running = true;
    const { uuid } = { uuid: this.#uuid };
    log.info({ uuid }, 'CallHandler: iniciando');

    const wsUrl = `ws://${env.NODE_IP}:${env.AUDIO_WS_PORT}/?uuid=${uuid}`;

    try {
      // 1. Atende a chamada (sai do &park)
      log.info({ uuid }, 'CallHandler: atendendo chamada');
      await this.#esl.execute(uuid, 'answer');

      // 2. Estabiliza o canal
      await sleep(500);

      // 3. Ativa streaming de áudio → AudioServer via mod_audio_stream
      //    mono = apenas o áudio do chamador | 8k = 8000 Hz (padrão VoIP)
      log.info({ uuid, wsUrl }, 'CallHandler: ativando mod_audio_stream');
      await this.#esl.rawApi(`uuid_audio_stream ${uuid} start ${wsUrl} mono 8k`);
      log.info({ uuid }, 'CallHandler: streaming de áudio ativo');
    } catch (err) {
      log.error({ uuid, err }, 'CallHandler: erro ao iniciar');
    }
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#esl.rawApi(`uuid_audio_stream ${this.#uuid} stop`).catch(() => undefined);
    log.info({ uuid: this.#uuid }, 'CallHandler: encerrado');
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
