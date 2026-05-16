import axios from "axios";
import crypto from "node:crypto";
import { upsertAccount, updateAccountToken } from "./account-repository.js";
import { AppConfig } from "./config.js";
import { query, queryOne } from "./db.js";
import { logger } from "./logger.js";

export interface AuthRecord {
  accessToken: string;
  instagramUserId: string;
  permissions: string[];
  tokenType: string;
  expiresAt: string | null;
  updatedAt: string;
}

interface AuthFile {
  auth: AuthRecord | null;
  oauthState: string | null;
}

interface ShortLivedTokenResponse {
  access_token?: string;
  user_id?: string;
  permissions?: string | string[];
  data?: Array<{
    access_token: string;
    user_id: string;
    permissions?: string | string[];
  }>;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

const initialAuthFile: AuthFile = {
  auth: null,
  oauthState: null
};

function normalizePermissions(permissions: string | string[] | undefined): string[] {
  if (!permissions) return [];
  if (Array.isArray(permissions)) {
    return permissions.map((item) => item.trim()).filter(Boolean);
  }
  return permissions.split(",").map((item) => item.trim()).filter(Boolean);
}

function oauthErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const data = error.response?.data;
  if (typeof data === "object" && data !== null) {
    const payload = data as {
      error_message?: string;
      error_type?: string;
      error?: { message?: string; type?: string; code?: number };
    };
    const message = payload.error_message || payload.error?.message || error.message;
    const type = payload.error_type || payload.error?.type;
    const code = payload.error?.code;
    return [message, type ? `type=${type}` : null, code ? `code=${code}` : null].filter(Boolean).join(" ");
  }

  return error.message;
}

export class AuthManager {
  constructor(private readonly config: AppConfig) {}

  async init(): Promise<void> {
    return;
  }

  async getActiveAuth(): Promise<AuthRecord> {
    if (this.config.metaAccessToken && this.config.instagramUserId) {
      return {
        accessToken: this.config.metaAccessToken,
        instagramUserId: this.config.instagramUserId,
        permissions: [],
        tokenType: "bearer",
        expiresAt: null,
        updatedAt: new Date().toISOString()
      };
    }

    throw new Error("Nenhuma conta Instagram conectada. Abra /auth/login para autorizar sua conta.");
  }

  async createLoginUrl(): Promise<string> {
    this.assertOAuthConfig();
    const state = crypto.randomBytes(24).toString("hex");
    await query("INSERT INTO oauth_states (state) VALUES ($1)", [state]);

    const params = new URLSearchParams({
      client_id: this.config.instagramAppId!,
      redirect_uri: this.config.oauthRedirectUri!,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments",
      force_reauth: "true",
      state
    });

    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, state?: string): Promise<AuthRecord> {
    this.assertOAuthConfig();
    const stateRow = state ? await queryOne<{ state: string }>("DELETE FROM oauth_states WHERE state = $1 RETURNING state", [state]) : null;
    if (!stateRow) {
      throw new Error("OAuth state invalido. Tente iniciar o login novamente em /auth/login.");
    }

    const shortLived = await this.exchangeCodeForShortLivedToken(code);
    const token = await this.exchangeForLongLivedTokenOrFallback(shortLived.accessToken);
    const profile = await this.fetchProfile(token.access_token);
    const auth: AuthRecord = {
      accessToken: token.access_token,
      instagramUserId: shortLived.instagramUserId,
      permissions: shortLived.permissions,
      tokenType: token.token_type ?? "bearer",
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      updatedAt: new Date().toISOString()
    };

    await upsertAccount({
      instagramUserId: auth.instagramUserId,
      accessToken: auth.accessToken,
      tokenType: auth.tokenType,
      permissions: auth.permissions,
      expiresAt: auth.expiresAt,
      username: profile.username,
      name: profile.name,
      postsPerDay: this.config.postsPerDay,
      postTimes: this.config.postTimes,
      publishAsReels: this.config.publishAsReels,
      shareToFeed: this.config.shareToFeed,
      defaultCaption: this.config.defaultCaption
    });
    logger.info("Auth", `Conta Instagram conectada: ${auth.instagramUserId}`);
    return auth;
  }

  async refreshLongLivedToken(): Promise<AuthRecord> {
    throw new Error("Use refreshAccountToken(accountId) no modo multi-conta.");
  }

