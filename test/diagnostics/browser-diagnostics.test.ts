import {describe,expect,it} from 'vitest';
import {diagnoseBrowser} from '../../src/diagnostics/browser-diagnostics.js';

describe('browser diagnostics',()=>{
  it('loads a page with Playwright and reports application console errors',async()=>{
    const result=await diagnoseBrowser("data:text/html,<title>Atlas fixture</title><script>console.error('fixture failure')</script>");
    expect(result).toMatchObject({ok:false,title:'Atlas fixture',consoleErrors:['fixture failure'],consoleMessages:[{type:'error',text:'fixture failure'}],failedRequests:[]});
  });
  it('captures bounded console evaluation output',async()=>{const result=await diagnoseBrowser('data:text/html,<title>Eval fixture</title>',{expression:'document.title'});expect(result.evaluation).toBe('Eval fixture')});
});
