import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculatorConnectionService } from '../../src/integrations/calculator-connection.js';

describe('CalculatorConnectionService', () => {
  it('uses PKCE and stores only encrypted Calculator credentials', async () => {
    const directory=mkdtempSync(join(tmpdir(),'atlas-calculator-'));
    let exchange:any;
    const service=new CalculatorConnectionService(join(directory,'atlas.db'),'http://127.0.0.1:4317',async (_url,init) => {
      exchange=JSON.parse(String(init?.body));
      return new Response(JSON.stringify({token:'calc_int_secret_never_in_ui',record:{id:'connection-1',name:'FNGK Atlas',expiresAt:'2026-12-01T00:00:00.000Z',capabilities:['conversation.run']}}),{status:200});
    });
    const started=service.begin({origin:'https://calculator.example.org'});
    expect(started.authorizationUrl).toContain('code_challenge=');
    await service.complete({state:started.state,code:'calc_code_once'});
    expect(exchange.code_verifier).toHaveLength(64);
    expect(service.status()).toMatchObject({configured:true,connection:{connectionId:'connection-1'}});
    expect(service.bearer()).toBe('calc_int_secret_never_in_ui');
    expect(readFileSync(join(directory,'calculator-connection.json'),'utf8')).not.toContain('calc_int_secret_never_in_ui');
  });
  it('accepts only secure Calculator origins', () => {
    const directory=mkdtempSync(join(tmpdir(),'atlas-calculator-'));
    const service=new CalculatorConnectionService(join(directory,'atlas.db'),'http://127.0.0.1:4317');
    expect(()=>service.begin({origin:'http://calculator.example.org'})).toThrow('HTTPS');
  });
});
