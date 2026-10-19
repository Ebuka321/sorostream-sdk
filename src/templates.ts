import type { CreateStreamParams } from './types.js';

const DAY = 86_400;
const WEEK = 604_800;

function days(n: number): number {
  return n * DAY;
}

/**
 * Token classes a template can branch on when resolving a conditional
 * parameter (issue #710). Open string so callers may pass registry labels.
 */
export type TemplateTokenType = 'native' | 'stablecoin' | 'volatile' | (string & {});

/** Context passed to conditional template parameters at instantiation (issue #710). */
export interface TemplateTokenContext {
  /** The token type the template is being instantiated with. */
  tokenType: TemplateTokenType;
  /** Decimals of that token (default 7, the Stellar asset standard). */
  decimals: number;
}

/**
 * A template parameter that is either a static value (existing behaviour) or
 * a resolver evaluated at instantiation time with the token context, so
 * different token types can produce different resolved parameters (issue #710).
 */
export type ConditionalParam<T> = T | ((ctx: TemplateTokenContext) => T);

/**
 * Resolves a {@link ConditionalParam}: static values pass through unchanged,
 * functions are invoked with the instantiation context (issue #710).
 */
export function resolveConditionalParam<T>(
  value: ConditionalParam<T>,
  ctx: TemplateTokenContext,
): T {
  return typeof value === 'function' ? (value as (ctx: TemplateTokenContext) => T)(ctx) : value;
}

/**
 * Pre-built stream templates that produce ready-to-use CreateStreamParams,
 * reducing boilerplate for common stream configurations.
 *
 * @example
 * ```ts
 * // Biweekly payroll: streams for 2 weeks
 * const params = templates.biweeklyPayroll({
 *   recipient: "G…",
 *   token: "GUSDC…",
 *   amount: toStroops("5000"),
 *   autoRenew: true,
 * });
 * const { streamId } = await client.createStream(params);
 * ```
 */
export const templates = {
  /**
   * Creates a biweekly (14-day) payroll stream.
   */
  biweeklyPayroll(params: Omit<CreateStreamParams, 'durationSeconds'>): CreateStreamParams {
    return { ...params, durationSeconds: days(14) };
  },

  /**
   * Creates a weekly (7-day) stream.
   */
  weekly(params: Omit<CreateStreamParams, 'durationSeconds'>): CreateStreamParams {
    return { ...params, durationSeconds: WEEK };
  },

  /**
   * Creates a monthly (30-day) stream.
   */
  monthly(params: Omit<CreateStreamParams, 'durationSeconds'>): CreateStreamParams {
    return { ...params, durationSeconds: days(30) };
  },

  /**
   * Creates a fixed-term vesting stream spanning a given number of years.
   * @param params.years - Number of years for the vesting period.
   */
  vesting(
    params: Omit<CreateStreamParams, 'durationSeconds'> & { years: number },
  ): CreateStreamParams {
    return { ...params, durationSeconds: days(365 * params.years) };
  },

  /**
   * Creates a custom-duration stream for a given number of days.
   */
  custom(
    params: Omit<CreateStreamParams, 'durationSeconds'> & { days: number },
  ): CreateStreamParams {
    return { ...params, durationSeconds: days(params.days) };
  },

  /**
   * Creates a stream whose initial amount is a token-type-conditional
   * parameter, resolved at instantiation time from the given token type and
   * decimals (issue #710). Static `amount` values keep working unchanged.
   *
   * @example
   * ```ts
   * const params = templates.minAmountStream({
   *   recipient: "G…", token: "GUSDC…", autoRenew: false,
   *   tokenType: "stablecoin", decimals: 6,
   *   amount: (ctx) => 10n ** BigInt(ctx.decimals), // 1 unit minimum
   * });
   * ```
   */
  minAmountStream(
    params: Omit<CreateStreamParams, 'amount'> & {
      amount: ConditionalParam<bigint>;
      tokenType: TemplateTokenType;
      decimals?: number;
    },
  ): CreateStreamParams {
    const { tokenType, decimals = 7, amount, ...rest } = params;
    return {
      ...rest,
      amount: resolveConditionalParam(amount, { tokenType, decimals }),
    };
  },
};
