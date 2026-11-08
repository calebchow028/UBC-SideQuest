export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type Meta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: Meta): void;
  info(message: string, meta?: Meta): void;
  warn(message: string, meta?: Meta): void;
  error(message: string, meta?: Meta): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Minimal structured logger (one JSON object per line). Callers are responsible
 * for never putting secrets (tokens, webhook URLs, API keys) into `meta`.
 */
export function createLogger(level: LogLevel = 'info'): Logger {
  const write = (lvl: Exclude<LogLevel, 'silent'>, message: string, meta?: Meta) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, message, ...meta });
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}

export const silentLogger: Logger = createLogger('silent');

/** Describe an unknown thrown value without leaking stack traces or request details. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
