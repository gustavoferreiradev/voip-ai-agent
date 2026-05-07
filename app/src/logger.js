// src/logger.js — singleton de logger, sem dependências internas
import pino from 'pino';

const VALID_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const rawLevel = process.env.LOG_LEVEL ?? '';
const level = VALID_LEVELS.includes(rawLevel) ? rawLevel : 'info';

export const log = pino({
    level,
    transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});