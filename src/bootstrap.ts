import fs from "node:fs/promises";
import { AuthManager } from "./auth-manager.js";
import { loadConfig } from "./config.js";
import { initDb, migrate } from "./db.js";
import { InstagramService } from "./instagram.service.js";
import { Publisher } from "./publisher.js";
import { RemoteService } from "./remote-service.js";
import { StorageService } from "./storage-service.js";

let bootPromise: Promise<AppServices> | null = null;

export interface AppServices {
  config: ReturnType<typeof loadConfig>;
  authManager: AuthManager;
  instagramService: InstagramService;
  publisher: Publisher;
  remoteService: RemoteService;
  storage: StorageService;
}

export async function bootstrapApp(): Promise<AppServices> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    const config = loadConfig();
    initDb(config);
    await migrate();

    await Promise.all([
      fs.mkdir(config.videosDir, { recursive: true }),
      fs.mkdir(config.postedDir, { recursive: true }),
      fs.mkdir(config.failedDir, { recursive: true }),
      fs.mkdir(config.dataDir, { recursive: true })
    ]);

    const authManager = new AuthManager(config);
    const instagramService = new InstagramService(config);
    const publisher = new Publisher(config, instagramService);
    const remoteService = new RemoteService(instagramService);
    const storage = new StorageService(config);
    await authManager.init();

    return { config, authManager, instagramService, publisher, remoteService, storage };
  })();
  return bootPromise;
}
