// src/db/index.js
// Conexão com PostgreSQL e migrations iniciais
import pg from 'pg';
import { log } from '../logger.js';

const { Pool } = pg;

class Database {
    #pool;

    async connect() {
        this.#pool = new Pool({
            host: process.env.DB_HOST ?? '127.0.0.1',
            port: Number(process.env.DB_PORT ?? 5432),
            database: process.env.DB_NAME ?? 'voipai',
            user: process.env.DB_USER ?? 'voipai',
            password: process.env.DB_PASS ?? 'voipai',
            max: 10,
            idleTimeoutMillis: 30_000,
        });
        await this.#pool.query('SELECT 1');
    }

    async migrate() {
        await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id          SERIAL PRIMARY KEY,
        uuid        TEXT UNIQUE NOT NULL,
        direction   TEXT NOT NULL DEFAULT 'inbound',
        caller_id   TEXT,
        destination TEXT,
        started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at    TIMESTAMPTZ,
        duration_s  INTEGER
      );

      CREATE TABLE IF NOT EXISTS transcripts (
        id          SERIAL PRIMARY KEY,
        call_uuid   TEXT NOT NULL REFERENCES calls(uuid) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_transcripts_uuid ON transcripts(call_uuid);
    `);
        log.info('DB: migrations aplicadas');
    }

    query(sql, params) { return this.#pool.query(sql, params); }

    async end() { await this.#pool.end(); }
}

export const db = new Database();