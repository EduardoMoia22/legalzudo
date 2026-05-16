import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export interface AppConfig {
  metaAccessToken: string | null;
  instagramUserId: string | null;
  instagramAppId: string | null;
  instagramAppSecret: string | null;
  oauthRedirectUri: string | null;
  graphApiVersion: string;
  graphApiHost: string;
  databaseUrl: string;
  r2Endpoint: string | null;
  r2AccessKeyId: string | null;
  r2SecretAccessKey: string | null;
  r2Bucket: string | null;
  r2PublicBaseUrl: string | null;
  cronSecret: string | null;
  publicBaseUrl: string;
  publicFileKey: string;
  port: number;
  videosDir: string;
  postedDir: string;
  failedDir: string;
  dataDir: string;
  stateFile: string;
  authFile: string;
  postsPerDay: number;
  postTimes: string[];
  publishAsReels: boolean;
  shareToFeed: boolean;
  defaultCaption: string;
  maxProcessingWaitMinutes: number;
  pollIntervalSeconds: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel .env obrigatoria ausente: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function optionalNullable(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function toPositiveInt(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} precisa ser um numero inteiro positivo. Valor recebido: ${raw}`);
  }
  return value;
}

function toBool(name: string, fallback: boolean): boolean {
  const raw = optional(name, String(fallback)).toLowerCase();
  if (["true", "1", "yes", "y", "sim"].includes(raw)) return true;
  if (["false", "0", "no", "n", "nao", "não"].includes(raw)) return false;
  throw new Error(`${name} precisa ser true ou false. Valor recebido: ${raw}`);
}

function parsePostTimes(value: string): string[] {
  const times = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (times.length === 0) throw new Error("POST_TIMES precisa ter ao menos um horario HH:mm");

  for (const time of times) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!match) throw new Error(`Horario invalido em POST_TIMES: ${time}. Use HH:mm, exemplo 10:00`);
  }

  return times;
}

function resolveFromCwd(dir: string): string {
  return path.resolve(process.cwd(), dir);
}

export function loadConfig(): AppConfig {
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/+$/, "");
  if (!publicBaseUrl.startsWith("https://")) {
    throw new Error("PUBLIC_BASE_URL precisa ser uma URL publica HTTPS");
  }

  const graphApiHost = optional("GRAPH_API_HOST", "https://graph.instagram.com").replace(/\/+$/, "");
  if (!graphApiHost.startsWith("https://")) {
    throw new Error("GRAPH_API_HOST precisa ser uma URL HTTPS");
  }

  const dataDir = resolveFromCwd(optional("DATA_DIR", "data"));
  const oauthRedirectUri = optionalNullable("OAUTH_REDIRECT_URI");
  if (oauthRedirectUri && !oauthRedirectUri.startsWith("https://")) {
    throw new Error("OAUTH_REDIRECT_URI precisa ser uma URL HTTPS cadastrada no Meta App Dashboard");
  }

  return {
    metaAccessToken: optionalNullable("META_ACCESS_TOKEN"),
    instagramUserId: optionalNullable("INSTAGRAM_USER_ID"),
    instagramAppId: optionalNullable("INSTAGRAM_APP_ID"),
    instagramAppSecret: optionalNullable("INSTAGRAM_APP_SECRET"),
    oauthRedirectUri,
    graphApiVersion: optional("GRAPH_API_VERSION", "v25.0"),
    graphApiHost,
    databaseUrl: optional("DATABASE_URL", "postgres://autofoda:autofoda@localhost:5432/autofoda"),
    r2Endpoint: optionalNullable("R2_ENDPOINT"),
    r2AccessKeyId: optionalNullable("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: optionalNullable("R2_SECRET_ACCESS_KEY"),
    r2Bucket: optionalNullable("R2_BUCKET"),
    r2PublicBaseUrl: optionalNullable("R2_PUBLIC_BASE_URL")?.replace(/\/+$/, "") ?? null,
    cronSecret: optionalNullable("CRON_SECRET"),
    publicBaseUrl,
    publicFileKey: required("PUBLIC_FILE_KEY"),
    port: toPositiveInt("PORT", 3000),
    videosDir: resolveFromCwd(optional("VIDEOS_DIR", "videos")),
    postedDir: resolveFromCwd(optional("POSTED_DIR", "posted")),
    failedDir: resolveFromCwd(optional("FAILED_DIR", "failed")),
    dataDir,
    stateFile: path.join(dataDir, "state.json"),
    authFile: path.join(dataDir, "auth.json"),
    postsPerDay: toPositiveInt("POSTS_PER_DAY", 2),
    postTimes: parsePostTimes(optional("POST_TIMES", "10:00,19:00")),
    publishAsReels: toBool("PUBLISH_AS_REELS", true),
    shareToFeed: toBool("SHARE_TO_FEED", true),
    defaultCaption: optional("DEFAULT_CAPTION", "Novo video no ar"),
    maxProcessingWaitMinutes: toPositiveInt("MAX_PROCESSING_WAIT_MINUTES", 20),
    pollIntervalSeconds: toPositiveInt("POLL_INTERVAL_SECONDS", 15)
  };
}
