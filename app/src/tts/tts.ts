import { exec } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
// src/tts/tts.ts
import OpenAI from 'openai';
import { env } from '../env.js';
import { log } from '../logger.js';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const execAsync = promisify(exec);

/**
 * Sintetiza texto em WAV 8 kHz / 16-bit / mono para playback no FreeSWITCH.
 * @returns Caminho absoluto do arquivo WAV gerado.
 */
export async function synthesize(text: string, uuid: string): Promise<string> {
  const base = join(tmpdir(), `tts-${uuid}-${Date.now()}`);
  const mp3 = `${base}.mp3`;
  const wav = `${base}.wav`;

  // 1. Gera MP3 via OpenAI TTS
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: env.TTS_VOICE,
    input: text,
    response_format: 'mp3',
    speed: 1.0,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(mp3, buffer);
  log.debug({ mp3 }, 'TTS: MP3 gerado');

  // 2. Converte MP3 → WAV 8 kHz / 16-bit / mono via ffmpeg
  await execAsync(`ffmpeg -y -i "${mp3}" -ar 8000 -ac 1 -acodec pcm_s16le "${wav}"`);
  log.debug({ wav }, 'TTS: WAV convertido');

  // 3. Remove MP3 temporário
  await unlink(mp3).catch(() => undefined);

  return wav;
}
