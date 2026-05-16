import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import { AppConfig } from "./config.js";

export interface StoredMedia {
  filePath: string;
  publicUrl: string | null;
  storageKey: string | null;
}

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export class StorageService {
  private readonly client: S3Client | null;

  constructor(private readonly config: AppConfig) {
    this.client = this.isR2Enabled()
      ? new S3Client({
          region: "auto",
          endpoint: config.r2Endpoint!,
          credentials: {
            accessKeyId: config.r2AccessKeyId!,
            secretAccessKey: config.r2SecretAccessKey!
          }
        })
      : null;
  }

  isR2Enabled(): boolean {
    return Boolean(
      this.config.r2Endpoint &&
        this.config.r2AccessKeyId &&
        this.config.r2SecretAccessKey &&
        this.config.r2Bucket &&
        this.config.r2PublicBaseUrl
    );
  }

  async storeLocalFile(filePath: string): Promise<StoredMedia> {
    if (!this.client) {
      return { filePath, publicUrl: null, storageKey: null };
    }

    const filename = path.basename(filePath);
    const key = `media/${Date.now()}-${filename}`;
    const body = await fs.readFile(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.r2Bucket!,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(filename)
      })
    );

    return {
      filePath,
      publicUrl: `${this.config.r2PublicBaseUrl}/${key}`,
      storageKey: key
    };
  }
}
