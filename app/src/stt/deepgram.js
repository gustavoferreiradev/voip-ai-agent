// src/stt/deepgram.js
// Streaming de áudio PCM → Deepgram via WebSocket (live transcription)
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { log } from '../logger.js';

export class DeepgramStreamer {
    #client;
    #live = null;
    #onTranscript;
    #onError;

    constructor({ onTranscript, onError }) {
        this.#onTranscript = onTranscript;
        this.#onError = onError;
        this.#client = createClient(process.env.DEEPGRAM_API_KEY);
    }

    async start() {
        this.#live = this.#client.listen.live({
            model: 'nova-2',
            language: 'pt-BR',          // Português do Brasil
            encoding: 'linear16',       // PCM L16 que o FreeSWITCH entrega
            sample_rate: 8000,          // 8kHz padrão VoIP
            channels: 1,
            smart_format: true,
            interim_results: true,      // resultados parciais em tempo real
            utterance_end_ms: 1000,     // detecta fim de fala após 1s de silêncio
            vad_events: true,
        });

        this.#live.on(LiveTranscriptionEvents.Open, () => {
            log.info('Deepgram: WebSocket aberto');
        });

        this.#live.on(LiveTranscriptionEvents.Transcript, (data) => {
            const transcript = data.channel?.alternatives?.[0]?.transcript;
            const isFinal = data.is_final;

            if (transcript && isFinal) {
                this.#onTranscript(transcript);
            }
        });

        this.#live.on(LiveTranscriptionEvents.UtteranceEnd, () => {
            log.debug('Deepgram: fim de utterance');
        });

        this.#live.on(LiveTranscriptionEvents.Error, (err) => {
            log.error({ err }, 'Deepgram: erro');
            this.#onError?.(err);
        });

        this.#live.on(LiveTranscriptionEvents.Close, () => {
            log.info('Deepgram: conexão fechada');
        });

        // Aguarda conexão abrir
        await new Promise((resolve, reject) => {
            this.#live.once(LiveTranscriptionEvents.Open, resolve);
            this.#live.once(LiveTranscriptionEvents.Error, reject);
        });
    }

    // Envia chunk de áudio PCM bruto
    send(audioBuffer) {
        if (this.#live?.getReadyState() === 1 /* OPEN */) {
            this.#live.send(audioBuffer);
        }
    }

    close() {
        this.#live?.finish();
    }
}