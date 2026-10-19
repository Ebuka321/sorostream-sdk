import { Memo, MemoHash, MemoID, MemoNone, MemoText, MemoReturn } from '@stellar/stellar-sdk';
import type { MemoType } from '@stellar/stellar-sdk';
import { SoroStreamMemoError } from './errors.js';

/** Maximum byte length of a Soroban/Stellar text memo. */
export const MEMO_TEXT_MAX_BYTES = 28;

/** Fixed byte length of a Soroban/Stellar hash memo. */
const HASH_MEMO_BYTES = 32;

/**
 * Converts a Uint8Array to a lowercase hex string.
 * Used to pass data to `Memo.hash()` without requiring Node.js Buffer.
 * Works in Cloudflare Workers, browsers, Deno, and Bun.
 */
function uint8ArrayToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Asserts that `text` fits in a Stellar `MEMO_TEXT` (28 UTF-8 bytes),
 * throwing before any XDR encoding or submission happens (issue #704).
 *
 * Use this from any code path that builds a text memo so callers get the
 * same clear, typed error regardless of which helper produced the memo.
 *
 * @param text - The memo text to validate.
 * @throws {SoroStreamMemoError} If `text` exceeds 28 bytes (UTF-8 encoded).
 */
export function assertMemoTextWithinLimit(text: string): void {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MEMO_TEXT_MAX_BYTES) {
    throw new SoroStreamMemoError(
      `Text memo exceeds ${MEMO_TEXT_MAX_BYTES} bytes (got ${byteLength} bytes)`,
    );
  }
}

/**
 * Encodes a string as a Stellar transaction text memo, validating that it
 * does not exceed the protocol's 28-byte limit.
 *
 * @param text - The memo text to encode.
 * @throws {SoroStreamMemoError} If `text` exceeds 28 bytes (UTF-8 encoded).
 *
 * @example
 * ```ts
 * const memo = encodeMemo("invoice-4821");
 * ```
 */
export function encodeMemo(text: string): Memo<MemoType.Text> {
  assertMemoTextWithinLimit(text);
  return Memo.text(text);
}

/**
 * Encodes binary data as a Stellar transaction hash memo. Hash memos are
 * always exactly 32 bytes: shorter inputs are zero-padded, longer inputs
 * are truncated (with a warning) to fit.
 *
 * Issue #406: Accepts a `Uint8Array` (not Node.js `Buffer`) and converts to
 * a hex string before passing to `Memo.hash()`. This is compatible with
 * Cloudflare Workers and any other non-Node.js runtime.
 *
 * @param data - The bytes to encode as a hash memo.
 *
 * @example
 * ```ts
 * const memo = encodeMemoHash(sha256Digest);
 * ```
 */
export function encodeMemoHash(data: Uint8Array): Memo<MemoType.Hash> {
  if (data.length > HASH_MEMO_BYTES) {
    console.warn(
      `encodeMemoHash: input is ${data.length} bytes, truncating to ${HASH_MEMO_BYTES} bytes`,
    );
  }
  const padded = new Uint8Array(HASH_MEMO_BYTES);
  padded.set(data.subarray(0, Math.min(data.length, HASH_MEMO_BYTES)), 0);
  // Stellar SDK's Memo.hash accepts a 64-char lowercase hex string in all
  // environments (including Cloudflare Workers where Buffer is unavailable).
  return Memo.hash(uint8ArrayToHex(padded));
}

/**
 * Reads a memo from a transaction record and returns its decoded value.
 *
 * Issue #406: Returns `Uint8Array` (not `Buffer`) for hash/return memos so
 * this function is safe to call in Cloudflare Workers.
 *
 * @param memo - The memo to decode.
 * @returns The decoded text/id (`string`) or hash/return value (`Uint8Array`),
 *   or `null` when the transaction has no memo.
 *
 * @example
 * ```ts
 * const value = decodeMemo(tx.memo); // string | Uint8Array | null
 * ```
 */
export function decodeMemo(memo: Memo): string | Uint8Array | null {
  switch (memo.type) {
    case MemoNone:
      return null;
    case MemoText:
    case MemoID:
      return memo.value as string;
    case MemoHash:
    case MemoReturn: {
      const val = memo.value;
      // Stellar SDK stores the value as a Buffer (Uint8Array subclass).
      // Normalise to a plain Uint8Array so callers don't need Buffer APIs —
      // this is safe in Cloudflare Workers and any non-Node.js environment.
      if (val instanceof Uint8Array) {
        return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
      }
      return null;
    }
    default:
      return null;
  }
}
