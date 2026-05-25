// src/env.ts
// Valida e exporta todas as variáveis de ambiente via Zod.
// Node 24 carrega o .env nativamente com --env-file — sem dotenv.
import { z } from 'zod';

const schema = z.object({
  // FreeSWITCH ESL
  FS_HOST: z.string().default('127.0.0.1'),
  FS_ESL_PORT: z.coerce.number().int().positive().default(8021),
  FS_ESL_PASSWORD: z.string().min(1),

  // PostgreSQL
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('voipai'),
  DB_USER: z.string().default('voipai'),
  DB_PASS: z.string().min(1),

  // Deepgram
  DEEPGRAM_API_KEY: z.string().min(1),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  TTS_VOICE: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('nova'),

  // Node.js Agent
  PORT: z.coerce.number().int().positive().default(3000),
  AUDIO_WS_PORT: z.coerce.number().int().positive().default(8090),
  NODE_IP: z.string().default('10.197.3.1'),

  // Log
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

function parseEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Variáveis de ambiente inválidas:\n');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;
