import { expect, test } from 'vitest';
import { evaluateToolPolicy } from '../../src/agent-tools/policy.js';

const scope={profile:'local',teamId:'team',projectId:'project',deviceId:'device'};
test('full access is exact-scope, expiring, and cannot bypass backend authorization',()=>{
 const grant={id:'grant',scope,toolIds:['*'],kind:'full_access' as const,expiresAt:new Date(Date.now()+60_000).toISOString(),revokedAt:null};
 expect(evaluateToolPolicy({toolId:'atlas.terminal.command',scope,backendAuthorized:true,grants:[grant]}).kind).toBe('allow');
 expect(evaluateToolPolicy({toolId:'atlas.terminal.command',scope:{...scope,deviceId:'other'},backendAuthorized:true,grants:[grant]}).kind).toBe('ask');
 expect(evaluateToolPolicy({toolId:'atlas.terminal.command',scope,backendAuthorized:false,grants:[grant]}).kind).toBe('deny');
 expect(evaluateToolPolicy({toolId:'atlas.terminal.command',scope,backendAuthorized:true,grants:[{...grant,expiresAt:new Date(Date.now()-1).toISOString()}]}).kind).toBe('ask');
});
