// src/db/index.ts
import pg from 'pg';
import { z } from 'zod';
import { env } from '../env.js';
import { log } from '../logger.js';

const { Pool } = pg;

// ── Schemas Zod ───────────────────────────────────────────────

export const ResidentSchema = z.object({
  id: z.number(),
  apartment: z.string(),
  name: z.string(),
  sip_extension: z.string(),
  phone: z.string().nullable(),
  active: z.boolean(),
  created_at: z.date(),
});

export type Resident = z.infer<typeof ResidentSchema>;

// ── Database ──────────────────────────────────────────────────

export class Database {
  readonly #pool: pg.Pool;

  constructor() {
    this.#pool = new Pool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASS,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  async connect(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }

  async migrate(): Promise<void> {
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
        call_uuid   TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_transcripts_uuid ON transcripts(call_uuid);

      CREATE TABLE IF NOT EXISTS residents (
        id            SERIAL PRIMARY KEY,
        apartment     TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        sip_extension TEXT NOT NULL,
        phone         TEXT,
        active        BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO residents (apartment, name, sip_extension, phone) VALUES
        ('101', 'João Silva',   '1001', '+5549999990001'),
        ('102', 'Maria Santos', '1002', '+5549999990002'),
        ('201', 'Carlos Lima',  '1003', '+5549999990003'),
        ('202', 'Ana Costa',    '1004', '+5549999990004')
      ON CONFLICT (apartment) DO NOTHING;
    `);
    log.info('DB: migrations aplicadas');
  }

  query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.#pool.query(sql, params);
  }

  async findResident(apartment: string): Promise<Resident | null> {
    const { rows } = await this.#pool.query<Resident>(
      'SELECT * FROM residents WHERE apartment = $1 AND active = true',
      [apartment.trim()],
    );
    if (!rows[0]) return null;
    return ResidentSchema.parse(rows[0]);
  }

  async end(): Promise<void> {
    await this.#pool.end();
  }
}

export const db = new Database();
