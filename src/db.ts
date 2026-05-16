import { Pool, PoolClient, QueryResultRow } from "pg";
import { AppConfig } from "./config.js";
import { logger } from "./logger.js";

let pool: Pool | null = null;

export function initDb(config: AppConfig): Pool {
  pool = new Pool({
    connectionString: config.databaseUrl
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
}

export function getPool(): Pool {
  if (!pool) throw new Error("Banco de dados nao inicializado");
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id BIGSERIAL PRIMARY KEY,
      instagram_user_id TEXT NOT NULL UNIQUE,
      username TEXT,
      name TEXT,
      access_token TEXT NOT NULL,
      token_type TEXT NOT NULL DEFAULT 'bearer',
      permissions TEXT[] NOT NULL DEFAULT '{}',
      expires_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT true,
      posts_per_day INTEGER NOT NULL DEFAULT 2,
      post_times TEXT[] NOT NULL DEFAULT ARRAY['10:00','19:00'],
      publish_as_reels BOOLEAN NOT NULL DEFAULT true,
      share_to_feed BOOLEAN NOT NULL DEFAULT true,
      default_caption TEXT NOT NULL DEFAULT 'Novo video no ar',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS media_items (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      public_url TEXT,
      storage_key TEXT,
      media_type TEXT NOT NULL DEFAULT 'video',
      caption TEXT,
      sha256 TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      container_id TEXT,
      post_id TEXT,
      last_error TEXT,
      meta_error JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS publish_events (
      id BIGSERIAL PRIMARY KEY,
      media_id BIGINT REFERENCES media_items(id) ON DELETE SET NULL,
      account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      message TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS cron_runs (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      run_date DATE NOT NULL,
      post_time TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, run_date, post_time)
    )`,
    `CREATE TABLE IF NOT EXISTS remote_posts (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      instagram_media_id TEXT NOT NULL,
      caption TEXT,
      media_type TEXT,
      media_product_type TEXT,
      media_url TEXT,
      permalink TEXT,
      thumbnail_url TEXT,
      timestamp TIMESTAMPTZ,
      like_count INTEGER,
      comments_count INTEGER,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (account_id, instagram_media_id)
    )`,
    `CREATE TABLE IF NOT EXISTS remote_comments (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      remote_post_id BIGINT NOT NULL REFERENCES remote_posts(id) ON DELETE CASCADE,
      instagram_comment_id TEXT NOT NULL,
      parent_comment_id TEXT,
      text TEXT,
      username TEXT,
      hidden BOOLEAN,
      like_count INTEGER,
      timestamp TIMESTAMPTZ,
      replied_locally BOOLEAN NOT NULL DEFAULT false,
      deleted_locally BOOLEAN NOT NULL DEFAULT false,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (account_id, instagram_comment_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_status_created ON media_items(status, created_at)`,
    `ALTER TABLE media_items ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'video'`,
    `ALTER TABLE media_items ADD COLUMN IF NOT EXISTS public_url TEXT`,
    `ALTER TABLE media_items ADD COLUMN IF NOT EXISTS storage_key TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_events_created ON publish_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_remote_posts_account_time ON remote_posts(account_id, timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_remote_comments_post_time ON remote_comments(remote_post_id, timestamp DESC)`
  ];

  for (const statement of statements) {
    await getPool().query(statement);
  }

  logger.info("DB", "Migracoes aplicadas");
}
