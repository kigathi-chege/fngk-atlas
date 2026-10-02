import {describe,expect,it,vi} from 'vitest';

describe('browser diagnostics runtime',()=>{
  it('turns an absent optional browser runtime into an actionable error',async()=>{
    vi.resetModules();
    vi.doMock('playwright',()=>{throw new Error('browser package missing')});
    const {BrowserDiagnosticsUnavailableError,loadBrowserRuntime}=await import('../../src/diagnostics/browser-runtime.js');
    await expect(loadBrowserRuntime()).rejects.toBeInstanceOf(BrowserDiagnosticsUnavailableError);
    await expect(loadBrowserRuntime()).rejects.toMatchObject({code:'browser_diagnostics_unavailable'});
    vi.doUnmock('playwright');
  });
});
