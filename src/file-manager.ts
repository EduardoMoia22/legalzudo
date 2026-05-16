import fs from "node:fs/promises";
import path from "node:path";
import { AppConfig } from "./config.js";
import { StateManager } from "./state-manager.js";

export interface VideoCandidate {
  filename: string;
  filePath: string;
  caption: string;
}

const allowedVideoExtensions = new Set([".mp4", ".mov"]);

async function moveAssociatedCaption(sourceVideoPath: string, targetDir: string): Promise<void> {
  const parsed = path.parse(sourceVideoPath);
  const captionPath = path.join(parsed.dir, `${parsed.name}.txt`);
  try {
    await fs.access(captionPath);
  } catch {
    return;
  }
  await fs.rename(captionPath, path.join(targetDir, `${parsed.name}.txt`));
}

export class FileManager {
  constructor(
    private readonly config: AppConfig,
    private readonly stateManager: StateManager
  ) {}

  async ensureDirs(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.config.videosDir, { recursive: true }),
      fs.mkdir(this.config.postedDir, { recursive: true }),
      fs.mkdir(this.config.failedDir, { recursive: true }),
      fs.mkdir(this.config.dataDir, { recursive: true })
    ]);
  }

  async getNextVideo(): Promise<VideoCandidate | null> {
    await this.ensureDirs();
    const entries = await fs.readdir(this.config.videosDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .filter((entry) => allowedVideoExtensions.has(path.extname(entry.name).toLowerCase()))
        .map(async (entry) => {
          const filePath = path.join(this.config.videosDir, entry.name);
          const stat = await fs.stat(filePath);
          return { filename: entry.name, filePath, birthtimeMs: stat.birthtimeMs, mtimeMs: stat.mtimeMs };
        })
    );

    files.sort((a, b) => a.birthtimeMs - b.birthtimeMs || a.mtimeMs - b.mtimeMs || a.filename.localeCompare(b.filename));

    for (const file of files) {
      if (await this.stateManager.isAlreadyHandled(file.filename)) continue;

      const parsed = path.parse(file.filePath);
      const captionPath = path.join(parsed.dir, `${parsed.name}.txt`);
      let caption = this.config.defaultCaption;
      try {
        const customCaption = (await fs.readFile(captionPath, "utf8")).trim();
        if (customCaption) caption = customCaption;
      } catch {
        // Sem legenda customizada: usa DEFAULT_CAPTION.
      }

      return { filename: file.filename, filePath: file.filePath, caption };
    }

    return null;
  }

  async moveToPosted(candidate: VideoCandidate): Promise<string> {
    await fs.mkdir(this.config.postedDir, { recursive: true });
    const targetPath = path.join(this.config.postedDir, candidate.filename);
    await fs.rename(candidate.filePath, targetPath);
    await moveAssociatedCaption(candidate.filePath, this.config.postedDir);
    return targetPath;
  }

  async moveToFailed(candidate: VideoCandidate): Promise<string> {
    await fs.mkdir(this.config.failedDir, { recursive: true });
    const targetPath = path.join(this.config.failedDir, candidate.filename);
    await fs.rename(candidate.filePath, targetPath);
    await moveAssociatedCaption(candidate.filePath, this.config.failedDir);
    return targetPath;
  }
}
