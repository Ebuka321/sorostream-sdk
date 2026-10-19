import type { SoroStreamClient } from './SoroStreamClient.js';
import type { CreateStreamParams } from './types.js';
import { BatchOperationLimitExceededError } from './errors.js';

/**
 * Maximum number of operations allowed in a single Soroban transaction
 * (issue #700). Batches beyond this would only fail at submission time with
 * an opaque network error, so `BatchBuilder` validates the combined count
 * locally before submitting.
 */
export const SOROBAN_MAX_OPS_PER_TX = 100;

/**
 * Fluent builder for constructing and submitting multi-stream batch operations.
 * Obtain an instance via {@link SoroStreamClient.batch}.
 *
 * Each chained method records an operation. Calling `submit()` executes all
 * recorded operations and returns a per-operation result summary.
 *
 * Issue #335.
 *
 * @example
 * ```ts
 * const { txHash, results } = await client.batch()
 *   .createStream({ recipient, token, amount, durationSeconds, autoRenew: false })
 *   .withdraw("stream-42")
 *   .cancelStream("stream-7")
 *   .submit();
 * ```
 */
export class BatchBuilder {
  private readonly ops: Array<{ label: string; run: () => Promise<void> }> = [];

  constructor(private readonly client: SoroStreamClient) {}

  /**
   * Queues a `createStream` operation in the batch.
   * @param params - Stream creation parameters.
   */
  createStream(params: CreateStreamParams): this {
    this.ops.push({
      label: 'createStream',
      run: async () => {
        await this.client.createStream(params);
      },
    });
    return this;
  }

  /**
   * Queues a `cancelStream` operation in the batch.
   * @param streamId - The stream to cancel.
   */
  cancelStream(streamId: string): this {
    this.ops.push({
      label: 'cancelStream',
      run: async () => {
        await this.client.cancelStream({ streamId });
      },
    });
    return this;
  }

  /**
   * Queues a `withdraw` operation in the batch.
   * @param streamId - The stream to withdraw from.
   */
  withdraw(streamId: string): this {
    this.ops.push({
      label: 'withdraw',
      run: async () => {
        await this.client.withdraw({ streamId });
      },
    });
    return this;
  }

  /**
   * Number of operations currently queued in the batch.
   */
  get operationCount(): number {
    return this.ops.length;
  }

  /**
   * Executes all queued operations and returns a per-operation result summary.
   *
   * The combined operation count is validated against the Soroban
   * per-transaction limit before any operation runs (issue #700); an oversized
   * batch throws {@link BatchOperationLimitExceededError} instead of failing
   * at submission.
   *
   * Each operation is attempted independently. Failures are captured rather
   * than aborting the batch so callers can inspect partial results and retry.
   *
   * @returns `{ txHash, results }` — `txHash` is a summary marker and `results`
   *   contains per-operation outcomes with `operation`, `success`, and optional `error`.
   */
  async submit(): Promise<{
    txHash: string;
    results: Array<{ operation: string; success: boolean; error?: string }>;
  }> {
    if (this.ops.length === 0) {
      throw new Error(
        'BatchBuilder: no operations queued — add at least one operation before calling submit()',
      );
    }

    if (this.ops.length > SOROBAN_MAX_OPS_PER_TX) {
      throw new BatchOperationLimitExceededError(this.ops.length, SOROBAN_MAX_OPS_PER_TX);
    }

    const results: Array<{ operation: string; success: boolean; error?: string }> = [];

    for (const op of this.ops) {
      try {
        await op.run();
        results.push({ operation: op.label, success: true });
      } catch (err) {
        results.push({
          operation: op.label,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { txHash: '(see individual operation results)', results };
  }
}
