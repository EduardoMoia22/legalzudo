import { query, queryOne } from "./db.js";

export interface RemotePost {
  id: string;
  account_id: string;
  instagram_media_id: string;
  caption: string | null;
  media_type: string | null;
  media_product_type: string | null;
  media_url: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  timestamp: string | null;
  like_count: number | null;
  comments_count: number | null;
  synced_at: string;
}

export interface RemoteComment {
  id: string;
  account_id: string;
  remote_post_id: string;
  instagram_comment_id: string;
  parent_comment_id: string | null;
  text: string | null;
  username: string | null;
  hidden: boolean | null;
  like_count: number | null;
  timestamp: string | null;
  replied_locally: boolean;
  deleted_locally: boolean;
  synced_at: string;
}

export async function upsertRemotePost(accountId: string, post: {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}): Promise<RemotePost> {
  return (await queryOne<RemotePost>(
    `INSERT INTO remote_posts (
      account_id, instagram_media_id, caption, media_type, media_product_type,
      media_url, permalink, thumbnail_url, timestamp, like_count, comments_count
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (account_id, instagram_media_id) DO UPDATE SET
      caption = EXCLUDED.caption,
      media_type = EXCLUDED.media_type,
      media_product_type = EXCLUDED.media_product_type,
      media_url = EXCLUDED.media_url,
      permalink = EXCLUDED.permalink,
      thumbnail_url = EXCLUDED.thumbnail_url,
      timestamp = EXCLUDED.timestamp,
      like_count = EXCLUDED.like_count,
      comments_count = EXCLUDED.comments_count,
      synced_at = now()
    RETURNING *`,
    [
      accountId,
      post.id,
      post.caption ?? null,
      post.media_type ?? null,
      post.media_product_type ?? null,
      post.media_url ?? null,
      post.permalink ?? null,
      post.thumbnail_url ?? null,
      post.timestamp ?? null,
      post.like_count ?? null,
      post.comments_count ?? null
    ]
  ))!;
}

export async function listRemotePosts(accountId: string): Promise<RemotePost[]> {
  return query<RemotePost>(
    "SELECT * FROM remote_posts WHERE account_id = $1 ORDER BY timestamp DESC NULLS LAST, synced_at DESC",
    [accountId]
  );
}

export async function getRemotePost(id: string, accountId?: string): Promise<RemotePost | null> {
  return accountId
    ? queryOne<RemotePost>("SELECT * FROM remote_posts WHERE id = $1 AND account_id = $2", [id, accountId])
    : queryOne<RemotePost>("SELECT * FROM remote_posts WHERE id = $1", [id]);
}

export async function upsertRemoteComment(accountId: string, remotePostId: string, comment: {
  id: string;
  parent_comment_id?: string | null;
  text?: string;
  username?: string;
  hidden?: boolean;
  like_count?: number;
  timestamp?: string;
}): Promise<RemoteComment> {
  return (await queryOne<RemoteComment>(
    `INSERT INTO remote_comments (
      account_id, remote_post_id, instagram_comment_id, parent_comment_id,
      text, username, hidden, like_count, timestamp
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (account_id, instagram_comment_id) DO UPDATE SET
      remote_post_id = EXCLUDED.remote_post_id,
      parent_comment_id = EXCLUDED.parent_comment_id,
      text = EXCLUDED.text,
      username = EXCLUDED.username,
      hidden = EXCLUDED.hidden,
      like_count = EXCLUDED.like_count,
      timestamp = EXCLUDED.timestamp,
      deleted_locally = false,
      synced_at = now()
    RETURNING *`,
    [
      accountId,
      remotePostId,
      comment.id,
      comment.parent_comment_id ?? null,
      comment.text ?? null,
      comment.username ?? null,
      comment.hidden ?? null,
      comment.like_count ?? null,
      comment.timestamp ?? null
    ]
  ))!;
}

export async function listCommentsForPost(remotePostId: string): Promise<RemoteComment[]> {
  return query<RemoteComment>(
    `SELECT * FROM remote_comments
     WHERE remote_post_id = $1 AND deleted_locally = false
     ORDER BY timestamp DESC NULLS LAST, synced_at DESC`,
    [remotePostId]
  );
}

export async function getRemoteComment(id: string): Promise<RemoteComment | null> {
  return queryOne<RemoteComment>("SELECT * FROM remote_comments WHERE id = $1", [id]);
}

export async function markCommentHidden(id: string, hidden: boolean): Promise<RemoteComment | null> {
  return queryOne<RemoteComment>("UPDATE remote_comments SET hidden = $2, synced_at = now() WHERE id = $1 RETURNING *", [
    id,
    hidden
  ]);
}

export async function markCommentReplied(id: string): Promise<RemoteComment | null> {
  return queryOne<RemoteComment>("UPDATE remote_comments SET replied_locally = true WHERE id = $1 RETURNING *", [id]);
}

export async function markCommentDeleted(id: string): Promise<RemoteComment | null> {
  return queryOne<RemoteComment>(
    "UPDATE remote_comments SET deleted_locally = true, synced_at = now() WHERE id = $1 RETURNING *",
    [id]
  );
}
