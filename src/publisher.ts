import fs from "node:fs/promises";
import path from "node:path";
import { getAccount } from "./account-repository.js";
import { normalizeCaption } from "./caption.js";
import { AppConfig } from "./config.js";
import { InstagramService, MetaApiError } from "./instagram.service.js";
import { logger } from "./logger.js";
import {
  addEvent,
  getMedia,
  getMediaMany,
  markFailed,
  markFailedMany,
  markPublished,
  markPublishedMany,
  markPublishing,
  nextApprovedMedia
} from "./media-repository.js";
import { Account, MediaItem } from "./types.js";

function buildPublicUrl(config: AppConfig, media: MediaItem): string {
  if (media.public_url) return media.public_url;
  return `${config.r2PublicBaseUrl}/media/${encodeURIComponent(media.filename)}?key=${encodeURIComponent(config.publicFileKey)}`;
}

async function moveIfExists(source: string, targetDir: string): Promise<string | null> {
  try {
    await fs.access(source);
  } catch {
    return null;
  }
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(source));
  await fs.rename(source, target);
  return target;
}

export class Publisher {
  constructor(
    private readonly config: AppConfig,
    private readonly instagram: InstagramService
  ) {}

  async publishNextForAccount(accountId: string): Promise<MediaItem | null> {
    const account = await getAccount(accountId);
    if (!account) throw new Error("Conta nao encontrada");
    const media = await nextApprovedMedia(accountId);
    if (!media) {
      logger.info("App", `Nenhuma midia aprovada para conta ${account.instagram_user_id}`);
      return null;
    }
    return this.publishMedia(account, media);
  }

  async publishMediaById(mediaId: string, accountId?: string): Promise<MediaItem> {
    const media = await getMedia(mediaId);
    if (!media) throw new Error("Midia nao encontrada");

    const selectedAccountId = accountId ?? media.approved_account_id;
    if (!selectedAccountId) throw new Error("Selecione uma conta para publicar esta midia");

    const account = await getAccount(selectedAccountId);
    if (!account) throw new Error("Conta nao encontrada");
    return this.publishMedia(account, media);
  }

  async publishCarousel(accountId: string, mediaIds: string[], caption?: string): Promise<MediaItem[]> {
    if (mediaIds.length < 2 || mediaIds.length > 10) {
      throw new Error("Carrossel precisa ter entre 2 e 10 midias");
    }
    const account = await getAccount(accountId);
    if (!account) throw new Error("Conta nao encontrada");

    const media = await getMediaMany(mediaIds);
    if (media.length !== mediaIds.length) throw new Error("Uma ou mais midias nao foram encontradas");

    for (const item of media) {
      if (item.status !== "approved") throw new Error(`Midia ${item.filename} precisa estar aprovada`);
      if (item.approved_account_id !== account.id) {
        throw new Error(`Midia ${item.filename} nao esta aprovada para a conta selecionada`);
      }
    }

    const carouselCaption = normalizeCaption(caption) || media[0]?.caption || account.default_caption || this.config.defaultCaption;
    const childContainerIds: string[] = [];
    const itemIds = media.map((item) => item.id);

    try {
      await addEvent({
        accountId: account.id,
        eventType: "carousel_start",
        message: `Criando carrossel com ${media.length} midias`,
        meta: { mediaIds }
      });

      for (const item of media) {
        const publicUrl = buildPublicUrl(this.config, item);
        const childId = await this.instagram.createCarouselItemContainer(account, publicUrl, item.media_type);
        childContainerIds.push(childId);
        await markPublishing(item.id, childId);
        await this.instagram.waitUntilContainerReady(account, childId);
      }

      const carouselContainerId = await this.instagram.createCarouselContainer(account, childContainerIds, carouselCaption);
      await this.instagram.waitUntilContainerReady(account, carouselContainerId);
      const postId = await this.instagram.publishMedia(account, carouselContainerId);
      const updated = await markPublishedMany(itemIds, postId);

      await addEvent({
        accountId: account.id,
        eventType: "carousel_published",
        message: `Carrossel publicado com sucesso: ${postId}`,
        meta: { carouselContainerId, childContainerIds, postId, mediaIds }
      });

      for (const item of media) {
        const moved = await moveIfExists(item.file_path, this.config.postedDir);
        if (moved) logger.info("App", `Movido para ${moved}`);
      }

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const metaError = error instanceof MetaApiError ? error.metaError : error;
      logger.error("Meta", "Erro retornado pela Meta", metaError);
      await markFailedMany(itemIds, message, metaError);
      await addEvent({
        accountId: account.id,
        eventType: "carousel_failed",
        message,
        meta: { metaError, mediaIds, childContainerIds }
      });
      throw error;
    }
  }

  private async publishMedia(account: Account, media: MediaItem): Promise<MediaItem> {
    if (!["approved", "failed"].includes(media.status)) {
      throw new Error(`Midia precisa estar aprovada ou com falha para publicar. Status atual: ${media.status}`);
    }

    const caption = normalizeCaption(media.caption || account.default_caption || this.config.defaultCaption);
    const publicUrl = buildPublicUrl(this.config, media);
    logger.info("App", `Publicando ${media.filename} em ${account.username ?? account.instagram_user_id}`);
    logger.info("App", `URL publica: ${publicUrl}`);

    try {
      await addEvent({
        mediaId: media.id,
        accountId: account.id,
        eventType: "container_start",
        message: `Criando container para ${media.filename}`
      });
      const containerId = await this.instagram.createMediaContainer(account, publicUrl, caption, media.media_type);
      await markPublishing(media.id, containerId);

      await this.instagram.waitUntilContainerReady(account, containerId);
      const postId = await this.instagram.publishMedia(account, containerId);
      const updated = await markPublished(media.id, postId);

      await addEvent({
        mediaId: media.id,
        accountId: account.id,
        eventType: "published",
        message: `Publicado com sucesso: ${postId}`,
        meta: { containerId, postId }
      });

      const moved = await moveIfExists(media.file_path, this.config.postedDir);
      if (moved) logger.info("App", `Movido para ${moved}`);
      return updated ?? media;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const metaError = error instanceof MetaApiError ? error.metaError : error;
      logger.error("Meta", "Erro retornado pela Meta", metaError);
      const updated = await markFailed(media.id, message, metaError);
      await addEvent({
        mediaId: media.id,
        accountId: account.id,
        eventType: "failed",
        message,
        meta: metaError
      });
      const moved = await moveIfExists(media.file_path, this.config.failedDir);
      if (moved) logger.info("App", `Movido para ${moved}`);
      throw error;
    }
  }
}
