type LogMeta = Record<string, unknown> | Error | unknown;

function formatMeta(meta?: LogMeta): string {
  if (!meta) return "";
  if (meta instanceof Error) return ` ${meta.message}`;
  if (typeof meta === "string") return ` ${meta}`;
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

export const logger = {
  info(scope: string, message: string, meta?: LogMeta) {
    console.log(`[${scope}] ${message}${formatMeta(meta)}`);
  },
  warn(scope: string, message: string, meta?: LogMeta) {
    console.warn(`[${scope}] ${message}${formatMeta(meta)}`);
  },
  error(scope: string, message: string, meta?: LogMeta) {
    console.error(`[${scope}] ${message}${formatMeta(meta)}`);
  }
};
