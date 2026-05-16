import { query, queryOne } from "./db.js";
import { Account } from "./types.js";

export async function listAccounts(): Promise<Account[]> {
  return query<Account>("SELECT * FROM accounts ORDER BY created_at DESC");
}

export async function getAccount(id: string): Promise<Account | null> {
  return queryOne<Account>("SELECT * FROM accounts WHERE id = $1", [id]);
}

export async function upsertAccount(input: {
  instagramUserId: string;
  accessToken: string;
  tokenType: string;
  permissions: string[];
  expiresAt: string | null;
  username?: string | null;
  name?: string | null;
  postsPerDay: number;
  postTimes: string[];
  publishAsReels: boolean;
  shareToFeed: boolean;
  defaultCaption: string;
}): Promise<Account> {
  return (await queryOne<Account>(
    `INSERT INTO accounts (
      instagram_user_id, access_token, token_type, permissions, expires_at, username, name,
      posts_per_day, post_times, publish_as_reels, share_to_feed, default_caption
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (instagram_user_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      token_type = EXCLUDED.token_type,
      permissions = EXCLUDED.permissions,
      expires_at = EXCLUDED.expires_at,
      username = COALESCE(EXCLUDED.username, accounts.username),
      name = COALESCE(EXCLUDED.name, accounts.name),
      active = true,
      updated_at = now()
    RETURNING *`,
    [
      input.instagramUserId,
      input.accessToken,
      input.tokenType,
      input.permissions,
      input.expiresAt,
      input.username ?? null,
      input.name ?? null,
      input.postsPerDay,
      input.postTimes,
      input.publishAsReels,
      input.shareToFeed,
      input.defaultCaption
    ]
  ))!;
}

export async function updateAccountSettings(
  id: string,
  settings: {
    active: boolean;
    postsPerDay: number;
    postTimes: string[];
    publishAsReels: boolean;
    shareToFeed: boolean;
    defaultCaption: string;
  }
): Promise<Account | null> {
  return queryOne<Account>(
    `UPDATE accounts SET
      active = $2,
      posts_per_day = $3,
      post_times = $4,
      publish_as_reels = $5,
      share_to_feed = $6,
      default_caption = $7,
      updated_at = now()
    WHERE id = $1
    RETURNING *`,
    [
      id,
      settings.active,
      settings.postsPerDay,
      settings.postTimes,
      settings.publishAsReels,
      settings.shareToFeed,
      settings.defaultCaption
    ]
  );
}

export async function updateAccountToken(
  id: string,
  token: { accessToken: string; tokenType: string; expiresAt: string | null }
): Promise<Account | null> {
  return queryOne<Account>(
    `UPDATE accounts SET access_token = $2, token_type = $3, expires_at = $4, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, token.accessToken, token.tokenType, token.expiresAt]
  );
}
