import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { normalizeCaption } from "./caption.js";
import { AppConfig } from "./config.js";
import { query, queryOne } from "./db.js";
import { StorageService } from "./storage-service.js";
import { MediaItem } from "./types.js";

const allowedVideoExtensions = new Set([".mp4", ".mov"]);
const allowedImageExtensions = new Set([".jpg", ".jpeg"]);
const convertibleImageExtensions = new Set([".png"]);

export function isVideoFilename(filename: string): boolean {
  return allowedVideoExtensions.has(path.extname(filename).toLowerCase());
}

export function isImageFilename(filename: string): boolean {
  return allowedImageExtensions.has(path.extname(filename).toLowerCase());
}

export function isConvertibleImageFilename(filename: string): boolean {
  return convertibleImageExtensions.has(path.extname(filename).toLowerCase());
}

export function isSupportedInputFilename(filename: string): boolean {
  return Boolean(getMediaType(filename)) || isConvertibleImageFilename(filename);
}

export function getMediaType(filename: string): "video" | "image" | null {
  if (isVideoFilename(filename)) return "video";
  if (isImageFilename(filename)) return "image";
  if (isConvertibleImageFilename(filename)) return "image";
  return null;
}

export async function normalizeMediaFile(filePath: string): Promise<{ filePath: string; filename: string; mediaType: "video" | "image" }> {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = getMediaType(filePath);
  if (!mediaType) throw new Error("Formato nao suportado. Use MP4, MOV, JPEG ou PNG.");

  if (ext !== ".png") {
    return { filePath, filename: path.basename(filePath), mediaType };
  }

  const parsed = path.parse(filePath);
  const targetPath = path.join(parsed.dir, `${parsed.name}.jpg`);
  await sharp(filePath)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(targetPath);
  await fs.unlink(filePath);
  return { filePath: targetPath, filename: path.basename(targetPath), mediaType: "image" };
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

export async function readCaptionForVideo(filePath: string, fallback: string): Promise<string> {
  const parsed = path.parse(filePath);
  const captionPath = path.join(parsed.dir, `${parsed.name}.txt`);
  try {
    const caption = normalizeCaption(await fs.readFile(captionPath, "utf8"));
    return caption || fallback;
  } catch {
    return fallback;
  }
}

export async function syncVideosDir(config: AppConfig, storage?: StorageService): Promise<number> {
  await fs.mkdir(config.videosDir, { recursive: true });
  const entries = await fs.readdir(config.videosDir, { withFileTypes: true });
  let inserted = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !isSupportedInputFilename(entry.name)) continue;
    const normalized = await normalizeMediaFile(path.join(config.videosDir, entry.name));
    const stored = storage ? await storage.storeLocalFile(normalized.filePath) : { publicUrl: null, storageKey: null };
    const sha256 = await hashFile(normalized.filePath);
    const caption = await readCaptionForVideo(normalized.filePath, config.defaultCaption);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO media_items (filename, original_name, file_path, public_url, storage_key, media_type, caption, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (sha256) DO NOTHING
       RETURNING id`,
      [
        normalized.filename,
        entry.name,
        normalized.filePath,
        stored.publicUrl,
        stored.storageKey,
        normalized.mediaType,
        caption,
        sha256
      ]
    );
    if (row) inserted += 1;
  }

  return inserted;
}

export async function insertUploadedMedia(input: {
  filename: string;
  originalName: string;
  filePath: string;
  publicUrl?: string | null;
  storageKey?: string | null;
  mediaType: "video" | "image";
  caption: string;
  sha256: string;
}): Promise<MediaItem | null> {
  return queryOne<MediaItem>(
    `INSERT INTO media_items (filename, original_name, file_path, public_url, storage_key, media_type, caption, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (sha256) DO NOTHING
     RETURNING *`,
    [
      input.filename,
      input.originalName,
      input.filePath,
      input.publicUrl ?? null,
      input.storageKey ?? null,
      input.mediaType,
      input.caption,
      input.sha256
    ]
  );
}

export async function listMedia(status?: string, limit = 24, offset = 0): Promise<MediaItem[]> {
  const sql = status
    ? "SELECT * FROM media_items WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
    : "SELECT * FROM media_items ORDER BY created_at DESC LIMIT $1 OFFSET $2";
  return query<MediaItem>(sql, status ? [status, limit, offset] : [limit, offset]);
}

export async function countMedia(status?: string): Promise<number> {
  const row = status
    ? await queryOne<{ count: string }>("SELECT count(*)::text FROM media_items WHERE status = $1", [status])
    : await queryOne<{ count: string }>("SELECT count(*)::text FROM media_items");
  return Number(row?.count ?? 0);
}

export async function mediaStatusCounts(): Promise<Record<string, number>> {
  const rows = await query<{ status: string; count: string }>(
    "SELECT status, count(*)::text FROM media_items GROUP BY status"
  );
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

export async function getMedia(id: string): Promise<MediaItem | null> {
  return queryOne<MediaItem>("SELECT * FROM media_items WHERE id = $1", [id]);
}

export async function getMediaMany(ids: string[]): Promise<MediaItem[]> {
  if (ids.length === 0) return [];
  return query<MediaItem>("SELECT * FROM media_items WHERE id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], id)", [
    ids
  ]);
}

export async function approveMedia(id: string, accountId: string, caption: string): Promise<MediaItem | null> {
  return queryOne<MediaItem>(
    `UPDATE media_items SET
      status = 'approved',
      approved_account_id = $2,
      caption = $3,
      approved_at = now(),
      last_error = NULL,
      meta_error = NULL
     WHERE id = $1 AND status IN ('pending','failed','rejected','approved')
     RETURNING *`,
    [id, accountId, caption]
  );
}

export async function approveAllMediaForAccount(accountId: string): Promise<MediaItem[]> {
  return query<MediaItem>(
    `UPDATE media_items SET
      status = 'approved',
      approved_account_id = $1,
      caption = COALESCE(NULLIF(caption, ''), caption),
      approved_at = now(),
      last_error = NULL,
      meta_error = NULL
     WHERE status IN ('pending','failed','rejected')
     RETURNING *`,
    [accountId]
  );
}

export async function updateAllEditableCaptions(caption: string): Promise<MediaItem[]> {
  return query<MediaItem>(
    `UPDATE media_items SET caption = $1
     WHERE status IN ('pending','approved','failed','rejected')
     RETURNING *`,
    [caption]
  );
}

export async function updateApprovedCaptions(caption: string): Promise<MediaItem[]> {
  return query<MediaItem>(
    `UPDATE media_items SET caption = $1
     WHERE status = 'approved'
     RETURNING *`,
    [caption]
  );
}

export async function rejectMedia(id: string): Promise<MediaItem | null> {
  return queryOne<MediaItem>(
    "UPDATE media_items SET status = 'rejected', approved_account_id = NULL WHERE id = $1 RETURNING *",
    [id]
  );
}

export async function nextApprovedMedia(accountId: string): Promise<MediaItem | null> {
  return queryOne<MediaItem>(
    `SELECT * FROM media_items
     WHERE status = 'approved' AND approved_account_id = $1
     ORDER BY approved_at ASC, created_at ASC
     LIMIT 1`,
    [accountId]
  );
}

export async function markPublishing(id: string, containerId: string): Promise<void> {
  await query("UPDATE media_items SET status = 'publishing', container_id = $2 WHERE id = $1", [id, containerId]);
}

export async function markPublished(id: string, postId: string): Promise<MediaItem | null> {
  return queryOne<MediaItem>(
    `UPDATE media_items SET status = 'published', post_id = $2, published_at = now(), last_error = NULL, meta_error = NULL
     WHERE id = $1 RETURNING *`,
    [id, postId]
  );
}

export async function markPublishedMany(ids: string[], postId: string): Promise<MediaItem[]> {
  if (ids.length === 0) return [];
  return query<MediaItem>(
    `UPDATE media_items SET status = 'published', post_id = $2, published_at = now(), last_error = NULL, meta_error = NULL
     WHERE id = ANY($1::bigint[])
     RETURNING *`,
    [ids, postId]
  );
}

export async function markFailedMany(ids: string[], message: string, metaError: unknown): Promise<MediaItem[]> {
  if (ids.length === 0) return [];
  return query<MediaItem>(
    `UPDATE media_items SET status = 'failed', last_error = $2, meta_error = $3, failed_at = now()
     WHERE id = ANY($1::bigint[])
     RETURNING *`,
    [ids, message, JSON.stringify(metaError ?? null)]
  );
}

export async function markFailed(id: string, message: string, metaError: unknown): Promise<MediaItem | null> {
  return queryOne<MediaItem>(
    `UPDATE media_items SET status = 'failed', last_error = $2, meta_error = $3, failed_at = now()
     WHERE id = $1 RETURNING *`,
    [id, message, JSON.stringify(metaError ?? null)]
  );
}

export async function addEvent(input: {
  mediaId?: string | null;
  accountId?: string | null;
  eventType: string;
  message?: string;
  meta?: unknown;
}): Promise<void> {
  await query(
    `INSERT INTO publish_events (media_id, account_id, event_type, message, meta)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.mediaId ?? null, input.accountId ?? null, input.eventType, input.message ?? null, JSON.stringify(input.meta ?? null)]
  );
}

export async function listEvents(limit = 80): Promise<
  Array<{
    id: string;
    event_type: string;
    message: string | null;
    created_at: string;
    filename: string | null;
    username: string | null;
    instagram_user_id: string | null;
  }>
> {
  return query(
    `SELECT e.id, e.event_type, e.message, e.created_at, m.filename, a.username, a.instagram_user_id
     FROM publish_events e
     LEFT JOIN media_items m ON m.id = e.media_id
     LEFT JOIN accounts a ON a.id = e.account_id
     ORDER BY e.created_at DESC
     LIMIT $1`,
    [limit]
  );
}

export async function dailyPublishedCount(accountId: string, dateKey: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text FROM media_items
     WHERE approved_account_id = $1 AND status = 'published' AND published_at::date = $2::date`,
    [accountId, dateKey]
  );
  return Number(row?.count ?? 0);
}
