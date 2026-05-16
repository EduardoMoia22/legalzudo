import cron from "node-cron";
import { listAccounts } from "./account-repository.js";
import { query, queryOne } from "./db.js";
import { logger } from "./logger.js";
import { dailyPublishedCount } from "./media-repository.js";
import { Publisher } from "./publisher.js";

const BRAZIL_TIMEZONE = "America/Sao_Paulo";

type SchedulerResult = {
  accountId: string;
  status: "published" | "empty" | "failed" | "skipped" | "already_ran";
  message: string;
};

type TickOptions = {
  /**
   * Janela de tolerância para compensar atraso do cron.
   *
   * Exemplo:
   * - horário no banco: 08:00
   * - Railway executou: 08:03
   * - toleranceMinutes: 10
   * - publica normalmente.
   */
  toleranceMinutes?: number;
};

function getBrazilDateTimeKeys(now: Date): { dateKey: string; timeKey: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;

    if (!value) {
      throw new Error(`Nao foi possivel obter ${type} no timezone ${BRAZIL_TIMEZONE}`);
    }

    return value;
  };

  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  const timeKey = `${get("hour")}:${get("minute")}`;

  return { dateKey, timeKey };
}

function parseTimeToMinutes(time: string): number {
  const normalized = String(time).trim();

  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    throw new Error(`Horario invalido: ${time}. Use o formato HH:mm, exemplo: 08:00`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Horario invalido: ${time}. Use um horario entre 00:00 e 23:59`);
  }

  return hour * 60 + minute;
}

function normalizePostTime(time: string): string {
  const minutes = parseTimeToMinutes(time);

  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getDuePostTimes(
  accountPostTimes: string[],
  currentTimeKey: string,
  toleranceMinutes: number
): string[] {
  const currentMinutes = parseTimeToMinutes(currentTimeKey);

  const duePostTimes = accountPostTimes
    .map(normalizePostTime)
    .filter((postTime) => {
      const scheduledMinutes = parseTimeToMinutes(postTime);
      const diff = currentMinutes - scheduledMinutes;

      return diff >= 0 && diff <= toleranceMinutes;
    });

  return [...new Set(duePostTimes)];
}

export class AppScheduler {
  constructor(private readonly publisher: Publisher) {}

  /**
   * Use isso somente se você for rodar como worker 24/7.
   *
   * Para Railway Cron Job, prefira chamar diretamente:
   * scheduler.tickAt(new Date(), { toleranceMinutes: 10 })
   *
   * Porque na Railway Cron o processo deve executar uma vez e finalizar.
   */
  start(): void {
    cron.schedule(
      "* * * * *",
      () => {
        this.tick().catch((error) => {
          logger.error("Cron", "Falha no agendador", error);
        });
      },
      {
        timezone: BRAZIL_TIMEZONE
      }
    );

    logger.info("Cron", "Agendador por conta ativo, verificando a cada minuto no horario do Brasil");
  }

  async tick(): Promise<SchedulerResult[]> {
    return this.tickAt(new Date(), {
      toleranceMinutes: 1
    });
  }

  async tickAt(now: Date, options: TickOptions = {}): Promise<SchedulerResult[]> {
    const toleranceMinutes = options.toleranceMinutes ?? 10;

    const accounts = (await listAccounts()).filter((account) => account.active);
    const { dateKey, timeKey } = getBrazilDateTimeKeys(now);

    const results: SchedulerResult[] = [];

    logger.info(
      "Cron",
      `Verificando publicacoes. dateKey=${dateKey}, timeKey=${timeKey}, toleranceMinutes=${toleranceMinutes}`
    );

    for (const account of accounts) {
      const postTimes = Array.isArray(account.post_times) ? account.post_times : [];

      if (postTimes.length === 0) {
        continue;
      }

      const duePostTimes = getDuePostTimes(postTimes, timeKey, toleranceMinutes);

      if (duePostTimes.length === 0) {
        continue;
      }

      for (const postTime of duePostTimes) {
        const inserted = await queryOne<{ account_id: string }>(
          `INSERT INTO cron_runs (account_id, run_date, post_time)
           VALUES ($1, $2::date, $3)
           ON CONFLICT DO NOTHING
           RETURNING account_id`,
          [account.id, dateKey, postTime]
        );

        if (!inserted) {
          results.push({
            accountId: account.id,
            status: "already_ran",
            message: `Horario ${postTime} ja foi processado hoje`
          });

          continue;
        }

        const count = await dailyPublishedCount(account.id, dateKey);

        if (count >= account.posts_per_day) {
          logger.info(
            "Cron",
            `Limite diario atingido para ${account.username ?? account.instagram_user_id}`
          );

          results.push({
            accountId: account.id,
            status: "skipped",
            message: `Limite diario atingido no horario ${postTime}`
          });

          continue;
        }

        try {
          const media = await this.publisher.publishNextForAccount(account.id);

          results.push({
            accountId: account.id,
            status: media ? "published" : "empty",
            message: media
              ? `Publicado ${media.filename} no horario ${postTime}`
              : `Nenhuma midia aprovada no horario ${postTime}`
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          logger.error(
            "Cron",
            `Falha ao publicar para ${account.username ?? account.instagram_user_id} no horario ${postTime}`,
            error
          );

          results.push({
            accountId: account.id,
            status: "failed",
            message
          });
        }
      }
    }

    return results;
  }

  async getRuns(): Promise<
    Array<{ account_id: string; run_date: string; post_time: string; created_at: string }>
  > {
    return query("SELECT * FROM cron_runs ORDER BY created_at DESC LIMIT 100");
  }
}