import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bootstrapApp } from "../src/bootstrap.js";
import { createApp } from "../src/media-server.js";

let handlerPromise: Promise<ReturnType<typeof createApp>> | null = null;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = bootstrapApp().then(({ config, authManager, publisher, remoteService, storage }) =>
      createApp(config, authManager, publisher, remoteService, storage)
    );
  }
  return handlerPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getHandler();
  return app(req, res);
}
