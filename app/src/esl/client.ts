// src/esl/client.ts
import pkg from 'modesl';
const { Connection } = pkg as typeof import('modesl');
import { env } from '../env.js';
import { log } from '../logger.js';
import { CallHandler } from './call-handler.js';

export interface OriginateOpts {
  destination: string;
  callerId: string;
  timeout?: number;
}

export interface OriginateSipOpts extends OriginateOpts {
  sipIp: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ESLClient {
  #conn: InstanceType<typeof Connection> | null = null;
  readonly #handlers = new Map<string, CallHandler>();

  async connect(retries = 15, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.#tryConnect();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ attempt, retries }, `ESL: tentativa ${attempt}/${retries} falhou (${msg})`);
        if (attempt === retries) throw err;
        await sleep(delayMs);
      }
    }
  }

  #tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      log.info({ host: env.FS_HOST, port: env.FS_ESL_PORT }, 'ESL: conectando...');

      const conn = new Connection(env.FS_HOST, env.FS_ESL_PORT, env.FS_ESL_PASSWORD, () => {
        this.#conn = conn;
        log.info({ host: env.FS_HOST, port: env.FS_ESL_PORT }, 'ESL: conexão estabelecida');

        conn.events('json', 'all');
        conn.on('esl::event::CHANNEL_ANSWER::*', (e) => this.#onAnswer(e));
        conn.on('esl::event::CHANNEL_HANGUP::*', (e) => this.#onHangup(e));
        conn.on('esl::event::CHANNEL_DESTROY::*', (e) => this.#onDestroy(e));
        conn.on('esl::end', () => log.warn('ESL: conexão encerrada pelo FreeSWITCH'));

        resolve();
      });

      conn.on('error', reject);
    });
  }

  originate({ destination, callerId, timeout = 30 }: OriginateOpts): Promise<string> {
    const cmd = `originate {origination_caller_id_number=${callerId},call_timeout=${timeout}}user/${destination} &park()`;
    log.info({ destination, callerId }, 'ESL: originando chamada');
    return this.#bgapi(cmd);
  }

  originateSip({ destination, sipIp, callerId, timeout = 30 }: OriginateSipOpts): Promise<string> {
    const cmd = `originate {origination_caller_id_number=${callerId},call_timeout=${timeout}}sofia/internal/sip:${destination}@${sipIp} &park()`;
    log.info({ destination, sipIp, callerId }, 'ESL: originando via SIP direto');
    return this.#bgapi(cmd);
  }

  execute(uuid: string, app: string, arg = ''): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.#conn) {
        reject(new Error('ESL não conectado'));
        return;
      }
      this.#conn.execute(app, arg, uuid, (res) => {
        const body = res?.getBody() ?? '';
        if (body.startsWith('-ERR')) reject(new Error(body));
        else resolve();
      });
    });
  }

  rawApi(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.#conn) {
        reject(new Error('ESL não conectado'));
        return;
      }
      this.#conn.api(cmd, (res) => {
        const body = res?.getBody() ?? '';
        if (body.startsWith('-ERR')) reject(new Error(body));
        else resolve(body);
      });
    });
  }

  #bgapi(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.#conn) {
        reject(new Error('ESL não conectado'));
        return;
      }
      this.#conn.bgapi(cmd, (res) => {
        const body = res?.getBody() ?? '';
        if (body.startsWith('-ERR')) reject(new Error(body));
        else resolve(body);
      });
    });
  }

  #onAnswer(evt: { getHeader(name: string): string | undefined }): void {
    const uuid = evt.getHeader('Unique-ID') ?? '';
    const direction = evt.getHeader('Call-Direction') ?? 'inbound';
    const callerId = evt.getHeader('Caller-Caller-ID-Number') ?? 'unknown';
    log.info({ uuid, direction, callerId }, 'ESL: chamada atendida');

    const handler = new CallHandler(uuid, this);
    this.#handlers.set(uuid, handler);
    handler.start().catch((err) => log.error({ uuid, err }, 'CallHandler: erro'));
  }

  #onHangup(evt: { getHeader(name: string): string | undefined }): void {
    const uuid = evt.getHeader('Unique-ID') ?? '';
    const cause = evt.getHeader('Hangup-Cause') ?? 'UNKNOWN';
    log.info({ uuid, cause }, 'ESL: hangup');
    this.#destroyHandler(uuid);
  }

  #onDestroy(evt: { getHeader(name: string): string | undefined }): void {
    this.#destroyHandler(evt.getHeader('Unique-ID') ?? '');
  }

  #destroyHandler(uuid: string): void {
    const h = this.#handlers.get(uuid);
    if (h) {
      h.stop();
      this.#handlers.delete(uuid);
    }
  }

  disconnect(): void {
    this.#conn?.disconnect();
    log.info('ESL: desconectado');
  }
}
