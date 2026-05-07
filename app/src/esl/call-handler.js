// src/esl/call-handler.js
// Orquestra o ciclo completo de uma chamada:
//   áudio PCM → Deepgram (STT) → GPT-4o → TTS → playback no FreeSWITCH
import { DeepgramStreamer } from '../stt/deepgram.js';
import { askGPT } from '../llm/openai.js';
import { synthesize } from '../tts/tts.js';
import { log } from '../logger.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// Caminho onde gravamos áudio temporário para playback
const TMP = os.tmpdir();

export class CallHandler {
    #uuid;
    #esl;
    #stt = null;
    #running = false;
    #history = [];   // histórico de mensagens para o GPT

    constructor({ uuid, esl }) {
        this.#uuid = uuid;
        this.#esl = esl;
    }

    async start() {
        this.#running = true;
        log.info({ uuid: this.#uuid }, 'CallHandler: início');

        // 1. Ativa captura de áudio via mod_audio_stream ou uuid_record
        //    Aqui usamos uuid_record para gravar em tempo real e processar.
        //    Em produção, use mod_audio_stream para streaming direto ao Node.
        const recPath = path.join(TMP, `${this.#uuid}.wav`);
        await this.#esl.execute(this.#uuid, 'record', `${recPath} 10 200 5`);

        // 2. Inicia streamer Deepgram (WebSocket)
        this.#stt = new DeepgramStreamer({
            onTranscript: (text) => this.#onTranscript(text),
            onError: (err) => log.error({ uuid: this.#uuid, err }, 'Deepgram erro'),
        });
        await this.#stt.start();

        // 3. Alimenta o Deepgram com o áudio gravado em loop
        //    (em produção substitua pelo pipe direto do mod_audio_stream)
        this.#pipeAudio(recPath);
    }

    async #pipeAudio(recPath) {
        // Aguarda o arquivo existir
        let waited = 0;
        while (waited < 5000) {
            try { await fs.access(recPath); break; } catch { /* aguarda */ }
            await sleep(200);
            waited += 200;
        }

        // Lê e envia chunks em tempo real
        let offset = 0;
        while (this.#running) {
            try {
                const stat = await fs.stat(recPath);
                if (stat.size > offset) {
                    const fh = await fs.open(recPath, 'r');
                    const chunk = Buffer.alloc(stat.size - offset);
                    await fh.read(chunk, 0, chunk.length, offset);
                    await fh.close();
                    offset = stat.size;
                    this.#stt.send(chunk);
                }
            } catch { /* arquivo pode ainda não existir */ }
            await sleep(100);
        }
    }

    async #onTranscript(text) {
        if (!text?.trim()) return;
        log.info({ uuid: this.#uuid, text }, 'Transcrição recebida');

        // Acumula histórico para contexto multi-turn
        this.#history.push({ role: 'user', content: text });

        // 4. Envia para GPT-4o
        const reply = await askGPT(this.#history);
        this.#history.push({ role: 'assistant', content: reply });
        log.info({ uuid: this.#uuid, reply }, 'GPT-4o respondeu');

        // 5. Converte resposta em áudio (TTS)
        const audioPath = await synthesize(reply, this.#uuid);

        // 6. Faz playback no FreeSWITCH
        await this.#esl.execute(this.#uuid, 'playback', audioPath);
        log.info({ uuid: this.#uuid }, 'Playback executado');
    }

    stop() {
        this.#running = false;
        this.#stt?.close();
        log.info({ uuid: this.#uuid }, 'CallHandler: encerrado');
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));