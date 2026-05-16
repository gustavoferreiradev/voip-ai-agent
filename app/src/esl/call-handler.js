// src/esl/call-handler.js
// Orquestra o fluxo de uma chamada:
// 1. Atende o canal (answer)
// 2. Ativa mod_audio_stream → WebSocket no Node.js
// 3. O AudioServer recebe o áudio e aciona Deepgram → GPT → TTS → playback
import { log } from '../logger.js';

export class CallHandler {
    #uuid;
    #esl;
    #running = false;

    constructor({ uuid, esl }) {
        this.#uuid = uuid;
        this.#esl = esl;
    }

    async start() {
        this.#running = true;
        const uuid = this.#uuid;
        log.info({ uuid }, 'CallHandler: iniciando');

        // IP do Node.js acessível pelo FreeSWITCH
        // Em produção: IP real do servidor Node
        // Em dev com Multipass: IP do host (gateway da VM)
        const nodeIp = process.env.NODE_IP ?? '10.197.3.1';
        const audioPort = process.env.AUDIO_WS_PORT ?? '8090';
        const wsUrl = `ws://${nodeIp}:${audioPort}/?uuid=${uuid}`;

        try {
            // 1. Atende a chamada (sai do park)
            log.info({ uuid }, 'CallHandler: atendendo chamada');
            await this.#esl.execute(uuid, 'answer');

            // 2. Pequena pausa para o canal estabilizar
            await sleep(500);

            // 3. Ativa o streaming de áudio para o AudioServer via mod_audio_stream
            //    Formato: uuid_audio_stream <uuid> start <ws-url> <mix-type> <sample-rate>
            //    mono     = apenas o áudio do chamador (recomendado para STT)
            //    both     = áudio de ambos os lados misturado
            //    8k       = 8000 Hz (padrão VoIP — compatível com Deepgram linear16)
            log.info({ uuid, wsUrl }, 'CallHandler: ativando mod_audio_stream');
            await this.#esl.rawApi(`uuid_audio_stream ${uuid} start ${wsUrl} mono 8k`);
            log.info({ uuid }, 'CallHandler: streaming de áudio ativo');

        } catch (err) {
            log.error({ uuid, err }, 'CallHandler: erro ao iniciar');
        }
    }

    stop() {
        this.#running = false;
        const uuid = this.#uuid;

        // Para o streaming de áudio
        this.#esl.rawApi(`uuid_audio_stream ${uuid} stop`).catch(() => { });
        log.info({ uuid }, 'CallHandler: encerrado');
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));