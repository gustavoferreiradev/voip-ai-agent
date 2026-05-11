import pkg from 'modesl';
const { Connection } = pkg;
import { log } from '../logger.js';
import { CallHandler } from './call-handler.js';

export class ESLClient {
    #conn = null;
    #opts;
    #handlers = new Map();

    constructor(opts) {
        this.#opts = opts;
    }

    // Tenta conectar com retry/backoff
    async connect(retries = 15, delayMs = 2000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await this.#tryConnect();
                return;
            } catch (err) {
                log.warn(`ESL: tentativa ${attempt}/${retries} falhou (${err.message}). Aguardando ${delayMs}ms...`);
                if (attempt === retries) throw err;
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }

    #tryConnect() {
        const { host, port, password } = this.#opts;
        log.info({ host, port }, 'ESL: conectando...');

        return new Promise((resolve, reject) => {
            const conn = new Connection(host, port, password, () => {
                log.info({ host, port }, 'ESL: conexão estabelecida');
                this.#conn = conn;

                // Subscreve eventos de canal
                this.#conn.events('json',
                    'CHANNEL_CREATE',
                    'CHANNEL_ANSWER',
                    'CHANNEL_DESTROY',
                    'CHANNEL_HANGUP',
                    'CUSTOM'
                );

                this.#conn.on('esl::event::CHANNEL_ANSWER::*', (evt) => this.#onAnswer(evt));
                this.#conn.on('esl::event::CHANNEL_DESTROY::*', (evt) => this.#onDestroy(evt));
                this.#conn.on('esl::event::CHANNEL_HANGUP::*', (evt) => this.#onHangup(evt));

                resolve();
            });

            conn.on('error', (err) => {
                log.error({ err: err.message }, 'ESL: erro de conexão');
                reject(err);
            });

            conn.on('esl::end', () => {
                log.warn('ESL: conexão encerrada pelo FreeSWITCH');
            });
        });
    }

    // Origina chamada para ramal SIP registrado
    originate({ destination, callerId, timeout = 30 }) {
        // Usa user/<ramal> — o FreeSWITCH resolve pelo registro SIP ativo
        const dialStr = `{origination_caller_id_number=${callerId},call_timeout=${timeout}}user/${destination}`;
        const cmd = `originate ${dialStr} &park()`;
        log.info({ destination, callerId, cmd }, 'ESL: originando chamada');
        return this.#bgapi(cmd);
    }

    // Origina chamada para endpoint SIP explícito (quando user/ falha)
    originateSip({ destination, sipIp, callerId, timeout = 30 }) {
        const dialStr = `{origination_caller_id_number=${callerId},call_timeout=${timeout}}sofia/internal/sip:${destination}@${sipIp}`;
        const cmd = `originate ${dialStr} &park()`;
        log.info({ destination, sipIp, callerId, cmd }, 'ESL: originando via SIP direto');
        return this.#bgapi(cmd);
    }

    // Origina chamada para destino externo via gateway
    originateGateway({ destination, callerId, gateway = 'default', timeout = 30 }) {
        const dialStr = `{origination_caller_id_number=${callerId},call_timeout=${timeout}}sofia/gateway/${gateway}/${destination}`;
        const cmd = `originate ${dialStr} &park()`;
        log.info({ destination, callerId, gateway, cmd }, 'ESL: originando via gateway');
        return this.#bgapi(cmd);
    }

    // Executa app FreeSWITCH num canal
    execute(uuid, app, arg = '') {
        return new Promise((resolve, reject) => {
            this.#conn.execute(app, arg, uuid, (res) => {
                const body = res?.getBody?.() ?? '';
                if (body.startsWith('-ERR')) reject(new Error(body));
                else resolve(res);
            });
        });
    }

    #bgapi(cmd) {
        return new Promise((resolve, reject) => {
            this.#conn.bgapi(cmd, (res) => {
                const body = res?.getBody?.() ?? '';
                if (body.startsWith('-ERR')) reject(new Error(body));
                else resolve(body);
            });
        });
    }

    async disconnect() {
        this.#conn?.disconnect();
        log.info('ESL: desconectado');
    }

    #onAnswer(evt) {
        const uuid = evt.getHeader('Unique-ID');
        const direction = evt.getHeader('Call-Direction') ?? 'inbound';
        const callerId = evt.getHeader('Caller-Caller-ID-Number') ?? 'unknown';
        log.info({ uuid, direction, callerId }, 'ESL: chamada atendida');

        const handler = new CallHandler({ uuid, esl: this });
        this.#handlers.set(uuid, handler);
        handler.start().catch(err => log.error({ uuid, err }, 'CallHandler: erro'));
    }

    #onHangup(evt) {
        const uuid = evt.getHeader('Unique-ID');
        const cause = evt.getHeader('Hangup-Cause') ?? 'UNKNOWN';
        log.info({ uuid, cause }, 'ESL: hangup');
        this.#destroyHandler(uuid);
    }

    #onDestroy(evt) {
        this.#destroyHandler(evt.getHeader('Unique-ID'));
    }

    #destroyHandler(uuid) {
        const handler = this.#handlers.get(uuid);
        if (handler) {
            handler.stop();
            this.#handlers.delete(uuid);
            log.info({ uuid }, 'ESL: CallHandler removido');
        }
    }

    get rawConn() { return this.#conn; }
}