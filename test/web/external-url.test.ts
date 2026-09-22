import {describe,expect,it,vi} from 'vitest';
import {openExternalHttps} from '../../src/web/lib/external-url.js';

describe('external authorization URLs',()=>{
  it('passes a canonical HTTPS URL to the supplied system opener',async()=>{
    const open=vi.fn().mockResolvedValue(undefined);
    await openExternalHttps('https://signal.example.test/login?state=opaque',open);
    expect(open).toHaveBeenCalledWith('https://signal.example.test/login?state=opaque');
  });

  it('rejects a non-HTTPS or malformed URL before it reaches the opener',async()=>{
    const open=vi.fn();
    await expect(openExternalHttps('http://signal.example.test/login',open)).rejects.toThrow('HTTPS');
    await expect(openExternalHttps('not a URL',open)).rejects.toThrow('invalid');
    expect(open).not.toHaveBeenCalled();
  });
});
