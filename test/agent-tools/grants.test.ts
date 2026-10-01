import { expect, test } from 'vitest';
import { GrantStore } from '../../src/agent-tools/grants.js';
const scope={profile:'local',teamId:'team',projectId:'project',deviceId:'device'};
test('revoked grants are not returned as executable',()=>{const grants=new GrantStore();const grant=grants.create({scope,toolIds:['atlas.terminal.command'],kind:'durable',actor:'operator'});expect(grants.active(scope)).toHaveLength(1);grants.revoke(grant.id,'operator');expect(grants.active(scope)).toHaveLength(0)});
