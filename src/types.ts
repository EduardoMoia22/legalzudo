export interface Account {
  id: string;
  instagram_user_id: string;
  username: string | null;
  name: string | null;
  access_token: string;
  token_type: string;
  permissions: string[];
  expires_at: string | null;
  active: boolean;
  posts_per_day: number;
  post_times: string[];
  publish_as_reels: boolean;
  share_to_feed: boolean;
  default_caption: string;
  created_at: string;
  updated_at: string;
}

export interface PublicAccount {
  id: string;
  instagramUserId: string;
  username: string | null;
  name: string | null;
  permissions: string[];
  expiresAt: string | null;
  active: boolean;
  postsPerDay: number;
  postTimes: string[];
  publishAsReels: boolean;
  shareToFeed: boolean;
  defaultCaption: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaItem {
  id: string;
  filename: string;
  original_name: string;
  file_path: string;
  public_url: string | null;
  storage_key: string | null;
  media_type: "video" | "image";
  caption: string | null;
  sha256: string;
  status: "pending" | "approved" | "publishing" | "published" | "failed" | "rejected";
  approved_account_id: string | null;
  container_id: string | null;
  post_id: string | null;
  last_error: string | null;
  meta_error: unknown;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
  failed_at: string | null;
}

export interface PublicMediaItem {
  id: string;
  filename: string;
  originalName: string;
  mediaType: MediaItem["media_type"];
  caption: string | null;
  status: MediaItem["status"];
  approvedAccountId: string | null;
  containerId: string | null;
  postId: string | null;
  lastError: string | null;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  failedAt: string | null;
  previewUrl: string;
}

export function toPublicAccount(account: Account): PublicAccount {
  return {
    id: account.id,
    instagramUserId: account.instagram_user_id,
    username: account.username,
    name: account.name,
    permissions: account.permissions,
    expiresAt: account.expires_at,
    active: account.active,
    postsPerDay: account.posts_per_day,
    postTimes: account.post_times,
    publishAsReels: account.publish_as_reels,
    shareToFeed: account.share_to_feed,
    defaultCaption: account.default_caption,
    createdAt: account.created_at,
    updatedAt: account.updated_at
  };
}

export function toPublicMedia(media: MediaItem, previewUrl: string): PublicMediaItem {
  return {
    id: media.id,
    filename: media.filename,
    originalName: media.original_name,
    mediaType: media.media_type,
    caption: media.caption,
    status: media.status,
    approvedAccountId: media.approved_account_id,
    containerId: media.container_id,
    postId: media.post_id,
    lastError: media.last_error,
    createdAt: media.created_at,
    approvedAt: media.approved_at,
    publishedAt: media.published_at,
    failedAt: media.failed_at,
    previewUrl: media.public_url || previewUrl
  };
}
