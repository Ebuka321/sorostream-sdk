import { redactSecretKey } from './internal.js';

/**
 * Ordered log levels from most-verbose to most-silent.
 * Set `minLevel` to suppress noisier levels in production.
 *
 * - `'debug'`  — fine-grained diagnostic information
 * - `'info'`   — general operational messages
 * - `'warn'`   — recoverable problems / unexpected conditions
 * - `'error'`  — unrecoverable errors that need attention
 * - `'silent'` — suppress all output
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Numeric priority for each level (lower = more verbose). */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Logger interface used throughout the SDK.
 * Implement this to route SDK log output to any destination.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /**
   * Returns a namespaced logger for a module (e.g. `'connectionPool'`,
   * `'retry'`) whose level overrides take precedence over the global level
   * (issue #703). Optional so third-party `Logger` implementations stay
   * source-compatible; use `withModule()` for a null-safe way to obtain one.
   */
  child?(moduleName: string): Logger;
}

/**
 * Returns a namespaced child logger for `moduleName`.
 *
 * Falls back to `logger` itself when the logger does not implement `child`,
 * so this is safe to call with any `Logger` implementation.
 *
 * @example
 * ```ts
 * const logger = createLogger({ minLevel: 'warn', moduleLevels: { retry: 'debug' } });
 * withModule(logger, 'retry').debug('backoff attempt 2');
 * ```
 */
export function withModule(logger: Logger, moduleName: string): Logger {
  return logger.child?.(moduleName) ?? logger;
}

/**
 * A logger that silently discards every message.
 * Used as the default when no logger is configured.
 */
export class NoopLogger implements Logger {
  debug(_message: string, ..._args: unknown[]): void {}
  info(_message: string, ..._args: unknown[]): void {}
  warn(_message: string, ..._args: unknown[]): void {}
  error(_message: string, ..._args: unknown[]): void {}
  /** Every namespace discards messages too, so the logger itself is returned. */
  child(_moduleName: string): Logger {
    return this;
  }
}

/**
 * A logger that writes to the global `console`.
 * Only emits messages whose level is >= `minLevel`.
 *
 * @example
 * ```ts
 * const logger = new ConsoleLogger('info'); // suppresses debug
 * ```
 */
export class ConsoleLogger implements Logger {
  private readonly minPriority: number;

  constructor(private readonly minLevel: LogLevel = 'info') {
    this.minPriority = LEVEL_PRIORITY[minLevel];
  }

