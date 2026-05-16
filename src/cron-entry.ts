// src/cron-entry.ts
import { AppScheduler } from "./app-scheduler.js";
import { bootstrapApp } from "./bootstrap.js";
import { logger } from "./logger.js";
import { closeDb } from "./db.js";

async function main() {
  try {
    const { publisher } = await bootstrapApp();

    const scheduler = new AppScheduler(publisher);

    const results = await scheduler.tickAt(new Date(), {
      toleranceMinutes: 10
    });

    logger.info("Cron", "Execucao finalizada", results);
  } catch (error) {
    logger.error("Cron", "Falha na execucao do cron", error);
    process.exitCode = 1;
  } finally {
    await closeDb?.().catch(() => undefined);
  }
}

main();