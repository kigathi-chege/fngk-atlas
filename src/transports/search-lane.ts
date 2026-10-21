/**
 * At most one search per lane runs on a Device, and only the newest waiting
 * search runs next.
 *
 * Remote commands share one queued Device Session, and an abort there sends an
 * untargeted Ctrl-C to whatever is running, which may be another operation.
 * So a superseded search is never interrupted. Its caller is released
 * immediately while the command finishes within its own time budget, and
 * everything that queued up behind it is dropped except the latest request.
 * Typing quickly therefore never stacks N finds on the Device.
 */
const cancelled = (message = 'Filesystem search was superseded.') => Object.assign(new Error(message), { code: 'cancelled' });

interface Waiting { start: () => void; reject: (error: Error) => void }
interface Lane { running: boolean; next?: Waiting }

export class SearchLane {
  #lanes = new Map<string, Lane>();

  /** Whether a lane currently has a command running (for tests and diagnostics). */
  busy(key: string): boolean { return this.#lanes.get(key)?.running === true; }

  run<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelled('Filesystem search was cancelled.'));
    const lane = this.#lanes.get(key) ?? { running: false };
    this.#lanes.set(key, lane);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const done = (error?: Error, value?: T) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); if (error) reject(error); else resolve(value as T); };
      const onAbort = () => { if (lane.next === waiting) lane.next = undefined; done(cancelled('Filesystem search was cancelled.')); };
      const start = () => {
        lane.running = true;
        // The task deliberately gets no abort signal; see the class comment.
        void Promise.resolve().then(task).then(value => done(undefined, value), error => done(error as Error)).finally(() => {
          lane.running = false;
          const next = lane.next; lane.next = undefined;
          if (next) next.start(); else if (!lane.running) this.#lanes.delete(key);
        });
      };
      const waiting: Waiting = { start, reject: error => done(error) };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (!lane.running) { start(); return; }
      lane.next?.reject(cancelled());
      lane.next = waiting;
    });
  }
}

export const remoteSearchLane = new SearchLane();