  async refreshAccountToken(accountId: string): Promise<AuthRecord> {
    const account = await queryOne<{
      id: string;
      access_token: string;
      instagram_user_id: string;
      permissions: string[];
    }>("SELECT id, access_token, instagram_user_id, permissions FROM accounts WHERE id = $1", [accountId]);
    if (!account) throw new Error("Conta nao encontrada");

    const response = await axios.get<LongLivedTokenResponse>("https://graph.instagram.com/refresh_access_token", {
      params: {
        grant_type: "ig_refresh_token",
        access_token: account.access_token
      },
      timeout: 30000
    });

    const auth: AuthRecord = {
      accessToken: response.data.access_token,
      instagramUserId: account.instagram_user_id,
      permissions: account.permissions,
      tokenType: response.data.token_type ?? "bearer",
      expiresAt: response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000).toISOString() : null,
      updatedAt: new Date().toISOString()
    };

    await updateAccountToken(accountId, {
      accessToken: auth.accessToken,
      tokenType: auth.tokenType,
      expiresAt: auth.expiresAt
    });
    logger.info("Auth", `Token renovado para conta ${account.instagram_user_id}`);
    return auth;
  }

  private async exchangeCodeForShortLivedToken(code: string): Promise<{
    accessToken: string;
    instagramUserId: string;
    permissions: string[];
  }> {
    const payload = new URLSearchParams({
      client_id: this.config.instagramAppId!,
      client_secret: this.config.instagramAppSecret!,
      grant_type: "authorization_code",
      redirect_uri: this.config.oauthRedirectUri!,
      code
    });

    let response;
    try {
      response = await axios.post<ShortLivedTokenResponse>("https://api.instagram.com/oauth/access_token", payload, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000
      });
    } catch (error) {
      throw new Error(`Falha ao trocar code por token curto: ${oauthErrorMessage(error)}`);
    }

    const tokenData = response.data.data?.[0] ?? response.data;
    if (!tokenData.access_token || !tokenData.user_id) {
      throw new Error("Resposta OAuth nao trouxe access_token ou user_id.");
    }

    return {
      accessToken: tokenData.access_token,
      instagramUserId: tokenData.user_id,
      permissions: normalizePermissions(tokenData.permissions)
    };
  }

  private async exchangeForLongLivedToken(shortLivedAccessToken: string): Promise<LongLivedTokenResponse> {
    let response;
    try {
      response = await axios.post<LongLivedTokenResponse>(
        "https://graph.instagram.com/access_token",
        new URLSearchParams({
          grant_type: "ig_exchange_token",
          client_secret: this.config.instagramAppSecret!,
          access_token: shortLivedAccessToken
        }),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 30000
        }
      );
    } catch (error) {
      throw new Error(`Falha ao trocar token curto por long-lived: ${oauthErrorMessage(error)}`);
    }
    return response.data;
  }

  private async exchangeForLongLivedTokenOrFallback(shortLivedAccessToken: string): Promise<LongLivedTokenResponse> {
    try {
      return await this.exchangeForLongLivedToken(shortLivedAccessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Auth", `${message}. Salvando token curto temporario; ajuste App Roles/App Review para long-lived.`);
      return {
        access_token: shortLivedAccessToken,
        token_type: "bearer-short-lived",
        expires_in: 3600
      };
    }
  }

  private async fetchProfile(accessToken: string): Promise<{ username: string | null; name: string | null }> {
    try {
      const response = await axios.get<{ username?: string; name?: string }>(
        `${this.config.graphApiHost}/${this.config.graphApiVersion}/me`,
        {
          params: { fields: "user_id,username,name" },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 30000
        }
      );
      return {
        username: response.data.username ?? null,
        name: response.data.name ?? null
      };
    } catch {
      return { username: null, name: null };
    }
  }

  private assertOAuthConfig(): void {
    const missing = [
      ["INSTAGRAM_APP_ID", this.config.instagramAppId],
      ["INSTAGRAM_APP_SECRET", this.config.instagramAppSecret],
      ["OAUTH_REDIRECT_URI", this.config.oauthRedirectUri]
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`Variaveis .env obrigatorias para OAuth ausentes: ${missing.join(", ")}`);
    }
  }
}
