// src/stt/deepgram.ts
import { LiveTranscriptionEvents, createClient } from '@deepgram/sdk';
import { env } from '../env.js';
import { log } from '../logger.js';

type LiveClient = ReturnType<ReturnType<typeof createClient>['listen']['live']>;

interface DeepgramStreamerOpts {
  onTranscript: (text: string) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

export class DeepgramStreamer {
  readonly #client: ReturnType<typeof createClient>;
  #live: LiveClient | null = null;
  readonly #onTranscript: (text: string) => void | Promise<void>;
  readonly #onError: ((err: unknown) => void) | undefined;

  constructor(opts: DeepgramStreamerOpts) {
    this.#onTranscript = opts.onTranscript;
    this.#onError = opts.onError;
    this.#client = createClient(env.DEEPGRAM_API_KEY);
  }

  async start(): Promise<void> {
    this.#live = this.#client.listen.live({
      model: 'nova-2',
      language: 'pt-BR',
      encoding: 'linear16',
      sample_rate: 8000,
      channels: 1,
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
    });

    const live = this.#live;

    live.on(LiveTranscriptionEvents.Open, () => {
      log.info('Deepgram: WebSocket aberto');
    });

    live.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript as string | undefined;
      if (transcript && data.is_final) {
        void this.#onTranscript(transcript);
      }
    });

    live.on(LiveTranscriptionEvents.Error, (err) => {
      log.error({ err }, 'Deepgram: erro');
      if (this.#onError) this.#onError(err);
    });

    live.on(LiveTranscriptionEvents.Close, () => {
      log.info('Deepgram: conexão fechada');
    });

    await new Promise<void>((resolve, reject) => {
      live.once(LiveTranscriptionEvents.Open, resolve);
      live.once(LiveTranscriptionEvents.Error, reject);
    });
  }

  send(chunk: Buffer): void {
    if (this.#live?.getReadyState() === 1) {
      // Deepgram SDK aceita ArrayBufferLike — converte Buffer para ArrayBuffer
      const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      this.#live.send(ab as ArrayBuffer);
    }
  }

  close(): void {
    this.#live?.finish();
    this.#live = null;
  }
}
