import { logger } from "./logger.js";
import { startMediaServer } from "./media-server.js";
import { AppScheduler } from "./app-scheduler.js";
import { bootstrapApp } from "./bootstrap.js";

async function main(): Promise<void> {
  const mode = process.argv[2] === "once" ? "once" : "start";
  const { config, authManager, publisher, remoteService, storage } = await bootstrapApp();
  const scheduler = new AppScheduler(publisher);

  await startMediaServer(config, authManager, publisher, remoteService, storage);

  if (mode === "once") {
    logger.info("App", "Modo unico ativado");
    throw new Error("Use o botao 'Postar agora' no painel ou POST /api/accounts/:id/publish-next no modo multi-conta.");
  }

  scheduler.start();
}

main().catch((error) => {
  logger.error("App", "Falha fatal", error);
  process.exitCode = 1;
});
