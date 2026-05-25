// src/logger.ts
// Logger estruturado leve — sem dependências externas.
// Emite JSON em produção e texto colorido em dev.
import { env } from './env.js';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 } as const;
type Level = keyof typeof LEVELS;

const currentLevel = LEVELS[env.LOG_LEVEL];
const isProd = process.env.NODE_ENV === 'production';

const COLORS: Record<Level, string> = {
  trace: '\x1b[37m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

function write(level: Level, data: Record<string, unknown>, msg: string): void {
  if (LEVELS[level] < currentLevel) return;

  if (isProd) {
    process.stdout.write(
      `${JSON.stringify({ level: LEVELS[level], time: Date.now(), ...data, msg })}\n`,
    );
  } else {
    const ts = new Date().toISOString().slice(11, 23);
    const meta = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
    process.stdout.write(
      `${COLORS[level]}[${ts}] ${level.toUpperCase().padEnd(5)}${RESET} ${msg}${meta}\n`,
    );
  }
}

export const log = {
  trace: (data: Record<string, unknown> | string, msg?: string) =>
    typeof data === 'string' ? write('trace', {}, data) : write('trace', data, msg ?? ''),
  debug: (data: Record<string, unknown> | string, msg?: string) =>
    typeof data === 'string' ? write('debug', {}, data) : write('debug', data, msg ?? ''),
  info: (data: Record<string, unknown> | string, msg?: string) =>
    typeof data === 'string' ? write('info', {}, data) : write('info', data, msg ?? ''),
  warn: (data: Record<string, unknown> | string, msg?: string) =>
    typeof data === 'string' ? write('warn', {}, data) : write('warn', data, msg ?? ''),
  error: (data: Record<string, unknown> | string, msg?: string) =>
    typeof data === 'string' ? write('error', {}, data) : write('error', data, msg ?? ''),
};
