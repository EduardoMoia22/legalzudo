import express from "express";
import mime from "mime-types";
import multer from "multer";
import path from "node:path";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { AuthManager } from "./auth-manager.js";
import { normalizeCaption } from "./caption.js";
import { getAccount, listAccounts, updateAccountSettings } from "./account-repository.js";
import { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import {
  approveMedia,
  approveAllMediaForAccount,
  countMedia,
  getMedia,
  hashFile,
  insertUploadedMedia,
  getMediaType,
  isSupportedInputFilename,
  listEvents,
  listMedia,
  mediaStatusCounts,
  normalizeMediaFile,
  readCaptionForVideo,
  rejectMedia,
  syncVideosDir,
  updateAllEditableCaptions,
  updateApprovedCaptions
} from "./media-repository.js";
import { Publisher } from "./publisher.js";
import { RemoteService } from "./remote-service.js";
import { StorageService } from "./storage-service.js";
import { toPublicAccount, toPublicMedia } from "./types.js";

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeFilename(filename: string): string {
  return filename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function publicMediaUrl(config: AppConfig, filename: string): string {
  return `${config.publicBaseUrl}/media/${encodeURIComponent(filename)}?key=${encodeURIComponent(config.publicFileKey)}`;
}

async function findPreviewPath(config: AppConfig, filename: string): Promise<string | null> {
  for (const dir of [config.videosDir, config.postedDir, config.failedDir]) {
    const candidate = path.resolve(dir, path.basename(filename));
    if (!isInside(dir, candidate)) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Continua procurando nas outras pastas.
    }
  }
  return null;
}

export function startMediaServer(
  config: AppConfig,
  authManager: AuthManager,
  publisher: Publisher,
  remoteService: RemoteService,
  storage: StorageService
): Promise<void> {
  const app = createApp(config, authManager, publisher, remoteService, storage);
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, () => {
      logger.info("Server", `Rodando em http://localhost:${config.port}`);
      logger.info("Server", "Health disponivel em /health");
      logger.info("Auth", "Login disponivel em /auth/login");
      resolve();
    });

    server.on("error", (error) => {
      logger.error("Server", "Falha ao iniciar servidor local", error);
      reject(error);
    });
  });
}

