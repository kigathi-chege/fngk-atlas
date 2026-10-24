import { describe, expect, it } from 'vitest';
import { retryTimeout, timedOutFileError } from '../../src/server/file-timeouts.js';

const timeout = () => Object.assign(new Error('FNGK operation timed out after 15000ms.'), { code: 'timeout' });

describe('remote file timeouts', () => {
  it('retries a timed-out read once', async () => {
    let calls = 0;
    expect(await retryTimeout(async () => { calls += 1; if (calls === 1) throw timeout(); return 'listed'; })).toBe('listed');
    expect(calls).toBe(2);
  });
  it('gives up after the second timeout and leaves other failures alone', async () => {
    let calls = 0;
    await expect(retryTimeout(async () => { calls += 1; throw timeout(); })).rejects.toMatchObject({ code: 'timeout' });
    expect(calls).toBe(2);
    calls = 0;
    await expect(retryTimeout(async () => { calls += 1; throw Object.assign(new Error('missing'), { code: 'path_not_found' }); })).rejects.toMatchObject({ code: 'path_not_found' });
    expect(calls).toBe(1);
  });
  it('does not retry once the request is cancelled', async () => {
    const controller = new AbortController(); let calls = 0;
    await expect(retryTimeout(async () => { calls += 1; controller.abort(); throw timeout(); }, controller.signal)).rejects.toMatchObject({ code: 'timeout' });
    expect(calls).toBe(1);
  });
  it('names what timed out, including a timeout reported as a route cause', () => {
    expect(timedOutFileError(timeout(), 'Listing /opt')).toEqual({ statusCode: 504, body: { error: 'timeout', message: 'Listing /opt timed out twice (15s each). The Device is answering slowly right now: retry in a moment, or open Recovery to check the connection.' } });
    expect(timedOutFileError({ code: 'route_unavailable', causes: [{ code: 'timeout', message: 'FNGK operation timed out after 15000ms.' }] }, 'Opening /etc/hosts')?.statusCode).toBe(504);
    expect(timedOutFileError(new Error('other'), 'Listing /')).toBeUndefined();
  });
});
