import axios from "axios";
import { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import { Account } from "./types.js";

interface CreateContainerResponse {
  id: string;
}

interface PublishResponse {
  id: string;
}

interface ContainerStatusResponse {
  id?: string;
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  status?: string;
  error_message?: string;
}

export interface InstagramRemotePost {
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
}

export interface InstagramRemoteComment {
  id: string;
  text?: string;
  username?: string;
  hidden?: boolean;
  like_count?: number;
  timestamp?: string;
  replies?: {
    data?: InstagramRemoteComment[];
  };
}

interface GraphListResponse<T> {
  data?: T[];
  paging?: {
    next?: string;
  };
}

export class MetaApiError extends Error {
  constructor(message: string, readonly metaError?: unknown) {
    super(message);
    this.name = "MetaApiError";
  }
}

function getMetaError(error: unknown): unknown {
  if (axios.isAxiosError(error)) return error.response?.data ?? error.message;
  return error;
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message || error.message;
  }

  if (error instanceof Error) return error.message;

  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFormPayload(values: Record<string, string | number | boolean | undefined | null>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }

  return params;
}

export class InstagramService {
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = `${config.graphApiHost}/${config.graphApiVersion}`;
  }

  async createMediaContainer(
    account: Account,
    mediaUrl: string,
    caption: string,
    mediaType: "video" | "image"
  ): Promise<string> {
    const endpoint = `${this.baseUrl}/${account.instagram_user_id}/media`;

    logger.info("Meta", "Criando container", {
      instagramUserId: account.instagram_user_id,
      mediaType,
      publishAsReels: account.publish_as_reels,
      mediaUrl,
      captionLength: caption.length
    });

    const payload =
      mediaType === "image"
        ? buildFormPayload({
          image_url: mediaUrl,
          caption,
          access_token: account.access_token
        })
        : buildFormPayload({
          media_type: "REELS",
          video_url: mediaUrl,
          caption,
          access_token: account.access_token

          /**
           * Deixa desligado no primeiro teste.
           * Depois que publicar, você pode recolocar:
           *
           * share_to_feed: account.share_to_feed
           */
        });

    try {
      const response = await axios.post<CreateContainerResponse>(endpoint, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 120000
      });

      logger.info("Meta", `Container criado: ${response.data.id}`);

      return response.data.id;
    } catch (error) {
      logger.error("Meta", "Erro ao criar container", getMetaError(error));
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async createCarouselItemContainer(
    account: Account,
    mediaUrl: string,
    mediaType: "video" | "image"
  ): Promise<string> {
    const endpoint = `${this.baseUrl}/${account.instagram_user_id}/media`;

    logger.info("Meta", "Criando item de carrossel", {
      instagramUserId: account.instagram_user_id,
      mediaType,
      mediaUrl
    });

    const payload =
      mediaType === "image"
        ? buildFormPayload({
          is_carousel_item: true,
          image_url: mediaUrl,
          access_token: account.access_token
        })
        : buildFormPayload({
          is_carousel_item: true,
          media_type: "VIDEO",
          video_url: mediaUrl,
          access_token: account.access_token
        });

    try {
      const response = await axios.post<CreateContainerResponse>(endpoint, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 120000
      });

      logger.info("Meta", `Item de carrossel criado: ${response.data.id}`);

      return response.data.id;
    } catch (error) {
      logger.error("Meta", "Erro ao criar item de carrossel", getMetaError(error));
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async createCarouselContainer(account: Account, children: string[], caption: string): Promise<string> {
    const endpoint = `${this.baseUrl}/${account.instagram_user_id}/media`;

    logger.info("Meta", "Criando container de carrossel", {
      instagramUserId: account.instagram_user_id,
      childrenCount: children.length,
      captionLength: caption.length
    });

    const payload = buildFormPayload({
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
      access_token: account.access_token
    });

    try {
      const response = await axios.post<CreateContainerResponse>(endpoint, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 120000
      });

      logger.info("Meta", `Container de carrossel criado: ${response.data.id}`);

      return response.data.id;
    } catch (error) {
      logger.error("Meta", "Erro ao criar container de carrossel", getMetaError(error));
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async getContainerStatus(account: Account, containerId: string): Promise<ContainerStatusResponse> {
    try {
      const response = await axios.get<ContainerStatusResponse>(`${this.baseUrl}/${containerId}`, {
        params: {
          fields: "id,status_code,status,error_message",
          access_token: account.access_token
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async waitUntilContainerReady(account: Account, containerId: string): Promise<void> {
    const timeoutAt = Date.now() + this.config.maxProcessingWaitMinutes * 60 * 1000;

    while (Date.now() < timeoutAt) {
      const status = await this.getContainerStatus(account, containerId);

      logger.info(
        "Meta",
        `Status container ${containerId}: ${status.status_code ?? "UNKNOWN"}${status.status ? ` - ${status.status}` : ""}`
      );

      if (status.status_code === "FINISHED") return;

      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
        logger.error("Meta", "Container falhou no processamento", {
          containerId,
          status
        });

        throw new MetaApiError(`Container processing failed: ${status.status_code}`, status);
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }

    throw new MetaApiError(`Timeout aguardando processamento por ${this.config.maxProcessingWaitMinutes} minutos`);
  }

  async publishMedia(account: Account, containerId: string): Promise<string> {
    const endpoint = `${this.baseUrl}/${account.instagram_user_id}/media_publish`;

    logger.info("Meta", "Publicando midia", {
      instagramUserId: account.instagram_user_id,
      containerId
    });

    const payload = buildFormPayload({
      creation_id: containerId,
      access_token: account.access_token
    });

    try {
      const response = await axios.post<PublishResponse>(endpoint, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 120000
      });

      logger.info("Meta", `Publicado com sucesso: ${response.data.id}`);

      return response.data.id;
    } catch (error) {
      logger.error("Meta", "Erro ao publicar midia", getMetaError(error));
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async listAccountMedia(account: Account): Promise<InstagramRemotePost[]> {
    try {
      const response = await axios.get<GraphListResponse<InstagramRemotePost>>(
        `${this.baseUrl}/${account.instagram_user_id}/media`,
        {
          params: {
            fields: "id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count",
            limit: 50,
            access_token: account.access_token
          },
          timeout: 30000
        }
      );

      return response.data.data ?? [];
    } catch (error) {
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async listMediaComments(account: Account, instagramMediaId: string): Promise<InstagramRemoteComment[]> {
    try {
      const response = await axios.get<GraphListResponse<InstagramRemoteComment>>(
        `${this.baseUrl}/${instagramMediaId}/comments`,
        {
          params: {
            fields: "id,text,username,hidden,like_count,timestamp,replies{id,text,username,hidden,like_count,timestamp}",
            limit: 100,
            access_token: account.access_token
          },
          timeout: 30000
        }
      );

      return response.data.data ?? [];
    } catch (error) {
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async replyToComment(account: Account, instagramCommentId: string, message: string): Promise<string> {
    const payload = buildFormPayload({
      message,
      access_token: account.access_token
    });

    try {
      const response = await axios.post<{ id: string }>(`${this.baseUrl}/${instagramCommentId}/replies`, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 30000
      });

      return response.data.id;
    } catch (error) {
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async setCommentHidden(account: Account, instagramCommentId: string, hidden: boolean): Promise<void> {
    const payload = buildFormPayload({
      hide: hidden,
      access_token: account.access_token
    });

    try {
      await axios.post(`${this.baseUrl}/${instagramCommentId}`, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 30000
      });
    } catch (error) {
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }

  async deleteComment(account: Account, instagramCommentId: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/${instagramCommentId}`, {
        params: {
          access_token: account.access_token
        },
        timeout: 30000
      });
    } catch (error) {
      throw new MetaApiError(getErrorMessage(error), getMetaError(error));
    }
  }
}