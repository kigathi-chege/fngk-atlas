// A remote read goes Atlas → fngk → Signal → Device, and one stalled hop should not fail a
// read-only listing or open: retry a timeout once, then say what timed out instead of the bare CLI error.

type Failure = { code?: string; message?: string; causes?: Array<{ code?: string; message?: string }> };

export function timedOut(error: unknown): boolean {
  const value = error as Failure;
  return value?.code === 'timeout' || value?.causes?.some(cause => cause.code === 'timeout') === true;
}

/** Runs a read-only operation, running it once more if the first attempt timed out. */
export async function retryTimeout<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try { return await operation(); } catch (error) {
    if (!timedOut(error) || signal?.aborted) throw error;
    return await operation();
  }
}

/** A 504 naming the action, for a timeout; undefined for any other failure. */
export function timedOutFileError(error: unknown, action: string): { statusCode: number; body: Record<string, unknown> } | undefined {
  if (!timedOut(error)) return undefined;
  const value = error as Failure, ms = /after (\d+)ms/.exec([value.message, ...(value.causes ?? []).map(cause => cause.message)].join(' '))?.[1];
  const each = ms ? ` (${Math.round(Number(ms) / 1000)}s each)` : '';
  return { statusCode: 504, body: { error: 'timeout', message: `${action} timed out twice${each}. The Device is answering slowly right now: retry in a moment, or open Recovery to check the connection.` } };
}