  debug(message: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY.debug >= this.minPriority) {
      console.debug(`[sorostream] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY.info >= this.minPriority) {
      console.info(`[sorostream] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY.warn >= this.minPriority) {
      console.warn(`[sorostream] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY.error >= this.minPriority) {
      console.error(`[sorostream] ${message}`, ...args);
    }
  }

  /** `ConsoleLogger` has no per-module overrides, so namespaces share its level. */
  child(_moduleName: string): Logger {
    return this;
  }
}

/**
 * A logger decorator that redacts Stellar secret keys (S... strings) from
 * all log messages and arguments before forwarding them to a delegate logger.
 *
 * Wrap any `Logger` implementation to ensure secrets never reach log sinks.
 *
 * @example
 * ```ts
 * const logger = new SanitizingLogger(new ConsoleLogger('debug'));
 * ```
 */
export class SanitizingLogger implements Logger {
  constructor(private readonly delegate: Logger) {}

  debug(message: string, ...args: unknown[]): void {
    const cleanMsg = redactSecretKey(message);
    const cleanArgs = args.map((a) => (typeof a === 'string' ? redactSecretKey(a) : a));
    this.delegate.debug(cleanMsg, ...cleanArgs);
  }

  info(message: string, ...args: unknown[]): void {
    const cleanMsg = redactSecretKey(message);
    const cleanArgs = args.map((a) => (typeof a === 'string' ? redactSecretKey(a) : a));
    this.delegate.info(cleanMsg, ...cleanArgs);
  }

  warn(message: string, ...args: unknown[]): void {
    const cleanMsg = redactSecretKey(message);
    const cleanArgs = args.map((a) => (typeof a === 'string' ? redactSecretKey(a) : a));
    this.delegate.warn(cleanMsg, ...cleanArgs);
  }

  error(message: string, ...args: unknown[]): void {
    const cleanMsg = redactSecretKey(message);
    const cleanArgs = args.map((a) => (typeof a === 'string' ? redactSecretKey(a) : a));
    this.delegate.error(cleanMsg, ...cleanArgs);
  }

  /** Keeps secret redaction for every namespace while delegating the level. */
  child(moduleName: string): Logger {
    return new SanitizingLogger(this.delegate.child?.(moduleName) ?? this.delegate);
  }
}

/**
 * A logger decorator that resolves an effective level per module namespace.
 *
 * `moduleLevels[moduleName]` wins over the global `defaultLevel`, so one
 * subsystem can be raised (or silenced) without changing the rest (issue #703).
 *
 * Returned by `createLogger({ moduleLevels })`; obtain namespaced instances
 * with `logger.child('moduleName')` or `withModule(logger, 'moduleName')`.
 *
 * @example
 * ```ts
 * const logger = createLogger({
 *   minLevel: 'error',
 *   moduleLevels: { connectionPool: 'debug' },
 * });
 * logger.child?.('connectionPool').debug('reusing idle socket'); // logged
 * logger.debug('global debug');                                  // dropped
 * ```
 */
export class NamespacedLogger implements Logger {
  constructor(
    private readonly delegate: Logger,
    private readonly defaultLevel: LogLevel,
    private readonly moduleLevels: Readonly<Record<string, LogLevel>> = {},
    private readonly moduleName?: string,
  ) {}

  /** Level for this namespace: its override if configured, else the global level. */
  get effectiveLevel(): LogLevel {
    if (this.moduleName !== undefined) {
      const override = this.moduleLevels[this.moduleName];
      if (override !== undefined) return override;
    }
    return this.defaultLevel;
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.effectiveLevel];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.enabled('debug')) this.delegate.debug(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (this.enabled('info')) this.delegate.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.enabled('warn')) this.delegate.warn(message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (this.enabled('error')) this.delegate.error(message, ...args);
  }

  /** Shares the same override map and delegate with a different namespace. */
  child(moduleName: string): Logger {
    return new NamespacedLogger(this.delegate, this.defaultLevel, this.moduleLevels, moduleName);
  }
}

export interface CreateLoggerOptions {
  /**
   * Minimum level to emit. Messages below this level are discarded.
   * Defaults to `'info'`.
   */
  minLevel?: LogLevel;
  /**
   * When `true` (default), wraps the underlying logger in a `SanitizingLogger`
   * to redact any Stellar secret keys that might appear in log messages.
   */
  sanitize?: boolean;
  /**
   * Provide your own `Logger` implementation instead of the built-in
   * `ConsoleLogger`. When specified, `minLevel` is ignored (configure
   * the external logger directly).
   */
  delegate?: Logger;
  /**
   * Per-module (namespace) level overrides, e.g.
   * `{ connectionPool: 'debug', retry: 'silent' }` (issue #703).
   *
   * Each override takes precedence over `minLevel` for loggers obtained via
   * `logger.child(moduleName)` / `withModule(logger, moduleName)`; namespaces
   * without an override keep the global level. Providing overrides makes the
   * returned logger filter levels itself, so a `delegate` should then emit
   * everything it is handed.
   */
  moduleLevels?: Record<string, LogLevel>;
}

/**
 * Factory that returns a ready-to-use logger.
 *
 * By default returns a sanitizing `ConsoleLogger` at `'info'` level.
 * Pass `{ minLevel: 'debug' }` for verbose output or `{ minLevel: 'silent' }`
 * to suppress everything.
 *
 * @example
 * ```ts
 * // Default — info + above, secrets redacted
 * const logger = createLogger();
 *
 * // Debug — all messages, no sanitization
 * const debugLogger = createLogger({ minLevel: 'debug', sanitize: false });
 *
 * // Bring-your-own pino/winston logger
 * const pinoLogger = createLogger({ delegate: pino() });
 *
 * // Per-module overrides: quiet globally, verbose for one subsystem
 * const scoped = createLogger({
 *   minLevel: 'warn',
 *   moduleLevels: { connectionPool: 'debug' },
 * });
 * scoped.child?.('connectionPool').debug('reusing idle socket'); // logged
 * scoped.debug('global debug');                                  // dropped
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { minLevel = 'info', sanitize = true, delegate, moduleLevels } = options;
  const hasModuleLevels = moduleLevels !== undefined && Object.keys(moduleLevels).length > 0;

  if (!hasModuleLevels) {
    if (minLevel === 'silent' && !delegate) {
      return new NoopLogger();
    }
    const base: Logger = delegate ?? new ConsoleLogger(minLevel);
    return sanitize ? new SanitizingLogger(base) : base;
  }

  // With module overrides the wrapper owns level filtering, so the delegate
  // must be able to emit every level the wrapper lets through — build the
  // console logger at the most verbose configured level.
  const mostVerbose = Object.values(moduleLevels!).reduce<LogLevel>(
    (acc, level) => (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[acc] ? level : acc),
    minLevel,
  );
  const base: Logger = delegate ?? new ConsoleLogger(mostVerbose);
  const sanitized = sanitize ? new SanitizingLogger(base) : base;
  return new NamespacedLogger(sanitized, minLevel, moduleLevels!);
}
