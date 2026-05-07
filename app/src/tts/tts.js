// src/tts/tts.js
// Converte texto em áudio (WAV 8kHz mono) para playback no FreeSWITCH
// Usa OpenAI TTS (gpt-4o-audio ou tts-1) como provedor padrão
import OpenAI from 'openai';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { log } from '../logger.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const execAsync = promisify(exec);
const TMP = os.tmpdir();

/**
 * Sintetiza texto em áudio WAV 8kHz mono e retorna o caminho do arquivo.
 * O FreeSWITCH consegue fazer playback de WAV 8kHz/16-bit/mono nativamente.
 *
 * @param {string} text   - Texto a sintetizar
 * @param {string} uuid   - UUID da chamada (usado no nome do arquivo)
 * @returns {Promise<string>} - Caminho absoluto do arquivo WAV
 */
export async function synthesize(text, uuid) {
    const mp3Path = path.join(TMP, `tts-${uuid}-${Date.now()}.mp3`);
    const wavPath = mp3Path.replace('.mp3', '.wav');

    // 1. Gera áudio MP3 via OpenAI TTS
    const response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: process.env.TTS_VOICE ?? 'nova',   // nova soa bem em PT-BR
        input: text,
        response_format: 'mp3',
        speed: 1.0,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(mp3Path, buffer);
    log.debug({ mp3Path }, 'TTS: MP3 gerado');

    // 2. Converte MP3 → WAV 8kHz / 16-bit / mono via ffmpeg
    //    O FreeSWITCH prefere este formato para playback direto
    await execAsync(
        `ffmpeg -y -i "${mp3Path}" -ar 8000 -ac 1 -acodec pcm_s16le "${wavPath}"`
    );
    log.debug({ wavPath }, 'TTS: WAV convertido');

    // 3. Remove MP3 temporário
    await fs.unlink(mp3Path).catch(() => { });

    return wavPath;
}