export function createApp(
  config: AppConfig,
  authManager: AuthManager,
  publisher: Publisher,
  remoteService: RemoteService,
  storage: StorageService
): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.resolve(process.cwd(), "public")));

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        await fs.mkdir(config.videosDir, { recursive: true });
        cb(null, config.videosDir);
      },
      filename: (_req, file, cb) => {
        const parsed = path.parse(safeFilename(file.originalname));
        const ext = parsed.ext.toLowerCase();
        cb(null, `${Date.now()}-${parsed.name}${ext}`);
      }
    }),
    fileFilter: (_req, file, cb) => {
      cb(null, isSupportedInputFilename(file.originalname));
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/auth/login", async (_req, res) => {
    try {
      const loginUrl = await authManager.createLoginUrl();
      res.redirect(loginUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Auth", "Falha ao iniciar login", error);
      res.status(500).json({ error: message });
    }
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      if (typeof req.query.error === "string") {
        res.status(400).send(`Instagram authorization failed: ${req.query.error_description ?? req.query.error}`);
        return;
      }

      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state = typeof req.query.state === "string" ? req.query.state : undefined;
      if (!code) {
        res.status(400).send("Missing authorization code");
        return;
      }

      await authManager.handleCallback(code, state);
      res.redirect("/?connected=1");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Auth", "Falha no callback OAuth", error);
      res.status(500).send(message);
    }
  });

  app.get("/auth/status", async (_req, res) => {
    const accounts = await listAccounts();
    res.json({
      connected: accounts.length > 0,
      accounts: accounts.map(toPublicAccount)
    });
  });

  app.post("/auth/refresh-token", async (req, res) => {
    try {
      const accountId = String(req.body.accountId ?? "");
      if (!accountId) throw new Error("accountId obrigatorio");
      const auth = await authManager.refreshAccountToken(accountId);
      res.json({
        refreshed: true,
        instagramUserId: auth.instagramUserId,
        expiresAt: auth.expiresAt,
        updatedAt: auth.updatedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Auth", "Falha ao renovar token", error);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/accounts", async (_req, res) => {
    const accounts = await listAccounts();
    res.json({ accounts: accounts.map(toPublicAccount) });
  });

  app.patch("/api/accounts/:id", async (req, res) => {
    try {
      const body = req.body as {
        active?: boolean;
        postsPerDay?: number;
        postTimes?: string[];
        publishAsReels?: boolean;
        shareToFeed?: boolean;
        defaultCaption?: string;
      };
      const postTimes = body.postTimes ?? [];
      if (!Array.isArray(postTimes) || postTimes.some((time) => !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time))) {
        throw new Error("postTimes precisa ser uma lista de horarios HH:mm");
      }
      const account = await updateAccountSettings(req.params.id, {
        active: Boolean(body.active),
        postsPerDay: Number(body.postsPerDay ?? 2),
        postTimes,
        publishAsReels: Boolean(body.publishAsReels),
        shareToFeed: Boolean(body.shareToFeed),
        defaultCaption: String(body.defaultCaption ?? "")
      });
      if (!account) {
        res.status(404).json({ error: "Conta nao encontrada" });
        return;
      }
      res.json({ account: toPublicAccount(account) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/media/sync", async (_req, res) => {
    const inserted = await syncVideosDir(config, storage);
    res.json({ inserted });
  });

  app.post("/api/media/upload", upload.array("media", 30), async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) throw new Error("Ao menos uma midia e obrigatoria");

      const media = [];
      const duplicates = [];
      const sharedCaption = normalizeCaption(req.body.caption);

      for (const file of files) {
        const normalized = await normalizeMediaFile(file.path);
        const stored = await storage.storeLocalFile(normalized.filePath);
        const caption = sharedCaption || (await readCaptionForVideo(normalized.filePath, config.defaultCaption));
        const sha256 = await hashFile(normalized.filePath);
        const inserted = await insertUploadedMedia({
          filename: normalized.filename,
          originalName: file.originalname,
          filePath: normalized.filePath,
          publicUrl: stored.publicUrl,
          storageKey: stored.storageKey,
          mediaType: normalized.mediaType,
          caption,
          sha256
        });
        if (!inserted) {
          await fs.unlink(normalized.filePath);
          duplicates.push(file.originalname);
          continue;
        }
        media.push(toPublicMedia(inserted, `/preview/${encodeURIComponent(inserted.filename)}`));
      }

      res.json({ media, inserted: media.length, duplicates });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/media", async (req, res) => {
    if (!storage.isR2Enabled()) await syncVideosDir(config, storage);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 24), 1), 60);
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const offset = (page - 1) * limit;
    const media = await listMedia(status, limit, offset);
    const total = await countMedia(status);
    const counts = await mediaStatusCounts();
    res.json({
      media: media.map((item) => toPublicMedia(item, `/preview/${encodeURIComponent(item.filename)}`)),
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      counts
    });
  });

  app.post("/api/media/:id/approve", async (req, res) => {
    try {
      const accountId = String(req.body.accountId ?? "");
      if (!accountId || !(await getAccount(accountId))) throw new Error("Conta invalida");
      const existing = await getMedia(req.params.id);
      if (!existing) {
        res.status(404).json({ error: "Midia nao encontrada" });
        return;
      }
      const caption = normalizeCaption(req.body.caption ?? existing.caption ?? "");
      const media = await approveMedia(req.params.id, accountId, caption);
      res.json({ media: media ? toPublicMedia(media, `/preview/${encodeURIComponent(media.filename)}`) : null });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/media/approve-all", async (req, res) => {
    try {
      const accountId = String(req.body.accountId ?? "");
      if (!accountId || !(await getAccount(accountId))) throw new Error("Conta invalida");
      const media = await approveAllMediaForAccount(accountId);
      res.json({ media: media.map((item) => toPublicMedia(item, `/preview/${encodeURIComponent(item.filename)}`)) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/media/captions/apply-all", async (req, res) => {
    try {
      const caption = normalizeCaption(req.body.caption);
      if (!caption) throw new Error("Legenda obrigatoria");
      const media = await updateAllEditableCaptions(caption);
      res.json({ media: media.map((item) => toPublicMedia(item, `/preview/${encodeURIComponent(item.filename)}`)) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/media/captions/approved", async (req, res) => {
    try {
      const caption = normalizeCaption(req.body.caption);
      if (!caption) throw new Error("Legenda obrigatoria");
      const media = await updateApprovedCaptions(caption);
      res.json({ media: media.map((item) => toPublicMedia(item, `/preview/${encodeURIComponent(item.filename)}`)) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/media/:id/reject", async (req, res) => {
    const media = await rejectMedia(req.params.id);
    res.json({ media: media ? toPublicMedia(media, `/preview/${encodeURIComponent(media.filename)}`) : null });
  });

  app.post("/api/media/carousel/publish", async (req, res) => {
    try {
      const accountId = String(req.body.accountId ?? "");
      const mediaIds = Array.isArray(req.body.mediaIds) ? req.body.mediaIds.map(String) : [];
      const caption = req.body.caption ? normalizeCaption(req.body.caption) : undefined;
      if (!accountId) throw new Error("accountId obrigatorio");
      const media = await publisher.publishCarousel(accountId, mediaIds, caption);
      res.json({ media: media.map((item) => toPublicMedia(item, `/preview/${encodeURIComponent(item.filename)}`)) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/media/:id/publish", async (req, res) => {
    try {
      const accountId = req.body.accountId ? String(req.body.accountId) : undefined;
      const media = await publisher.publishMediaById(req.params.id, accountId);
      res.json({ media: toPublicMedia(media, `/preview/${encodeURIComponent(media.filename)}`) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/accounts/:id/publish-next", async (req, res) => {
    try {
      const media = await publisher.publishNextForAccount(req.params.id);
      res.json({ media: media ? toPublicMedia(media, `/preview/${encodeURIComponent(media.filename)}`) : null });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/events", async (_req, res) => {
    res.json({ events: await listEvents() });
  });

  app.get("/api/accounts/:id/posts", async (req, res) => {
    try {
      const posts = await remoteService.listPosts(req.params.id);
      res.json({ posts });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/accounts/:id/posts/sync", async (req, res) => {
    try {
      const posts = await remoteService.syncPosts(req.params.id);
      res.json({ posts });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/posts/:postId/comments", async (req, res) => {
    try {
      const comments = await remoteService.listComments(req.params.postId);
      res.json({ comments });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/posts/:postId/comments/sync", async (req, res) => {
    try {
      const accountId = String(req.body.accountId ?? "");
      if (!accountId) throw new Error("accountId obrigatorio");
      const comments = await remoteService.syncComments(accountId, req.params.postId);
      res.json({ comments });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/comments/:commentId/reply", async (req, res) => {
    try {
      const message = String(req.body.message ?? "").trim();
      if (!message) throw new Error("Mensagem obrigatoria");
      const replyId = await remoteService.replyToComment(req.params.commentId, message);
      res.json({ replyId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/comments/:commentId/hide", async (req, res) => {
    try {
      const hidden = Boolean(req.body.hidden);
      const comment = await remoteService.setCommentHidden(req.params.commentId, hidden);
      res.json({ comment });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/comments/:commentId", async (req, res) => {
    try {
      const comment = await remoteService.deleteComment(req.params.commentId);
      res.json({ comment });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/preview/:filename", async (req, res) => {
    const filePath = await findPreviewPath(config, req.params.filename);
    if (!filePath) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const contentType = mime.lookup(filePath) || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    createReadStream(filePath).pipe(res);
  });

  app.get("/media/:filename", async (req, res) => {
    try {
      if (req.query.key !== config.publicFileKey) {
        res.status(401).json({ error: "invalid key" });
        return;
      }

      const filename = req.params.filename;
      const baseName = path.basename(filename);
      if (baseName !== filename) {
        res.status(400).json({ error: "invalid filename" });
        return;
      }

      const filePath = path.resolve(config.videosDir, baseName);
      if (!isInside(config.videosDir, filePath)) {
        res.status(400).json({ error: "invalid path" });
        return;
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        res.status(404).json({ error: "not found" });
        return;
      }

      const contentType = mime.lookup(filePath) || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Accept-Ranges", "bytes");
      createReadStream(filePath).pipe(res);
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/media/:id/public-url", async (req, res) => {
    const media = await getMedia(req.params.id);
    if (!media) {
      res.status(404).json({ error: "Midia nao encontrada" });
      return;
    }
    res.json({ url: media.public_url || publicMediaUrl(config, media.filename) });
  });

  return app;
}
