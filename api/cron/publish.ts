import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AppScheduler } from "../../src/app-scheduler.js";
import { bootstrapApp } from "../../src/bootstrap.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { config, publisher } = await bootstrapApp();
  if (config.cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${config.cronSecret}` && req.query.secret !== config.cronSecret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const scheduler = new AppScheduler(publisher);
  const results = await scheduler.tickAt(new Date());
  res.json({ ok: true, results });
}
